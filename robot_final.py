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
# On garde l'IP au cas ou, mais le code priorise le fonctionnement autonome
PC_IP = '192.168.72.21'
MQTT_HOST = "localhost"
MQTT_PORT = 1883
COORDS = "35.7649,10.8062"
FACE_CONFIDENCE = 0.6

COMMAND_TOPICS = [
    ("robot/servo/oy", 0),
    ("robot/servo/oz", 0),
]


def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        client.subscribe(COMMAND_TOPICS)
        client.publish("robot/status", "online")
        print("MQTT Connecte - commandes dashboard actives")
    else:
        print(f"Erreur MQTT rc={rc}")


def on_mqtt_message(client, userdata, msg):
    payload = msg.payload.decode("utf-8", errors="ignore").strip()

    if msg.topic == "robot/servo/oy":
        print(f"Servo Oy -> {payload}")
        # TODO: connecter ici le servo horizontal.

    if msg.topic == "robot/servo/oz":
        print(f"Servo Oz -> {payload}")
        # TODO: connecter ici le servo hauteur/extension.


def main():
    client_mqtt = mqtt.Client()
    client_mqtt.on_connect = on_mqtt_connect
    client_mqtt.on_message = on_mqtt_message

    try:
        client_mqtt.connect(MQTT_HOST, MQTT_PORT, 60)
        client_mqtt.loop_start()
    except:
        print("Erreur : Verifie que Mosquitto tourne sur la Pi")

    face_net = cv2.dnn.readNetFromCaffe("deploy.prototxt", "res10_300x300_ssd_iter_140000.caffemodel")
    print("Detection visage seule active")

    cap = cv2.VideoCapture(0)
    dernier_etat = None
    candidat_etat = None
    compteur_stable = 0
    frames_stables_detection = 8

    print("Robot Spider en ligne - Dashboard MQTT actif")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            (h, w) = frame.shape[:2]
            blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
            face_net.setInput(blob)
            detections = face_net.forward()

            nb_faces = 0
            for i in range(0, detections.shape[2]):
                if detections[0, 0, i, 2] > FACE_CONFIDENCE:
                    nb_faces += 1
                    box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
                    (sX, sY, eX, eY) = box.astype("int")
                    cv2.rectangle(frame, (sX, sY), (eX, eY), (0, 255, 0), 2)
                    cv2.putText(frame, "visage", (sX, max(20, sY - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

            presence_humaine = nb_faces > 0

            if presence_humaine == candidat_etat:
                compteur_stable += 1
            else:
                candidat_etat = presence_humaine
                compteur_stable = 1

            _, buffer_f = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 25])
            client_mqtt.publish("robot/flux", base64.b64encode(buffer_f).decode('utf-8'))

            if compteur_stable >= frames_stables_detection and candidat_etat != dernier_etat:
                if presence_humaine:
                    msg_vocal = "Presence humaine detectee"
                    client_mqtt.publish("robot/alerte_vocale", msg_vocal)
                    client_mqtt.publish("robot/detection", msg_vocal)
                    print(f"Alerte envoyee : {msg_vocal} (visages={nb_faces})")

                    _, buffer_p = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 50])
                    client_mqtt.publish("robot/photo", base64.b64encode(buffer_p).decode('utf-8'))
                    client_mqtt.publish("robot/localisation", COORDS)
                else:
                    msg_clear = "Aucune presence humaine detectee"
                    client_mqtt.publish("robot/detection", msg_clear)
                    print(f"Etat envoye : {msg_clear}")

                dernier_etat = presence_humaine

            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.01)
                    s.connect((PC_IP, 5005))
                    res, jpg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 40])
                    msg = pickle.dumps([jpg, f"DATA:{int(presence_humaine)}"])
                    s.sendall(struct.pack("Q", len(msg)) + msg)
            except:
                pass

            time.sleep(0.05)

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
