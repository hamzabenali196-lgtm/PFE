# -*- coding: utf-8 -*-
from __future__ import annotations

import queue
import signal
import threading
import time

import paho.mqtt.client as mqtt

from lobot_controller import LobotServo
from motor_controller import create_motor_drive
from robot_controller import (
    ANKLE_LIFT, KNEE_GROUND, KNEE_LIFT, RUN_STEP_TIME_MS, STAND_HEIGHT, create_robot,
)
from robot_sounds import SoundPlayer


MQTT_HOST = "localhost"
MQTT_PORT = 1883
ROBOT_PORT = "/dev/ttyAMA0"
ROBOT_BAUD = 9600
ROBOT_MOVE_TIME_MS = 250
ROBOT_STAND_TIME_MS = 120
# Slow, gentle posture change for legs-up/legs-down when switching drive mode
# or auto/manual. Must NOT be used in the d-pad path: stand() blocks for the
# full duration, so a long time here makes every button press feel laggy.
ROBOT_SETTLE_TIME_MS = 1200
ROBOT_STEP_TIME_MS = RUN_STEP_TIME_MS

COMMAND_TOPIC = "robot/command"
STATUS_TOPIC = "robot/motion/status"
EVENT_TOPIC = "robot/motion/event"
MODE_TOPIC = "robot/mode"
OBSTACLE_TOPIC = "robot/obstacle"
FIRE_POS_TOPIC = "robot/feu_position"
HUMAN_POS_TOPIC = "robot/visage_position"

HEAD_SERVO_OY = 19   # tilt (up / down)
HEAD_SERVO_OZ = 20   # pan  (left / right)
HEAD_MOVE_TIME_MS = 200
# Bias the whole tilt range upward (the camera aimed too low at every slider
# position, center included). Lower logical oy = up, so this is subtracted in
# move_head. Increase to aim higher still; set to 0 to disable.
HEAD_TILT_UP_OFFSET_DEG = -80


def angle_to_lobot(angle: float) -> int:
    """Convert 0–180° to Lobot position 500–2500 (center 90° → 1500)."""
    return round(500 + (float(angle) / 180.0) * 2000)


SPEED_DEFAULT = 5
SPEED_MIN = 1
SPEED_MAX = 10
SPEED_STEP_TIME_MAX_MS = 700  # slowest (speed=1)
SPEED_STEP_TIME_MIN_MS = 120  # fastest (speed=10)


def speed_to_step_ms(speed: int) -> int:
    frac = (speed - 1) / (SPEED_MAX - SPEED_MIN)
    return int(SPEED_STEP_TIME_MAX_MS - frac * (SPEED_STEP_TIME_MAX_MS - SPEED_STEP_TIME_MIN_MS))


# Wheel (motor) speed: same 1..10 slider mapped to a PWM duty cycle. The low end
# stays high because DC motors won't actually spin below ~0.5 duty (they just buzz).
WHEEL_DUTY_MIN = 0.60
WHEEL_DUTY_MAX = 1.00


def speed_to_duty(speed: int) -> float:
    frac = (speed - 1) / (SPEED_MAX - SPEED_MIN)
    return WHEEL_DUTY_MIN + frac * (WHEEL_DUTY_MAX - WHEEL_DUTY_MIN)


COMMAND_ALIASES = {
    "z": "forward",
    "s": "backward",
    "q": "left",
    "d": "right",
    "hello": "hi",
}

DRIVE_COMMANDS = {
    "forward",
    "backward",
    "left",
    "right",
}

# Toggle which actuators answer forward/backward/left/right. This is INDEPENDENT
# of manual/auto mode — all four combos work (manual+legs, manual+motors,
# auto+legs, auto+motors):
#   "legs"   -> the tripod gait (six leg servos)
#   "motors" -> the DC motors via the L298N (left channel + right channel; two
#               motors wired in parallel per channel), after lifting the legs
DRIVE_MODE_COMMANDS = {"legs", "motors"}

COMMAND_PREFIXES = ("start:", "press:", "hold:")

WALK_HEIGHT_DEFAULT = STAND_HEIGHT   # 1300
WALK_HEIGHT_MIN     = 950            # body at max high
WALK_HEIGHT_MAX     = 1600           # body at max low
WALK_HEIGHT_STEP    = 100


