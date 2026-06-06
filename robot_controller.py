from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Iterable, Mapping

from lobot_controller import LobotController, LobotServo


# ---------------------------------------------------------------------------
# Servo position constants
# ---------------------------------------------------------------------------

CENTER = 1500
STAND_HEIGHT = 1300
MOVE_EXTRA_WAIT_MS = 20

# Gait timing
STEP_TIME_MS = 600
RUN_STEP_TIME_MS = 300

# Hip travel for walking/running
HIP_NEUTRAL = CENTER
HIP_STEP_FORWARD = 1750
HIP_STEP_BACK = 1250
MIRROR_RIGHT_HIPS = True

# Legacy aliases kept so external code can keep importing old names.
HIP_FRONT = HIP_STEP_FORWARD
HIP_BACK = HIP_STEP_BACK

# Lift geometry: knee and ankle rise together so the foot clears the ground.
KNEE_LIFT = 900
ANKLE_LIFT = 800
KNEE_GROUND = CENTER
LEG_UP = KNEE_LIFT

# Hiwonder "look" pose
HIWONDER_LOOK_POSE_PARAMS = dict(hip=CENTER, knee=500, ankle=500)


# ---------------------------------------------------------------------------
# Robot layout
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LegConfig:
    """Servo IDs for one physical leg."""

    name: str
    hip: int
    knee: int
    ankle: int


@dataclass(frozen=True)
class LegPose:
    """
    Target positions for one leg.
    Use None for a joint that should stay unchanged.
    """

    hip: int | None = None
    knee: int | None = None
    ankle: int | None = None


# Change servo IDs here when wiring changes.
DEFAULT_LEGS: dict[str, LegConfig] = {
    "leg_1": LegConfig("leg_1", hip=1, knee=2, ankle=3),
    "leg_2": LegConfig("leg_2", hip=4, knee=5, ankle=6),
    "leg_3": LegConfig("leg_3", hip=7, knee=8, ankle=9),
    "leg_4": LegConfig("leg_4", hip=10, knee=11, ankle=12),
    "leg_5": LegConfig("leg_5", hip=13, knee=14, ankle=15),
    "leg_6": LegConfig("leg_6", hip=16, knee=17, ankle=18),
}

# Tripod groupings
TRIPOD_A = ("leg_1", "leg_3", "leg_5")
TRIPOD_B = ("leg_2", "leg_4", "leg_6")

# Left / right sides used for turning.
LEFT_LEGS = ("leg_1", "leg_2", "leg_3")
RIGHT_LEGS = ("leg_4", "leg_5", "leg_6")
LEFT_LEG_SET = frozenset(LEFT_LEGS)
RIGHT_LEG_SET = frozenset(RIGHT_LEGS)

HIWONDER_LOOK_POSE = LegPose(**HIWONDER_LOOK_POSE_PARAMS)
HIP_FORWARD_TARGET = "forward"
HIP_BACK_TARGET = "back"
HIP_NEUTRAL_TARGET = "neutral"
HipTarget = int | str | None


# ---------------------------------------------------------------------------
# Motion plans
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GroupPose:
    """Pose applied to a group of legs inside one movement phase."""

    legs: tuple[str, ...]
    hip: HipTarget = None
    knee: int | None = None
    ankle: int | None = None
    use_ground_height: bool = False

    def pose_for(self, leg_name: str, height: int) -> LegPose:
        ankle = height if self.use_ground_height else self.ankle
        return LegPose(
            hip=self._hip_for(leg_name),
            knee=self.knee,
            ankle=ankle,
        )

    def _hip_for(self, leg_name: str) -> int | None:
        if self.hip is None:
            return None
        if isinstance(self.hip, int):
            return self.hip
        if self.hip == HIP_NEUTRAL_TARGET:
            return HIP_NEUTRAL
        if self.hip == HIP_FORWARD_TARGET:
            return _forward_hip_for(leg_name)
        if self.hip == HIP_BACK_TARGET:
            return _back_hip_for(leg_name)
        raise ValueError(f"Unknown hip target '{self.hip}'")


@dataclass(frozen=True)
class PosePhase:
    """One explicit gait phase made from group poses."""

    name: str
    groups: tuple[GroupPose, ...]

    def poses(self, leg_names: Iterable[str], height: int) -> dict[str, LegPose]:
        poses: dict[str, LegPose] = {}

        for group in self.groups:
            for leg_name in group.legs:
                poses[leg_name] = _merge_pose(
                    poses.get(leg_name),
                    group.pose_for(leg_name, height),
                )

        return poses


