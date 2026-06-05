from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterable, Mapping

from lobot_controller import LobotController, LobotServo


CENTER = 1500
STAND_HEIGHT = 1300
LEG_UP = 1100
HIP_BACK = 1350
HIP_FRONT = 1650
STEP_TIME_MS = 500
RUN_STEP_TIME_MS = 250
MOVE_EXTRA_WAIT_MS = 20


@dataclass(frozen=True)
class LegConfig:
    """Servo ids for one physical leg."""

    name: str
    hip: int
    knee: int
    ankle: int


@dataclass(frozen=True)
class LegPose:
    """Target positions for one leg. Use None to leave one joint unchanged."""

    hip: int | None = None
    knee: int | None = None
    ankle: int | None = None


# Change servo ids or leg names here when the wiring changes.
DEFAULT_LEGS: dict[str, LegConfig] = {
    "leg_1": LegConfig("leg_1", hip=1, knee=2, ankle=3),
    "leg_2": LegConfig("leg_2", hip=4, knee=5, ankle=6),
    "leg_3": LegConfig("leg_3", hip=7, knee=8, ankle=9),
    "leg_4": LegConfig("leg_4", hip=10, knee=11, ankle=12),
    "leg_5": LegConfig("leg_5", hip=13, knee=14, ankle=15),
    "leg_6": LegConfig("leg_6", hip=16, knee=17, ankle=18),
}

# Hiwonder action:
# hip stays centered, second servo looks up, third servo looks down.
HIWONDER_LOOK_POSE = LegPose(hip=CENTER, knee=500, ankle=500)

TRIPOD_A = ("leg_1", "leg_3", "leg_5")
TRIPOD_B = ("leg_2", "leg_4", "leg_6")

# Change these if your physical left/right sides are wired differently.
LEFT_LEGS = ("leg_1", "leg_2", "leg_3")
RIGHT_LEGS = ("leg_4", "leg_5", "leg_6")


class Leg:
    def __init__(self, config: LegConfig):
        self.config = config

    @property
    def name(self) -> str:
        return self.config.name

    def servos_for(self, pose: LegPose) -> list[LobotServo]:
        servos: list[LobotServo] = []

        if pose.hip is not None:
            servos.append(LobotServo(self.config.hip, pose.hip))
        if pose.knee is not None:
            servos.append(LobotServo(self.config.knee, pose.knee))
        if pose.ankle is not None:
            servos.append(LobotServo(self.config.ankle, pose.ankle))

        return servos


