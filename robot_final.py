# -*- coding: utf-8 -*-
import base64
import pickle
import socket
import struct
import time

import cv2
import numpy as np
import paho.mqtt.client as mqtt

# --- CONFIGURATION ---
PC_IP = '192.168.72.21'
MQTT_HOST = "localhost"
MQTT_PORT = 1883
COORDS = "35.7649,10.8062"

FACE_CONFIDENCE = 0.6
FACE_FRAMES_STABLE = 8   # frames before human alert triggers/clears

# Flame detection by COLOR, not the forest-fire YOLO model. Runs EVERY frame (fast on
# the Pi -> good for head-tracking). (The YOLO fine-tune in candle_detector/ is the
# long-term upgrade.)
#
# A flame is the rare combination of TWO things touching each other:
#   * a white-hot CORE (very bright, often overexposed to near-white), AND
#   * a saturated warm HALO (orange/red/yellow) right around it.
# Requiring BOTH is what makes it flame-specific: a white wall has a bright core but no
# warm halo; skin/wood is warm but has no blown-out core. Cameras often overexpose the
# flame core to white, which is exactly why we don't rely on the core being orange.
FLAME_HALO_HUE_MAX = 35    # accept red -> orange -> light yellow (OpenCV hue is 0-179)
FLAME_HALO_SAT_MIN = 150   # halo must be vivid -> rejects pale skin / walls / soft light
FLAME_HALO_VAL_MIN = 150   # halo is reasonably bright
FLAME_WARM_DIFF    = 60    # halo must be strongly warm: red channel >= blue channel + this
FLAME_CORE_VAL     = 245   # white-hot core: only a truly blown-out core passes (plain
                           # red/orange/yellow objects have NO white core -> rejected)
FLAME_PROXIMITY    = 14    # core and halo must be THIS close to count as one flame
FLAME_MIN_AREA     = 40    # ignore small specks (pixels)
FLAME_MAX_AREA_FRAC = 0.25 # ignore large warm regions (windows / sunlit walls / red shirt)
FIRE_ALARM_SECONDS = 0.8   # flame must persist this long before raising the alarm
FIRE_CLEAR_SECONDS = 3.0   # flame must be gone this long before clearing the alarm

# --- IR obstacle sensor (FC-51 / generic 3-pin digital IR module) ---
# Digital module: OUT is just HIGH/LOW, not a distance. The detection range (a few cm
# up to ~30 cm) is set by the little blue potentiometer on the board. Power it from the
# Pi's 3.3V pin so OUT is a 3.3V-safe signal — then NO resistor/divider is needed. See
# the wiring notes at the bottom of this file.
IR_OBSTACLE_PIN = 23       # BCM GPIO for the sensor OUT pin (header pin 16)
IR_ACTIVE_LOW   = True     # most modules pull OUT LOW when an obstacle is seen
IR_PERIOD       = 0.5      # seconds between IR prints (throttle so it doesn't spam)


def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        client.publish("robot/status", "online")
        print("MQTT Connecte - commandes dashboard actives")
    else:
        print(f"Erreur MQTT rc={rc}")