@dataclass(frozen=True)
class TripodPhase:
    """
    One simultaneous straight movement.

    The lifting tripod swings to a new hip position while raised.
    The pushing tripod stays grounded and drives the body with its hips.
    """

    name: str
    lifting: tuple[str, ...]
    pushing: tuple[str, ...]
    lifted_hip: int
    push_hip: int

    def poses(self, leg_names: Iterable[str], height: int) -> dict[str, LegPose]:
        poses: dict[str, LegPose] = {}

        for leg_name in self.lifting:
            poses[leg_name] = LegPose(
                hip=self.lifted_hip,
                knee=KNEE_LIFT,
                ankle=ANKLE_LIFT,
            )

        for leg_name in self.pushing:
            poses[leg_name] = LegPose(
                hip=self.push_hip,
                knee=KNEE_GROUND,
                ankle=height,
            )

        return poses


@dataclass(frozen=True)
class TurnPhase:
    """
    One simultaneous turning movement.

    Left and right side hips move in opposite directions. The lifted tripod
    swings, while the grounded tripod applies the mirrored pressure.
    """

    name: str
    lifting: tuple[str, ...]
    pushing: tuple[str, ...]
    left_position: int
    right_position: int

    def poses(self, leg_names: Iterable[str], height: int) -> dict[str, LegPose]:
        poses: dict[str, LegPose] = {}

        for leg_name in self.lifting:
            poses[leg_name] = LegPose(
                hip=self._lifted_hip(leg_name),
                knee=KNEE_LIFT,
                ankle=ANKLE_LIFT,
            )

        for leg_name in self.pushing:
            poses[leg_name] = LegPose(
                hip=self._pushing_hip(leg_name),
                knee=KNEE_GROUND,
                ankle=height,
            )

        return poses

    def _lifted_hip(self, leg_name: str) -> int:
        if leg_name in LEFT_LEG_SET:
            return self.left_position
        if leg_name in RIGHT_LEG_SET:
            return self.right_position
        return HIP_NEUTRAL

    def _pushing_hip(self, leg_name: str) -> int:
        if leg_name in LEFT_LEG_SET:
            return self.right_position
        if leg_name in RIGHT_LEG_SET:
            return self.left_position
        return HIP_NEUTRAL


@dataclass(frozen=True)
class ResetPhase:
    """Ground every leg and return all hips to neutral."""

    name: str = "reset"

    def poses(self, leg_names: Iterable[str], height: int) -> dict[str, LegPose]:
        return {
            leg_name: LegPose(hip=HIP_NEUTRAL, knee=KNEE_GROUND, ankle=height)
            for leg_name in leg_names
        }


def _forward_hip_for(leg_name: str) -> int:
    if MIRROR_RIGHT_HIPS and leg_name in RIGHT_LEG_SET:
        return HIP_STEP_BACK
    return HIP_STEP_FORWARD


def _back_hip_for(leg_name: str) -> int:
    if MIRROR_RIGHT_HIPS and leg_name in RIGHT_LEG_SET:
        return HIP_STEP_FORWARD
    return HIP_STEP_BACK


def _merge_pose(existing: LegPose | None, update: LegPose) -> LegPose:
    if existing is None:
        return update

    return LegPose(
        hip=update.hip if update.hip is not None else existing.hip,
        knee=update.knee if update.knee is not None else existing.knee,
        ankle=update.ankle if update.ankle is not None else existing.ankle,
    )


MotionPhase = PosePhase | TripodPhase | TurnPhase | ResetPhase
RESET_PHASE = ResetPhase()


@dataclass(frozen=True)
class MotionPlan:
    """A named movement made from reusable simultaneous phases."""

    name: str
    phases: tuple[MotionPhase, ...]
    reset_after_complete: bool = True

    def streaming_phases(self) -> tuple[MotionPhase, ...]:
        return self.phases