class SpiderRobotController:
    """High-level spider robot movement without servo inversion."""

    def __init__(
        self,
        controller: LobotController,
        legs: Mapping[str, LegConfig] = DEFAULT_LEGS,
    ):
        self.controller = controller
        self.legs = {name: Leg(config) for name, config in legs.items()}

    def move_leg(
        self,
        leg_name: str,
        pose: LegPose,
        time_ms: int = 500,
        wait: bool = True,
    ) -> None:
        self.move_legs({leg_name: pose}, time_ms=time_ms, wait=wait)

    def move_legs(
        self,
        poses: Mapping[str, LegPose],
        time_ms: int = 500,
        wait: bool = True,
    ) -> None:
        servos: list[LobotServo] = []

        for leg_name, pose in poses.items():
            leg = self._leg(leg_name)
            servos.extend(leg.servos_for(pose))

        if not servos:
            return

        self.controller.move_servos(servos, time_ms)
        if wait:
            self.wait_for_move(time_ms)

    def move_all(self, pose: LegPose, time_ms: int = 500, wait: bool = True) -> None:
        self.move_legs(
            {leg_name: pose for leg_name in self.legs},
            time_ms=time_ms,
            wait=wait,
        )

    def center_all(self, time_ms: int = 700) -> None:
        self.move_all(LegPose(CENTER, CENTER, CENTER), time_ms=time_ms)

    def stand(self, time_ms: int = 700, height: int = STAND_HEIGHT) -> None:
        self.move_all(LegPose(CENTER, CENTER, height), time_ms=time_ms)

    def hiwonder_look_pose(self, time_ms: int = 700) -> None:
        self.move_all(HIWONDER_LOOK_POSE, time_ms=time_ms)

    def say_hi(
        self,
        leg_name: str = "leg_6",
        waves: int = 4,
        time_ms: int = 500,
    ) -> None:
        self.stand(time_ms=time_ms)
        self.move_leg(leg_name, LegPose(CENTER, 1200, 1200), time_ms=time_ms)

        for _ in range(waves):
            self.move_leg(leg_name, LegPose(1150, 1200, 1200), time_ms=300)
            self.move_leg(leg_name, LegPose(1850, 1200, 1200), time_ms=300)

        self.move_leg(leg_name, LegPose(CENTER, CENTER, STAND_HEIGHT), time_ms=time_ms)

    def walk_forward(
        self,
        steps: int = 1,
        step_time_ms: int = STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        for _ in range(steps):
            self._lift(TRIPOD_A, step_time_ms)
            self._swing(TRIPOD_A, HIP_FRONT, TRIPOD_B, HIP_BACK, step_time_ms)
            self._lower(TRIPOD_A, height, step_time_ms)

            self._lift(TRIPOD_B, step_time_ms)
            self._swing(TRIPOD_B, HIP_FRONT, TRIPOD_A, HIP_BACK, step_time_ms)
            self._lower(TRIPOD_B, height, step_time_ms)

    def walk_backward(
        self,
        steps: int = 1,
        step_time_ms: int = STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        for _ in range(steps):
            self._lift(TRIPOD_A, step_time_ms)
            self._swing(TRIPOD_A, HIP_BACK, TRIPOD_B, HIP_FRONT, step_time_ms)
            self._lower(TRIPOD_A, height, step_time_ms)

            self._lift(TRIPOD_B, step_time_ms)
            self._swing(TRIPOD_B, HIP_BACK, TRIPOD_A, HIP_FRONT, step_time_ms)
            self._lower(TRIPOD_B, height, step_time_ms)

    def run_forward(
        self,
        steps: int = 1,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self.walk_forward(steps=steps, step_time_ms=step_time_ms, height=height)

    def run_backward(
        self,
        steps: int = 1,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self.walk_backward(steps=steps, step_time_ms=step_time_ms, height=height)

    def run_phase(
        self,
        direction: str,
        phase_index: int,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> int:
        phases = self._movement_phases(direction, step_time_ms, height)
        phase = phases[phase_index % len(phases)]
        phase()
        return (phase_index + 1) % len(phases)

    def turn_left(
        self,
        steps: int = 1,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self._turn(
            steps,
            left_position=HIP_BACK,
            right_position=HIP_FRONT,
            step_time_ms=step_time_ms,
            height=height,
        )

    def turn_right(
        self,
        steps: int = 1,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self._turn(
            steps,
            left_position=HIP_FRONT,
            right_position=HIP_BACK,
            step_time_ms=step_time_ms,
            height=height,
        )

    def stop(self) -> None:
        self.controller.stop_action_group()

    def close(self) -> None:
        self.controller.close()

    def wait_for_move(self, time_ms: int, extra_ms: int = MOVE_EXTRA_WAIT_MS) -> None:
        time.sleep((time_ms + extra_ms) / 1000.0)

    def _leg(self, leg_name: str) -> Leg:
        try:
            return self.legs[leg_name]
        except KeyError as exc:
            valid_names = ", ".join(self.legs)
            raise ValueError(f"Unknown leg '{leg_name}'. Valid legs: {valid_names}") from exc

    def _pose_for(self, leg_names: Iterable[str], pose: LegPose) -> dict[str, LegPose]:
        return {leg_name: pose for leg_name in leg_names}

    def _lift(self, leg_names: Iterable[str], time_ms: int) -> None:
        self.move_legs(self._pose_for(leg_names, LegPose(knee=LEG_UP, ankle=LEG_UP)), time_ms)

    def _lower(self, leg_names: Iterable[str], height: int, time_ms: int) -> None:
        self.move_legs(self._pose_for(leg_names, LegPose(knee=CENTER, ankle=height)), time_ms)

    def _swing(
        self,
        front_legs: Iterable[str],
        front_position: int,
        back_legs: Iterable[str],
        back_position: int,
        time_ms: int,
    ) -> None:
        poses = self._pose_for(front_legs, LegPose(hip=front_position))
        poses.update(self._pose_for(back_legs, LegPose(hip=back_position)))
        self.move_legs(poses, time_ms)

    def _turn(
        self,
        steps: int,
        left_position: int,
        right_position: int,
        step_time_ms: int,
        height: int,
    ) -> None:
        for _ in range(steps):
            self._lift(TRIPOD_A, step_time_ms)
            self._turn_swing(TRIPOD_A, left_position, right_position, step_time_ms)
            self._lower(TRIPOD_A, height, step_time_ms)

            self._lift(TRIPOD_B, step_time_ms)
            self._turn_swing(TRIPOD_B, left_position, right_position, step_time_ms)
            self._lower(TRIPOD_B, height, step_time_ms)

    def _turn_swing(
        self,
        leg_names: Iterable[str],
        left_position: int,
        right_position: int,
        time_ms: int,
    ) -> None:
        left = set(LEFT_LEGS)
        right = set(RIGHT_LEGS)
        poses: dict[str, LegPose] = {}

        for leg_name in leg_names:
            if leg_name in left:
                poses[leg_name] = LegPose(hip=left_position)
            elif leg_name in right:
                poses[leg_name] = LegPose(hip=right_position)
            else:
                poses[leg_name] = LegPose(hip=CENTER)

        self.move_legs(poses, time_ms)

    def _movement_phases(self, direction: str, step_time_ms: int, height: int) -> list:
        if direction == "run":
            return [
                lambda: self._lift(TRIPOD_A, step_time_ms),
                lambda: self._swing(TRIPOD_A, HIP_FRONT, TRIPOD_B, HIP_BACK, step_time_ms),
                lambda: self._lower(TRIPOD_A, height, step_time_ms),
                lambda: self._lift(TRIPOD_B, step_time_ms),
                lambda: self._swing(TRIPOD_B, HIP_FRONT, TRIPOD_A, HIP_BACK, step_time_ms),
                lambda: self._lower(TRIPOD_B, height, step_time_ms),
            ]

        if direction == "backward":
            return [
                lambda: self._lift(TRIPOD_A, step_time_ms),
                lambda: self._swing(TRIPOD_A, HIP_BACK, TRIPOD_B, HIP_FRONT, step_time_ms),
                lambda: self._lower(TRIPOD_A, height, step_time_ms),
                lambda: self._lift(TRIPOD_B, step_time_ms),
                lambda: self._swing(TRIPOD_B, HIP_BACK, TRIPOD_A, HIP_FRONT, step_time_ms),
                lambda: self._lower(TRIPOD_B, height, step_time_ms),
            ]

        if direction == "left":
            return [
                lambda: self._lift(TRIPOD_A, step_time_ms),
                lambda: self._turn_swing(TRIPOD_A, HIP_BACK, HIP_FRONT, step_time_ms),
                lambda: self._lower(TRIPOD_A, height, step_time_ms),
                lambda: self._lift(TRIPOD_B, step_time_ms),
                lambda: self._turn_swing(TRIPOD_B, HIP_BACK, HIP_FRONT, step_time_ms),
                lambda: self._lower(TRIPOD_B, height, step_time_ms),
            ]

        if direction == "right":
            return [
                lambda: self._lift(TRIPOD_A, step_time_ms),
                lambda: self._turn_swing(TRIPOD_A, HIP_FRONT, HIP_BACK, step_time_ms),
                lambda: self._lower(TRIPOD_A, height, step_time_ms),
                lambda: self._lift(TRIPOD_B, step_time_ms),
                lambda: self._turn_swing(TRIPOD_B, HIP_FRONT, HIP_BACK, step_time_ms),
                lambda: self._lower(TRIPOD_B, height, step_time_ms),
            ]

        raise ValueError(f"Unknown movement direction '{direction}'")


RobotController = SpiderRobotController


def create_robot(port: str = "/dev/ttyAMA0", baud: int = 9600) -> SpiderRobotController:
    return SpiderRobotController(LobotController(port=port, baud=baud))


# Change these values, then press Run.
RUN_PORT = "/dev/ttyAMA0"
RUN_BAUD = 9600
RUN_ACTION = "left"
RUN_LEG = "leg_6"
RUN_STEPS = 1
RUN_LOOP = True
RUN_MOVE_TIME_MS = 250
RUN_DELAY_SECONDS = 0.0


def prepare_action(robot: SpiderRobotController) -> None:
    if RUN_ACTION in ("walk", "run", "running", "backward", "run_backward", "left", "right"):
        robot.stand(time_ms=RUN_MOVE_TIME_MS)


def run_action(robot: SpiderRobotController) -> None:
    if RUN_ACTION == "center":
        robot.center_all(time_ms=RUN_MOVE_TIME_MS)
    elif RUN_ACTION == "stand":
        robot.stand(time_ms=RUN_MOVE_TIME_MS)
    elif RUN_ACTION in ("hiwonder", "look"):
        robot.hiwonder_look_pose(time_ms=RUN_MOVE_TIME_MS)
    elif RUN_ACTION == "hi":
        robot.say_hi(leg_name=RUN_LEG, time_ms=RUN_MOVE_TIME_MS)
    elif RUN_ACTION == "walk":
        robot.walk_forward(steps=RUN_STEPS)
    elif RUN_ACTION in ("run", "running"):
        robot.run_forward(steps=RUN_STEPS)
    elif RUN_ACTION == "backward":
        robot.walk_backward(steps=RUN_STEPS)
    elif RUN_ACTION == "run_backward":
        robot.run_backward(steps=RUN_STEPS)
    elif RUN_ACTION == "left":
        robot.turn_left(steps=RUN_STEPS)
    elif RUN_ACTION == "right":
        robot.turn_right(steps=RUN_STEPS)
    else:
        valid_actions = "center, stand, hiwonder, look, hi, walk, run, backward, run_backward, left, right"
        raise ValueError(f"Unknown RUN_ACTION '{RUN_ACTION}'. Use one of: {valid_actions}")


def main() -> None:
    robot = create_robot(port=RUN_PORT, baud=RUN_BAUD)
    try:
        prepare_action(robot)
        if RUN_LOOP:
            while True:
                run_action(robot)
                time.sleep(RUN_DELAY_SECONDS)
        else:
            run_action(robot)
    except KeyboardInterrupt:
        print("Stopping robot controller...")
    finally:
        robot.stop()
        robot.close()


if __name__ == "__main__":
    main()