def flame_mask(frame):
    """Binary mask of flame pixels (white-hot core touching a saturated warm halo).

    Robust to cameras that overexpose the flame core to white. Exposed so
    flame_tune.py can visualize it.
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    val = hsv[:, :, 2]
    b, _, r = cv2.split(frame)
    warm = ((r.astype(np.int16) - b.astype(np.int16)) >= FLAME_WARM_DIFF).astype(np.uint8) * 255

    # Saturated warm halo (orange/red/yellow surround).
    halo = cv2.inRange(hsv, (0, FLAME_HALO_SAT_MIN, FLAME_HALO_VAL_MIN),
                       (FLAME_HALO_HUE_MAX, 255, 255))
    halo = cv2.bitwise_and(halo, warm)
    # White-hot core: very bright, any hue (covers overexposed near-white cores).
    core = (val >= FLAME_CORE_VAL).astype(np.uint8) * 255

    # A flame = core and halo within FLAME_PROXIMITY px of each other. Keep the parts of
    # each that are near the other, so isolated bright walls / warm skin are dropped.
    k = np.ones((FLAME_PROXIMITY, FLAME_PROXIMITY), np.uint8)
    core_near = cv2.dilate(core, k)
    halo_near = cv2.dilate(halo, k)
    mask = cv2.bitwise_or(cv2.bitwise_and(core, halo_near), cv2.bitwise_and(halo, core_near))
    mask = cv2.dilate(mask, np.ones((7, 7), np.uint8))  # merge into one solid blob
    return mask


def detect_flame(frame):
    """Detect candle/lighter flames by color. Returns (x, y, w, h) boxes, largest first."""
    h, w = frame.shape[:2]
    max_area = FLAME_MAX_AREA_FRAC * w * h
    contours, _ = cv2.findContours(flame_mask(frame), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [cv2.boundingRect(c) for c in contours
             if FLAME_MIN_AREA <= cv2.contourArea(c) <= max_area]
    boxes.sort(key=lambda b: b[2] * b[3], reverse=True)  # largest (main flame) first
    return boxes


_ir_sensor = None  # lazily created IR sensor handle (None=untried, False=unavailable)


def read_ir_obstacle():
    """Return True if the IR sensor sees an obstacle, False if clear, None if unavailable.

    Uses gpiozero on the lgpio backend, which is the path that actually works on the
    Pi 5's RP1 GPIO (RPi.GPIO does not). The digital IR module only reports near/far
    around the threshold set by its on-board potentiometer — it is not a distance.
    """
    global _ir_sensor
    if _ir_sensor is None:
        try:
            from gpiozero import DigitalInputDevice
            # pull_up matches the module polarity so a disconnected pin reads "clear",
            # and gpiozero's .value == 1 then means "active" = obstacle either way.
            _ir_sensor = DigitalInputDevice(IR_OBSTACLE_PIN, pull_up=IR_ACTIVE_LOW)
        except Exception as e:
            print(f"Capteur IR indisponible : {e}")
            _ir_sensor = False  # remember the failure, don't retry every call
    if not _ir_sensor:
        return None
    return bool(_ir_sensor.value)


def print_ir():
    """Print the IR obstacle state once. Returns True/False, or None if no sensor."""
    obstacle = read_ir_obstacle()
    if obstacle is None:
        print("Capteur IR : indisponible")
    elif obstacle:
        print("Capteur IR : OBSTACLE detecte")
    else:
        print("Capteur IR : voie libre")
    return obstacle


def main():
    client_mqtt = mqtt.Client()
    client_mqtt.on_connect = on_mqtt_connect

    try:
        client_mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
        client_mqtt.loop_start()
    except:
        print("Erreur : Verifie que Mosquitto tourne sur la Pi")

    face_net  = cv2.dnn.readNetFromCaffe("deploy.prototxt", "res10_300x300_ssd_iter_140000.caffemodel")
    print("Detection visage (Caffe SSD) + feu (couleur HSV) active")

    cap = cv2.VideoCapture(0)

    # Face: symmetric stability filter (same speed to detect and clear)
    face_last      = None
    face_candidate = None
    face_counter   = 0

    # Fire: asymmetric + time-based so it's independent of frame rate
    fire_alarming      = False        # currently in "fire detected" alarm state
    fire_present_since = None         # timestamp flame first appeared (None = absent)
    fire_absent_since  = time.time()  # timestamp flame first disappeared (None = present)

    last_ir_print = 0.0                # throttle timestamp for the IR obstacle print

    print("Robot Spider en ligne - Dashboard MQTT actif")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            (h, w) = frame.shape[:2]

            # --- Face detection (Caffe SSD, every frame) ---
            blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
            face_net.setInput(blob)
            detections = face_net.forward()

            nb_faces = 0
            for i in range(0, detections.shape[2]):
                if detections[0, 0, i, 2] > FACE_CONFIDENCE:
                    nb_faces += 1
                    box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
                    (sX, sY, eX, eY) = box.astype("int")
                    cv2.rectangle(frame, (sX, sY), (eX, eY), (0, 200, 0), 2)
                    cv2.putText(frame, "visage", (sX, max(20, sY - 8)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 0), 2)

            # --- Flame detection (HSV color, every frame — fast enough for head tracking) ---
            flame_boxes = detect_flame(frame)
            now = time.time()
            if flame_boxes:
                if fire_present_since is None:
                    fire_present_since = now
                fire_absent_since = None
            else:
                if fire_absent_since is None:
                    fire_absent_since = now
                fire_present_since = None

            # Draw boxes; the largest (first) is the flame we track.
            for (fx, fy, fw, fh) in flame_boxes:
                cv2.rectangle(frame, (fx, fy), (fx + fw, fy + fh), (0, 80, 255), 2)
                cv2.putText(frame, "FEU", (fx, max(20, fy - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 80, 255), 2)

            # Publish the main flame's centre (normalized to [-1, 1], 0,0 = frame centre)
            # so the head-follow feature can steer toward it later.
            if flame_boxes:
                bx, by, bw, bh = flame_boxes[0]
                fx_norm = (bx + bw / 2) / w * 2 - 1
                fy_norm = (by + bh / 2) / h * 2 - 1
                client_mqtt.publish("robot/feu_position", f"{fx_norm:.3f},{fy_norm:.3f}")

            # --- IR obstacle check (throttled so it doesn't flood the log) ---
            if now - last_ir_print >= IR_PERIOD:
                last_ir_print = now
                obstacle = print_ir()
                if obstacle is not None:
                    client_mqtt.publish("robot/obstacle", "1" if obstacle else "0")

            presence_humaine = nb_faces > 0

            # --- Face stability filter (symmetric) ---
            if presence_humaine == face_candidate:
                face_counter += 1
            else:
                face_candidate = presence_humaine
                face_counter   = 1

            # --- Publish live frame (face + fire annotations in same image) ---
            _, buffer_f = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 25])
            client_mqtt.publish("robot/flux", base64.b64encode(buffer_f).decode('utf-8'))

            # --- Face state change alert ---
            if face_counter >= FACE_FRAMES_STABLE and face_candidate != face_last:
                if presence_humaine:
                    msg = "Presence humaine detectee"
                    client_mqtt.publish("robot/alerte_vocale", msg)
                    client_mqtt.publish("robot/detection", msg)
                    print(f"Alerte : {msg} (visages={nb_faces})")
                    _, buf_p = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 50])
                    client_mqtt.publish("robot/photo", base64.b64encode(buf_p).decode('utf-8'))
                    client_mqtt.publish("robot/localisation", COORDS)
                else:
                    msg = "Aucune presence humaine detectee"
                    client_mqtt.publish("robot/detection", msg)
                    print(f"Etat : {msg}")
                face_last = face_candidate

            # --- Fire alarm: raise fast, clear slow (time-based) ---
            now = time.time()
            if (not fire_alarming and fire_present_since is not None
                    and now - fire_present_since >= FIRE_ALARM_SECONDS):
                fire_alarming = True
                msg_feu = "Feu detecte"
                client_mqtt.publish("robot/alerte_vocale", msg_feu)
                client_mqtt.publish("robot/feu", msg_feu)
                print(f"ALERTE FEU : {msg_feu} (zones={len(flame_boxes)})")
                _, buf_feu = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 50])
                client_mqtt.publish("robot/feu_photo", base64.b64encode(buf_feu).decode('utf-8'))
                client_mqtt.publish("robot/localisation", COORDS)

            elif (fire_alarming and fire_absent_since is not None
                    and now - fire_absent_since >= FIRE_CLEAR_SECONDS):
                fire_alarming = False
                msg_feu = "Aucun feu detecte"
                client_mqtt.publish("robot/feu", msg_feu)
                print(f"Etat : {msg_feu}")

            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.01)
                    s.connect((PC_IP, 5005))
                    _, jpg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 40])
                    data = pickle.dumps([jpg, f"DATA:{int(presence_humaine)}"])
                    s.sendall(struct.pack("Q", len(data)) + data)
            except:
                pass

            time.sleep(0.03)

    except KeyboardInterrupt:
        print("Arret programme")
    finally:
        try:
            client_mqtt.publish("robot/status", "offline")
            client_mqtt.loop_stop()
            client_mqtt.disconnect()
        except:
            pass
        cap.release()


if __name__ == "__main__":
    main()


# ===========================================================================
#  IR OBSTACLE SENSOR WIRING  (FC-51 / generic 3-pin digital IR, Raspberry Pi 5)
# ===========================================================================
#
#  The module has 3 pins: VCC, GND, OUT. An IR LED shines forward and a photo-
#  diode next to it detects the reflection off a nearby surface; an on-board
#  comparator (LM393) flips OUT when something is within range. The little blue
#  potentiometer sets that range — turn it to tune roughly 2..30 cm.
#
#  Connections (NO resistor needed when powered from 3.3V):
#    Module VCC -> Pi 3.3V    (header pin 1)   <- 3.3V supply keeps OUT at a safe 3.3V
#    Module GND -> Pi GND     (header pin 6)
#    Module OUT -> Pi GPIO23  (header pin 16)
#
#  Why power from 3.3V: many of these boards drive OUT up to whatever VCC is.
#  Powered from 5V, OUT swings to 5V -> same overvoltage problem as the HC-SR04.
#  Powered from 3.3V, OUT is a safe 3.3V signal, so the divider is unnecessary.
#  (If your specific module only works at 5V, put OUT behind a 1k/2k divider.)
#
#  Most modules pull OUT LOW when they see an obstacle (IR_ACTIVE_LOW = True). If
#  yours is inverted, just flip that flag. The board's two LEDs usually light when
#  an obstacle is detected — handy for confirming the wiring before touching code.
#
#  Test without the camera:  python3 -c "import robot_final; robot_final.print_ir()"
# ===========================================================================