class MovementLibrary:
    """
    Declarative gait catalog.

    To tune or add movement, prefer changing/adding a plan here before touching
    the controller execution code below.
    """

    def __init__(
        self,
        tripod_a: Iterable[str] = TRIPOD_A,
        tripod_b: Iterable[str] = TRIPOD_B,
    ) -> None:
        self.tripod_a = tuple(tripod_a)
        self.tripod_b = tuple(tripod_b)
        self._plans = self._build_plans()

    def plan(self, direction: str) -> MotionPlan:
        key = direction.strip().lower()
        try:
            return self._plans[key]
        except KeyError as exc:
            valid = ", ".join(sorted(self._plans))
            raise ValueError(f"Unknown movement direction '{direction}'. Use one of: {valid}") from exc

    def straight_plan(self, name: str, lifted_hip: HipTarget, push_hip: HipTarget) -> MotionPlan:
        return MotionPlan(
            name=name,
            phases=(
                PosePhase(
                    name=f"{name}:lift_a",
                    groups=(
                        GroupPose(
                            legs=self.tripod_a,
                            knee=KNEE_LIFT,
                            ankle=ANKLE_LIFT,
                        ),
                    ),
                ),
                PosePhase(
                    name=f"{name}:swing_a_push_b",
                    groups=(
                        GroupPose(
                            legs=self.tripod_a,
                            hip=lifted_hip,
                            knee=KNEE_LIFT,
                            ankle=ANKLE_LIFT,
                        ),
                        GroupPose(
                            legs=self.tripod_b,
                            hip=push_hip,
                            knee=KNEE_GROUND,
                            use_ground_height=True,
                        ),
                    ),
                ),
                PosePhase(
                    name=f"{name}:plant_a",
                    groups=(
                        GroupPose(
                            legs=self.tripod_a,
                            hip=lifted_hip,
                            knee=KNEE_GROUND,
                            use_ground_height=True,
                        ),
                        GroupPose(
                            legs=self.tripod_b,
                            hip=push_hip,
                            knee=KNEE_GROUND,
                            use_ground_height=True,
                        ),
                    ),
                ),
                PosePhase(
                    name=f"{name}:lift_b",
                    groups=(
                        GroupPose(
                            legs=self.tripod_b,
                            knee=KNEE_LIFT,
                            ankle=ANKLE_LIFT,
                        ),
                    ),
                ),
                PosePhase(
                    name=f"{name}:swing_b_push_a",
                    groups=(
                        GroupPose(
                            legs=self.tripod_b,
                            hip=lifted_hip,
                            knee=KNEE_LIFT,
                            ankle=ANKLE_LIFT,
                        ),
                        GroupPose(
                            legs=self.tripod_a,
                            hip=push_hip,
                            knee=KNEE_GROUND,
                            use_ground_height=True,
                        ),
                    ),
                ),
                PosePhase(
                    name=f"{name}:plant_b",
                    groups=(
                        GroupPose(
                            legs=self.tripod_b,
                            hip=lifted_hip,
                            knee=KNEE_GROUND,
                            use_ground_height=True,
                        ),
                        GroupPose(
                            legs=self.tripod_a,
                            hip=push_hip,
                            knee=KNEE_GROUND,
                            use_ground_height=True,
                        ),
                    ),
                ),
            ),
        )

    def turn_plan(self, name: str, left_position: int, right_position: int) -> MotionPlan:
        return MotionPlan(
            name=name,
            phases=(
                TurnPhase(
                    name=f"{name}:tripod_a",
                    lifting=self.tripod_a,
                    pushing=self.tripod_b,
                    left_position=left_position,
                    right_position=right_position,
                ),
                TurnPhase(
                    name=f"{name}:tripod_b",
                    lifting=self.tripod_b,
                    pushing=self.tripod_a,
                    left_position=left_position,
                    right_position=right_position,
                ),
            ),
        )

    def _build_plans(self) -> dict[str, MotionPlan]:
        forward = self.straight_plan(
            name="forward",
            lifted_hip=HIP_FORWARD_TARGET,
            push_hip=HIP_BACK_TARGET,
        )
        backward = self.straight_plan(
            name="backward",
            lifted_hip=HIP_BACK_TARGET,
            push_hip=HIP_FORWARD_TARGET,
        )
        left = self.turn_plan(
            name="left",
            left_position=HIP_STEP_BACK,
            right_position=HIP_STEP_FORWARD,
        )
        right = self.turn_plan(
            name="right",
            left_position=HIP_STEP_FORWARD,
            right_position=HIP_STEP_BACK,
        )

        return {
            "forward": forward,
            "walk": forward,
            "run": forward,
            "running": forward,
            "backward": backward,
            "run_backward": backward,
            "left": left,
            "right": right,
        }


# ---------------------------------------------------------------------------
# Servo helpers
# ---------------------------------------------------------------------------


class Leg:
    def __init__(self, config: LegConfig):
        self.config = config

    @property
    def name(self) -> str:
        return self.config.name

    def servos_for(self, pose: LegPose) -> list[LobotServo]:
        targets = (
            (self.config.hip, pose.hip),
            (self.config.knee, pose.knee),
            (self.config.ankle, pose.ankle),
        )
        return [
            LobotServo(servo_id, position)
            for servo_id, position in targets
            if position is not None
        ]