def compute_ground_knee(walk_height: int) -> int:
    """Knee position for grounded legs — both joints contribute to height."""
    delta = STAND_HEIGHT - walk_height          # positive = standing taller
    return max(900, KNEE_GROUND - int(delta * 1.2))


def compute_lift_knee(walk_height: int) -> int:
    """Knee lift during gait — lifts more when robot stands taller."""
    delta = STAND_HEIGHT - walk_height
    return max(650, KNEE_LIFT - int(delta * 0.6))


def compute_lift_ankle(walk_height: int) -> int:
    """Ankle lift during gait — lifts more when robot stands taller."""
    delta = STAND_HEIGHT - walk_height
    return max(580, ANKLE_LIFT - int(delta * 0.6))

HEIGHT_COMMANDS = {"height:up", "height:down"}

ONE_SHOT_COMMANDS = {
    "hi",
    "stand",
    "bow",
    "shake",
    "wave",
    "bounce",
    "sway",
    "tiptoe",
    "ripple",
    "pulse",
}


# --- Autonomous (auto) mode ---------------------------------------------------
AUTO_TURN_MS_DEFAULT = 1500   # ~90° right-turn duration (calibrated live via auto:turn_ms)
AUTO_HEAD_SCAN = True         # the HEAD pans to search; the BODY only turns on an obstacle
SCAN_SPEED_DEG_S = 25         # smooth sweep speed: full PAN_MIN..PAN_MAX pass in ~6.4 s
TARGET_FRESH_S = 1.5          # a detection counts as "current" if seen within this long
TARGET_CENTER_TOL = 0.30      # |x| below this = target ~centered -> walk straight at it
PAN_FOLLOW_GAIN = 25          # deg of head pan per unit target x-offset while tracking
FOLLOW_DEADBAND = 0.06        # |offset| below this = centered enough, don't twitch
PAN_MIN, PAN_MAX, PAN_CENTER = 10, 170, 90   # matches the UI pan slider range
# Auto mode NEVER moves the tilt (up/down) servo — it stays wherever the UI
# slider put it. Scanning and target tracking are pan-only.
TILT_CENTER = 60
AUTO_MOTOR_TICK_S = 0.1       # auto-loop pacing when locomoting on motors (gait paces itself)
# Alert flow: the first fire/human sighting HALTS the robot and raises a big
# dashboard alert; it stays frozen until the operator sends auto:resume (the
# halt never expires on its own). After the operator has granted movement,
# the target being gone this long ends the episode and re-arms alerts.
ALERT_CLEAR_S = 4.0


