# -*- coding: utf-8 -*-
from __future__ import annotations

import queue
import signal
import threading

import paho.mqtt.client as mqtt

from robot_controller import (
    ANKLE_LIFT, KNEE_GROUND, KNEE_LIFT, RUN_STEP_TIME_MS, STAND_HEIGHT, create_robot,
)


MQTT_HOST = "localhost"
MQTT_PORT = 1883
ROBOT_PORT = "/dev/ttyAMA0"
ROBOT_BAUD = 9600
ROBOT_MOVE_TIME_MS = 250
ROBOT_STAND_TIME_MS = 120
ROBOT_STEP_TIME_MS = RUN_STEP_TIME_MS

COMMAND_TOPIC = "robot/command"
STATUS_TOPIC = "robot/motion/status"
EVENT_TOPIC = "robot/motion/event"

SPEED_DEFAULT = 5
SPEED_MIN = 1
SPEED_MAX = 10
SPEED_STEP_TIME_MAX_MS = 700  # slowest (speed=1)
SPEED_STEP_TIME_MIN_MS = 120  # fastest (speed=10)


def speed_to_step_ms(speed: int) -> int:
    frac = (speed - 1) / (SPEED_MAX - SPEED_MIN)
    return int(SPEED_STEP_TIME_MAX_MS - frac * (SPEED_STEP_TIME_MAX_MS - SPEED_STEP_TIME_MIN_MS))


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


class MotionWorker:
    def __init__(self) -> None:
        self.commands: queue.Queue[str] = queue.Queue()
        self.stop_event = threading.Event()
        self.active_direction: str | None = None
        self.phase_index = 0
        self.walk_height = WALK_HEIGHT_DEFAULT
        self.speed = SPEED_DEFAULT
        self.step_time_ms = speed_to_step_ms(SPEED_DEFAULT)
        self.robot = create_robot(port=ROBOT_PORT, baud=ROBOT_BAUD)
        self.client = mqtt.Client()
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

    def on_connect(self, client, userdata, flags, rc) -> None:
        if rc == 0:
            client.subscribe(COMMAND_TOPIC)
            self.publish_status("online")
            print("Motion worker online - waiting for robot/command")
        else:
            print(f"Motion worker MQTT error rc={rc}")

    def on_message(self, client, userdata, msg) -> None:
        payload = msg.payload.decode("utf-8", errors="ignore").strip()
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
                self.handle_pending_commands(block=not self.active_direction)

                if self.active_direction:
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

        if command.startswith("start:"):
            direction = command.split(":", 1)[1]
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
        self._do_stand()

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
            self.publish_status("offline")
            self.robot.stop()
            self.robot.close()
            self.client.loop_stop()
            self.client.disconnect()
        except Exception as exc:
            print(f"Motion worker shutdown warning: {exc}")


def normalize_command(value: str) -> str | None:
    command = alias(value)
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