# ---------------------------------------------------------------------------
# Main controller
# ---------------------------------------------------------------------------


class SpiderRobotController:
    """
    High-level six-legged robot movement controller.

    Public methods stay simple: stand, walk, turn, say_hi, run_phase.
    Motion details live in MovementLibrary and are executed by one path.
    """

    def __init__(
        self,
        controller: LobotController,
        legs: Mapping[str, LegConfig] | None = None,
        movements: MovementLibrary | None = None,
    ):
        configured_legs = DEFAULT_LEGS if legs is None else legs

        self.controller = controller
        self.legs = {name: Leg(config) for name, config in configured_legs.items()}
        self.movements = MovementLibrary() if movements is None else movements

    # ------------------------------------------------------------------
    # Low-level servo control
    # ------------------------------------------------------------------

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
            servos.extend(self._leg(leg_name).servos_for(pose))

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

    # ------------------------------------------------------------------
    # Utility poses
    # ------------------------------------------------------------------

    def center_all(self, time_ms: int = 700) -> None:
        self.move_all(LegPose(CENTER, CENTER, CENTER), time_ms=time_ms)

    def stand(self, time_ms: int = 700, height: int = STAND_HEIGHT) -> None:
        self.move_all(LegPose(HIP_NEUTRAL, KNEE_GROUND, height), time_ms=time_ms)

    def hiwonder_look_pose(self, time_ms: int = 700) -> None:
        self.move_all(HIWONDER_LOOK_POSE, time_ms=time_ms)

    # ------------------------------------------------------------------
    # Expressive actions
    # ------------------------------------------------------------------

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

        self.move_leg(
            leg_name,
            LegPose(HIP_NEUTRAL, KNEE_GROUND, STAND_HEIGHT),
            time_ms=time_ms,
        )

    # ------------------------------------------------------------------
    # Locomotion
    # ------------------------------------------------------------------

    def walk_forward(
        self,
        steps: int = 1,
        step_time_ms: int = STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self._run_plan("forward", steps=steps, time_ms=step_time_ms, height=height)

    def walk_backward(
        self,
        steps: int = 1,
        step_time_ms: int = STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self._run_plan("backward", steps=steps, time_ms=step_time_ms, height=height)

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

    def turn_left(
        self,
        steps: int = 1,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self._run_plan("left", steps=steps, time_ms=step_time_ms, height=height)

    def turn_right(
        self,
        steps: int = 1,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> None:
        self._run_plan("right", steps=steps, time_ms=step_time_ms, height=height)

    # ------------------------------------------------------------------
    # Phase-based streaming API for external event loops
    # ------------------------------------------------------------------

    def run_phase(
        self,
        direction: str,
        phase_index: int,
        step_time_ms: int = RUN_STEP_TIME_MS,
        height: int = STAND_HEIGHT,
    ) -> int:
        """Execute one phase of a movement cycle and return the next phase index."""
        phases = self._movement_phases(direction, step_time_ms, height)
        phases[phase_index % len(phases)]()
        return (phase_index + 1) % len(phases)

    # ------------------------------------------------------------------
    # Misc
    # ------------------------------------------------------------------

    def stop(self) -> None:
        self.controller.stop_action_group()

    def close(self) -> None:
        self.controller.close()

    def wait_for_move(self, time_ms: int, extra_ms: int = MOVE_EXTRA_WAIT_MS) -> None:
        time.sleep((time_ms + extra_ms) / 1000.0)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _leg(self, leg_name: str) -> Leg:
        try:
            return self.legs[leg_name]
        except KeyError as exc:
            valid = ", ".join(self.legs)
            raise ValueError(f"Unknown leg '{leg_name}'. Valid legs: {valid}") from exc

    def _pose_for(self, leg_names: Iterable[str], pose: LegPose) -> dict[str, LegPose]:
        return {leg_name: pose for leg_name in leg_names}

    def _plan(self, direction: str) -> MotionPlan:
        return self.movements.plan(direction)

    def _execute_phase(self, phase: MotionPhase, time_ms: int, height: int) -> None:
        self.move_legs(phase.poses(self.legs.keys(), height), time_ms)

    def _execute_plan(
        self,
        plan: MotionPlan,
        steps: int,
        time_ms: int,
        height: int,
    ) -> None:
        for _ in range(steps):
            for phase in plan.phases:
                self._execute_phase(phase, time_ms, height)

        if plan.reset_after_complete:
            self._execute_phase(RESET_PHASE, time_ms, height)

    def _run_plan(self, direction: str, steps: int, time_ms: int, height: int) -> None:
        self._execute_plan(self._plan(direction), steps, time_ms, height)

    def _step_phase(
        self,
        lifting: Iterable[str],
        pushing: Iterable[str],
        lifted_hip: int,
        push_hip: int,
        time_ms: int,
        height: int,
    ) -> None:
        phase = TripodPhase(
            name="custom_step",
            lifting=tuple(lifting),
            pushing=tuple(pushing),
            lifted_hip=lifted_hip,
            push_hip=push_hip,
        )
        self._execute_phase(phase, time_ms, height)

    def _reset_hips(self, time_ms: int, height: int) -> None:
        self._execute_phase(RESET_PHASE, time_ms, height)

    def _turn(
        self,
        steps: int,
        left_position: int,
        right_position: int,
        step_time_ms: int,
        height: int,
    ) -> None:
        plan = self.movements.turn_plan(
            name="custom_turn",
            left_position=left_position,
            right_position=right_position,
        )
        self._execute_plan(plan, steps, step_time_ms, height)

    def _turn_step_phase(
        self,
        lifting: Iterable[str],
        pushing: Iterable[str],
        left_position: int,
        right_position: int,
        time_ms: int,
        height: int,
    ) -> None:
        phase = TurnPhase(
            name="custom_turn_step",
            lifting=tuple(lifting),
            pushing=tuple(pushing),
            left_position=left_position,
            right_position=right_position,
        )
        self._execute_phase(phase, time_ms, height)

    def _movement_phases(
        self,
        direction: str,
        step_time_ms: int,
        height: int,
    ) -> list[Callable[[], None]]:
        """Return zero-argument actions representing one streaming movement cycle."""
        return [
            lambda phase=phase: self._execute_phase(phase, step_time_ms, height)
            for phase in self._plan(direction).streaming_phases()
        ]


# ---------------------------------------------------------------------------
# Convenience API
# ---------------------------------------------------------------------------


RobotController = SpiderRobotController


def create_robot(port: str = "/dev/ttyAMA0", baud: int = 9600) -> SpiderRobotController:
    return SpiderRobotController(LobotController(port=port, baud=baud))


# ---------------------------------------------------------------------------
# Quick-run configuration - change these values, then run the script
# ---------------------------------------------------------------------------


RUN_PORT = "/dev/ttyAMA0"
RUN_BAUD = 9600
RUN_ACTION = "walk"  # center | stand | hiwonder | look | hi | walk | run | backward | run_backward | left | right
RUN_LEG = "leg_6"
RUN_STEPS = 1
RUN_LOOP = True
RUN_MOVE_TIME_MS = 400
RUN_DELAY_SECONDS = 0.0


def prepare_action(robot: SpiderRobotController) -> None:
    """Optional warm-up pose before movement actions."""
    action = RUN_ACTION.strip().lower()
    if action in ("walk", "run", "running", "backward", "run_backward", "left", "right"):
        robot.stand(time_ms=RUN_MOVE_TIME_MS)


def run_action(robot: SpiderRobotController) -> None:
    action = RUN_ACTION.strip().lower()

    if action == "center":
        robot.center_all(time_ms=RUN_MOVE_TIME_MS)
    elif action == "stand":
        robot.stand(time_ms=RUN_MOVE_TIME_MS)
    elif action in ("hiwonder", "look"):
        robot.hiwonder_look_pose(time_ms=RUN_MOVE_TIME_MS)
    elif action == "hi":
        robot.say_hi(leg_name=RUN_LEG, time_ms=RUN_MOVE_TIME_MS)
    elif action == "walk":
        robot.walk_forward(steps=RUN_STEPS, step_time_ms=RUN_MOVE_TIME_MS)
    elif action in ("run", "running"):
        robot.run_forward(steps=RUN_STEPS, step_time_ms=RUN_MOVE_TIME_MS)
    elif action == "backward":
        robot.walk_backward(steps=RUN_STEPS, step_time_ms=RUN_MOVE_TIME_MS)
    elif action == "run_backward":
        robot.run_backward(steps=RUN_STEPS, step_time_ms=RUN_MOVE_TIME_MS)
    elif action == "left":
        robot.turn_left(steps=RUN_STEPS, step_time_ms=RUN_MOVE_TIME_MS)
    elif action == "right":
        robot.turn_right(steps=RUN_STEPS, step_time_ms=RUN_MOVE_TIME_MS)
    else:
        valid = "center, stand, hiwonder, look, hi, walk, run, backward, run_backward, left, right"
        raise ValueError(f"Unknown RUN_ACTION '{RUN_ACTION}'. Use one of: {valid}")


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
