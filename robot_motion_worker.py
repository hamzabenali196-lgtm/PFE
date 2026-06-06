# -*- coding: utf-8 -*-
from __future__ import annotations

import queue
import signal
import threading

import paho.mqtt.client as mqtt

from robot_controller import RUN_STEP_TIME_MS, create_robot


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

ONE_SHOT_COMMANDS = {
    "hi",
    "stand",
}


class MotionWorker:
    def __init__(self) -> None:
        self.commands: queue.Queue[str] = queue.Queue()
        self.stop_event = threading.Event()
        self.active_direction: str | None = None
        self.phase_index = 0
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
                        step_time_ms=ROBOT_STEP_TIME_MS,
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
            self.robot.stand(time_ms=ROBOT_STAND_TIME_MS)
            return

        handler = self.one_shot_handlers().get(command)
        if handler:
            self.active_direction = None
            handler()

    def one_shot_handlers(self):
        return {
            "hi": self.say_hi,
            "stand": self.stand,
        }

    def say_hi(self) -> None:
        self.robot.say_hi(time_ms=ROBOT_MOVE_TIME_MS)

    def stand(self) -> None:
        self.phase_index = 0
        self.robot.stand(time_ms=ROBOT_STAND_TIME_MS)

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