class MotionWorker:
    def __init__(self) -> None:
        self.commands: queue.Queue[str] = queue.Queue()
        self.stop_event = threading.Event()
        self.active_direction: str | None = None
        self.phase_index = 0
        self.walk_height = WALK_HEIGHT_DEFAULT
        self.speed = SPEED_DEFAULT
        self.step_time_ms = speed_to_step_ms(SPEED_DEFAULT)
        # Which actuators drive forward/backward/left/right: "legs" (gait) or
        # "motors" (the L298N DC motors). Independent of manual/auto. Motors are
        # created lazily, so this reserves no GPIO until motor mode is first used.
        self.drive_mode = "legs"
        self._motor_dir: str | None = None   # current latched motor direction
        self.motors = create_motor_drive(duty=speed_to_duty(SPEED_DEFAULT))
        # --- auto-mode state (mode/obstacle/targets are set from the MQTT thread,
        #     read by the main loop; all serial I/O stays on the main thread) ---
        self.mode = "manual"
        self._applied_mode = "manual"
        self.obstacle = False
        self.target_fire: dict | None = None
        self.target_human: dict | None = None
        self.auto_turn_ms = AUTO_TURN_MS_DEFAULT
        self._auto_dir: str | None = None
        self._scan_dir = 1        # +1 sweeping right, -1 sweeping left
        self._scan_ts = 0.0       # last scan update (0 = sweep not started yet)
        self._pan_angle = PAN_CENTER
        self._tilt_angle = TILT_CENTER
        self._alert_kind: str | None = None  # "fire"/"human" episode in progress
        self._alert_granted = False          # operator approved movement (auto:resume)
        self._alert_seen_ts = 0.0            # last time the alert's target was seen
        # Bluetooth-speaker sound effects: a chirp per show move, a repeating
        # step sound while driving, a siren on auto-mode alerts. Best-effort —
        # the robot moves normally even with no speaker paired.
        self.sounds = SoundPlayer()
        self.robot = create_robot(port=ROBOT_PORT, baud=ROBOT_BAUD)
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

    def on_connect(self, client, userdata, flags, rc) -> None:
        if rc == 0:
            client.subscribe(COMMAND_TOPIC)
            client.subscribe("robot/servo/oy")
            client.subscribe("robot/servo/oz")
            client.subscribe(MODE_TOPIC)
            client.subscribe(OBSTACLE_TOPIC)
            client.subscribe(FIRE_POS_TOPIC)
            client.subscribe(HUMAN_POS_TOPIC)
            self.publish_status("online")
            print("Motion worker online - manual + auto modes ready")
        else:
            print(f"Motion worker MQTT error rc={rc}")

    def on_message(self, client, userdata, msg) -> None:
        payload = msg.payload.decode("utf-8", errors="ignore").strip()
        topic = msg.topic

        # --- auto-mode signals: set shared flags only; no serial in this thread ---
        if topic == MODE_TOPIC:
            if payload in ("manual", "auto"):
                self.mode = payload
                print(f"Mode -> {payload}")
            return

        if topic == OBSTACLE_TOPIC:
            self.obstacle = payload == "1"
            return

        if topic == FIRE_POS_TOPIC:
            self.target_fire = self._parse_target(payload)
            return

        if topic == HUMAN_POS_TOPIC:
            self.target_human = self._parse_target(payload)
            return

        if topic in ("robot/servo/oy", "robot/servo/oz"):
            axis = "oy" if topic == "robot/servo/oy" else "oz"
            self.commands.put(f"servo:{axis}:{payload}")
            return

        command = normalize_command(payload)
        if command is None:
            print(f"Unknown motion command ignored: {payload}")
            self.publish_event(f"unknown:{payload}")
            return

        print(f"Motion command queued: {payload} -> {command}")
        self.commands.put(command)

    def run(self) -> None:
        self.client.connect(MQTT_HOST, MQTT_PORT, 60)
        self.client.loop_start()

        try:
            while not self.stop_event.is_set():
                self.apply_mode_change()
                self.handle_pending_commands(block=self.should_block())
                self.apply_mode_change()

                if self.mode == "auto":
                    self.run_auto_step()
                elif self.drive_mode == "motors":
                    pass  # motors latch until the next command; nothing to pulse
                elif self.active_direction:
                    self.phase_index = self.robot.run_phase(
                        self.active_direction,
                        self.phase_index,
                        step_time_ms=self.step_time_ms,
                        height=self.walk_height,
                        ground_knee=compute_ground_knee(self.walk_height),
                        lift_knee=compute_lift_knee(self.walk_height),
                        lift_ankle=compute_lift_ankle(self.walk_height),
                    )
        finally:
            self.shutdown()

    # ------------------------------------------------------------------
    # Auto mode (autonomous patrol)
    # ------------------------------------------------------------------

    def should_block(self) -> bool:
        """Block waiting for a command only when idle in manual mode."""
        if self.mode == "auto":
            return False
        if self.drive_mode == "motors":
            return True  # the motors run on their own; just wait for the next command
        return not self.active_direction

    def apply_mode_change(self) -> None:
        """React (on the main thread) to a mode flip set by the MQTT thread."""
        if self.mode == self._applied_mode:
            return

        new_mode = self.mode
        self.active_direction = None
        self._auto_dir = None
        self.phase_index = 0
        # A mode flip is the operator taking control: drop any pending alert halt.
        if self._alert_kind is not None:
            self.publish_event("alert:clear")
        self._alert_kind = None
        self._alert_granted = False
        # drive_mode (legs/motors) is preserved across the switch — halt whatever
        # is moving and settle into the posture that drive_mode wants.
        self._motor_stop()
        self.sounds.stop_loop()
        self.sounds.play("mode")
        if new_mode == "auto":
            self._scan_dir = 1
            self._scan_ts = 0.0
            self.move_head("oz", PAN_CENTER)   # face forward, then start sweeping
            self._settle_posture()
            self.publish_event("mode:auto")
            print(f"AUTO mode engaged ({self.drive_mode}) - patrol + scan")
        else:
            self._settle_posture()
            self.publish_event("mode:manual")
            print(f"MANUAL mode engaged ({self.drive_mode})")
        self._applied_mode = new_mode

    def _settle_posture(self) -> None:
        """Stationary posture for the current drive mode: stand on legs, or tuck
        the legs up so the robot rests on its wheels for motor driving."""
        if self.drive_mode == "motors":
            self.robot.legs_up(time_ms=ROBOT_SETTLE_TIME_MS)
        else:
            self.robot.stand(
                time_ms=ROBOT_SETTLE_TIME_MS,
                height=self.walk_height,
                ground_knee=compute_ground_knee(self.walk_height),
            )

    def _motor_drive(self, direction: str) -> None:
        """Drive the DC motors and remember the latched direction."""
        self._motor_dir = direction
        self.motors.drive(direction)

    def _motor_stop(self) -> None:
        self._motor_dir = None
        self.motors.stop()

    def run_auto_step(self) -> None:
        """One iteration of the autonomous behaviour (paced by the gait phase)."""
        now = time.time()
        target = self.fresh_target(now)
        if target is not None:
            self._alert_seen_ts = now

        # 0) Alert flow: the FIRST sight of a fire/human halts the robot and raises
        #    a big dashboard alert. It freezes completely (body AND head) until
        #    the operator grants movement with `auto:resume`.
        if target is not None and self._alert_kind is None and not self._alert_granted:
            self._alert_kind = target["kind"]
            self.halt_movement()
            self.sounds.play("alert")
            self.publish_event(f"alert:{target['kind']}")
            print(f"ALERT: {target['kind']} detected - halted, waiting for operator")

        if self._alert_kind is not None and not self._alert_granted:
            # Parked: freeze completely — no walking, no head movement, nothing.
            # Only the operator releases the robot (auto:resume or a flip to
            # manual); the halt does NOT expire on its own, even if the target
            # walks out of the camera's view.
            time.sleep(AUTO_MOTOR_TICK_S)
            return

        # Operator-approved episode over (target lost long enough): re-arm alerts.
        if self._alert_granted and now - self._alert_seen_ts > ALERT_CLEAR_S:
            self._alert_kind = None
            self._alert_granted = False
            self.publish_event("alert:clear")

        # 1) Obstacle ahead wins: stop, turn right ~90°, resume on the next iteration.
        if self.obstacle:
            self.auto_turn_right()
            return

        # 2) A fresh, operator-approved human/fire detection: "go to it" — steer
        #    the body toward it and keep the camera on it.
        if target is not None:
            self.approach_target(target)
            return

        # 3) Nothing found: patrol forward and sweep the head to widen the search.
        self.scan_head(now)
        self._locomote("forward")

    def halt_movement(self) -> None:
        """Stop whatever is moving right now, in either drive mode."""
        self._auto_dir = None
        self.phase_index = 0
        self._motor_stop()
        self.sounds.stop_loop()
        if self.drive_mode == "legs":
            self._do_stand()

    def auto_turn_right(self, require_auto: bool = True) -> None:
        """Turn right for auto_turn_ms (the tunable ~90°), then settle. Spins the
        motors in motor mode, or runs the right-turn gait in leg mode."""
        self.publish_event("auto:turn_right")
        self.sounds.start_loop("walk")
        end = time.time() + self.auto_turn_ms / 1000.0

        if self.drive_mode == "motors":
            self._motor_drive("right")
            while time.time() < end and not self.stop_event.is_set():
                if require_auto and self.mode != "auto":
                    break
                time.sleep(0.02)
            self._motor_stop()
        else:
            phase = 0
            while time.time() < end and not self.stop_event.is_set():
                if require_auto and self.mode != "auto":
                    break
                phase = self.robot.run_phase(
                    "right", phase,
                    step_time_ms=self.step_time_ms,
                    height=self.walk_height,
                    ground_knee=compute_ground_knee(self.walk_height),
                    lift_knee=compute_lift_knee(self.walk_height),
                    lift_ankle=compute_lift_ankle(self.walk_height),
                )
            self._do_stand()
        self._auto_dir = None
        if self.mode != "auto":  # manual test_turn: nothing resumes after the turn
            self.sounds.stop_loop()

    def approach_target(self, target: dict) -> None:
        """Steer the body toward a detected target and keep the camera on it."""
        x = target["x"]   # -1 = far left of frame, +1 = far right
        self.point_head_at(x)
        if x < -TARGET_CENTER_TOL:
            self._locomote("left")
        elif x > TARGET_CENTER_TOL:
            self._locomote("right")
        else:
            self._locomote("forward")

    def scan_head(self, now: float) -> None:
        """Sweep the head smoothly across the full pan range while searching.

        Incremental: every auto-loop iteration advances the pan a little from
        wherever the head currently is (so it also resumes seamlessly after
        target-tracking moved it), bouncing at PAN_MIN/PAN_MAX. The step is
        time-based, so the sweep speed is the same whether the loop is paced
        by motor ticks (0.1 s) or by gait phases (up to ~0.7 s)."""
        if not AUTO_HEAD_SCAN:
            return
        dt = min(now - self._scan_ts, 0.8) if self._scan_ts else AUTO_MOTOR_TICK_S
        self._scan_ts = now

        angle = self._pan_angle + self._scan_dir * SCAN_SPEED_DEG_S * dt
        if angle >= PAN_MAX:
            angle, self._scan_dir = PAN_MAX, -1
        elif angle <= PAN_MIN:
            angle, self._scan_dir = PAN_MIN, 1
        # Give the servo the whole interval (plus a margin) to get there, so it
        # glides between updates instead of snapping and holding.
        self.move_head("oz", angle, time_ms=int(dt * 1300))

    def point_head_at(self, x: float) -> None:
        """Proportionally pan the head so the target stays centered in view —
        pan only, the tilt servo is never moved automatically. Small offsets
        inside the deadband are ignored so detection noise doesn't twitch the
        head (and the serial bus isn't spammed when already locked on)."""
        if abs(x) > FOLLOW_DEADBAND:
            angle = self._pan_angle + x * PAN_FOLLOW_GAIN
            self.move_head("oz", max(PAN_MIN, min(PAN_MAX, angle)))

    def _locomote(self, direction: str) -> None:
        """Move one auto-loop step in `direction`, using whichever drive mode is
        active: one gait phase on the legs, or latch the motors (paced by a tick
        so the loop can keep checking obstacle/target/head-scan)."""
        self.sounds.start_loop("walk")
        if self.drive_mode == "motors":
            self._motor_drive(direction)
            time.sleep(AUTO_MOTOR_TICK_S)
        else:
            self._gait_phase(direction)

    def _gait_phase(self, direction: str) -> None:
        """Run one gait phase, resetting the phase counter when direction changes."""
        if direction != self._auto_dir:
            self._auto_dir = direction
            self.phase_index = 0
        self.phase_index = self.robot.run_phase(
            direction, self.phase_index,
            step_time_ms=self.step_time_ms,
            height=self.walk_height,
            ground_knee=compute_ground_knee(self.walk_height),
            lift_knee=compute_lift_knee(self.walk_height),
            lift_ankle=compute_lift_ankle(self.walk_height),
        )

    def fresh_target(self, now: float) -> dict | None:
        """Return the most relevant current target (fire first), or None if stale."""
        for kind, t in (("fire", self.target_fire), ("human", self.target_human)):
            if t and now - t["ts"] <= TARGET_FRESH_S:
                return {"kind": kind, **t}
        return None

    def handle_auto_command(self, command: str) -> None:
        """auto:turn_ms:<N> sets the turn duration; auto:test_turn runs one ~90° turn."""
        parts = command.split(":")
        if len(parts) >= 3 and parts[1] == "turn_ms":
            try:
                self.auto_turn_ms = max(200, min(6000, int(parts[2])))
                print(f"Auto turn duration -> {self.auto_turn_ms} ms")
            except ValueError:
                pass
            return
        if len(parts) >= 2 and parts[1] == "test_turn":
            print("Auto test turn (calibration)")
            self.auto_turn_right(require_auto=False)
            return
        if len(parts) >= 2 and parts[1] == "resume":
            # Operator grants movement after an alert halt (big dashboard alert).
            if self._alert_kind is not None and not self._alert_granted:
                self._alert_granted = True
                self.publish_event("alert:granted")
                print("Operator granted movement - resuming auto behaviour")

    def move_head(self, axis: str, angle: float, time_ms: int = HEAD_MOVE_TIME_MS) -> None:
        """Move a head servo (oy=tilt, oz=pan). Main-thread only (shared serial bus)."""
        angle = max(0, min(180, int(angle)))
        # The wire position differs from the logical angle: tilt gets the mount
        # offset, and both servos are mounted mirrored so the angle is flipped.
        # _pan_angle/_tilt_angle and all pan/tilt logic stay in the logical
        # space the UI and auto-scan/tracking use.
        wire = angle
        if axis == "oy":
            wire = max(0, min(180, angle - HEAD_TILT_UP_OFFSET_DEG))
        servo_id = HEAD_SERVO_OY if axis == "oy" else HEAD_SERVO_OZ
        self.robot.controller.move_servos(
            [LobotServo(servo_id, angle_to_lobot(180 - wire))], max(50, time_ms),
        )
        if axis == "oz":
            self._pan_angle = angle
        else:
            self._tilt_angle = angle

    @staticmethod
    def _parse_target(payload: str) -> dict | None:
        try:
            x_str, y_str = payload.split(",")
            return {"x": float(x_str), "y": float(y_str), "ts": time.time()}
        except (ValueError, IndexError):
            return None

    def handle_pending_commands(self, block: bool) -> None:
        timeout = 0.2 if block else 0

        while True:
            try:
                command = self.commands.get(timeout=timeout)
            except queue.Empty:
                return

            self.execute(command)
            self.commands.task_done()
            timeout = 0

    def execute(self, command: str) -> None:
        print(f"Executing motion command: {command}")
        self.publish_event(command)

        if command.startswith("auto:"):
            self.handle_auto_command(command)
            return

        if command.startswith("servo:"):
            _, axis, value = command.split(":", 2)
            try:
                self.move_head(axis, int(value))
                print(f"Head servo (axis={axis}) -> {value}")
            except (ValueError, IndexError):
                pass
            return

        if command in DRIVE_MODE_COMMANDS:
            self.set_drive_mode(command)
            return

        if command.startswith("start:"):
            if self.mode == "auto":
                return  # the robot drives itself in auto mode — ignore manual drive
            self.sounds.start_loop("walk")
            direction = command.split(":", 1)[1]
            if self.drive_mode == "motors":
                self._motor_drive(direction)  # legs are already lifted; roll on motors
                return
            if direction == self.active_direction:
                return
            self.active_direction = direction
            self.phase_index = 0
            self._do_stand()
            return

        if command.startswith("speed:"):
            try:
                speed = int(command.split(":", 1)[1])
                self.speed = max(SPEED_MIN, min(SPEED_MAX, speed))
                self.step_time_ms = speed_to_step_ms(self.speed)
                self.motors.set_speed(speed_to_duty(self.speed))
                if self.drive_mode == "motors" and self._motor_dir:
                    self._motor_drive(self._motor_dir)  # apply new speed live
                print(f"Speed set to {self.speed} ({self.step_time_ms}ms/phase)")
            except (ValueError, IndexError):
                pass
            return

        if command == "height:up":
            self.walk_height = max(WALK_HEIGHT_MIN, self.walk_height - WALK_HEIGHT_STEP)
            if not self.active_direction:
                self._do_stand()
            return

        if command == "height:down":
            self.walk_height = min(WALK_HEIGHT_MAX, self.walk_height + WALK_HEIGHT_STEP)
            if not self.active_direction:
                self._do_stand()
            return

        handler = self.one_shot_handlers().get(command)
        if handler:
            self.active_direction = None
            was_moving = self.sounds.stop_loop()
            if command == "stand":
                if was_moving:
                    self.sounds.play("stop")
            else:
                self.sounds.play(command)
            handler()

    def one_shot_handlers(self):
        return {
            "hi": self.say_hi,
            "stand": self.stand,
            "bow": self.bow,
            "shake": self.shake,
            "wave": self.wave,
            "bounce": self.bounce,
            "sway": self.sway,
            "tiptoe": self.tiptoe,
            "ripple": self.ripple,
            "pulse": self.pulse,
        }

    def say_hi(self) -> None:
        self.robot.say_hi(time_ms=ROBOT_MOVE_TIME_MS)

    def stand(self) -> None:
        self.phase_index = 0
        if self.drive_mode == "motors":
            self._motor_stop()  # d-pad release halts the motors; legs stay tucked
            return
        self._do_stand()

    def set_drive_mode(self, mode: str) -> None:
        """Switch forward/back/left/right between the tripod gait and the DC
        motors. Works in manual or auto. Entering motor mode lifts the legs;
        leaving it lowers them back to a stand."""
        if mode == self.drive_mode:
            return
        self.active_direction = None
        self._auto_dir = None
        self.phase_index = 0
        self._motor_stop()
        self.sounds.stop_loop()
        self.sounds.play("mode")
        self.drive_mode = mode
        self._settle_posture()
        print(f"Drive mode -> {mode.upper()}")
        self.publish_event(f"drive_mode:{mode}")

    def _do_stand(self) -> None:
        self.robot.stand(
            time_ms=ROBOT_STAND_TIME_MS,
            height=self.walk_height,
            ground_knee=compute_ground_knee(self.walk_height),
        )

    def bow(self) -> None:
        self.robot.bow(time_ms=ROBOT_MOVE_TIME_MS)

    def shake(self) -> None:
        self.robot.shake()

    def wave(self) -> None:
        self.robot.wave()

    def bounce(self) -> None:
        self.robot.bounce()

    def sway(self) -> None:
        self.robot.sway()

    def tiptoe(self) -> None:
        self.robot.tiptoe()

    def ripple(self) -> None:
        self.robot.ripple()

    def pulse(self) -> None:
        self.robot.pulse()

    def publish_status(self, status: str) -> None:
        self.client.publish(STATUS_TOPIC, status)

    def publish_event(self, event: str) -> None:
        self.client.publish(EVENT_TOPIC, event)

    def request_stop(self) -> None:
        self.stop_event.set()

    def shutdown(self) -> None:
        try:
            self.sounds.stop_all()
            self.publish_status("offline")
            self.motors.close()
            self.robot.stop()
            self.robot.close()
            self.client.loop_stop()
            self.client.disconnect()
        except Exception as exc:
            print(f"Motion worker shutdown warning: {exc}")


def normalize_command(value: str) -> str | None:
    command = alias(value)

    # Auto-mode commands carry an underscore (auto:turn_ms / auto:test_turn) and must
    # not be mangled by the height-style "_" -> ":" rewrite below.
    if command.startswith("auto:"):
        return command

    command = command.replace("_", ":")

    if command in HEIGHT_COMMANDS:
        return command

    if command.startswith("speed:"):
        try:
            val = int(command.split(":", 1)[1])
            if SPEED_MIN <= val <= SPEED_MAX:
                return command
        except (ValueError, IndexError):
            pass
        return None

    if command.startswith(COMMAND_PREFIXES):
        direction = alias(command.split(":", 1)[1])
        if direction in DRIVE_COMMANDS:
            return f"start:{direction}"
        return None

    if command in DRIVE_COMMANDS:
        return f"start:{command}"

    if command in DRIVE_MODE_COMMANDS:
        return command

    if command in ONE_SHOT_COMMANDS:
        return command

    return None


def alias(value: str) -> str:
    command = value.strip().lower()
    return COMMAND_ALIASES.get(command, COMMAND_ALIASES.get(command.replace(":", "_"), command))


def main() -> None:
    worker = MotionWorker()

    def stop_worker(signum, frame) -> None:
        worker.request_stop()

    signal.signal(signal.SIGINT, stop_worker)
    signal.signal(signal.SIGTERM, stop_worker)

    try:
        worker.run()
    except KeyboardInterrupt:
        worker.request_stop()


if __name__ == "__main__":
    main()
