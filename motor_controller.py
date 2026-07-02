# -*- coding: utf-8 -*-
"""DC-motor drive over an L298N H-bridge (gpiozero / lgpio, Pi 5).

Differential drive with TWO control channels — LEFT and RIGHT. Each channel
drives the two motors on that side, wired in PARALLEL onto one L298N output
(4 motors total: left pair on OUT1/OUT2, right pair on OUT3/OUT4):
    forward  -> both sides ahead
    backward -> both sides back
    left     -> left side back,  right side ahead   (spin left in place)
    right    -> left side ahead, right side back    (spin right in place)

So the motors reproduce the same forward/backward/left/right the legs do — the
motion worker just sends the same direction words to the motors once the legs
are lifted off the ground.

Power: the motors run off a SEPARATE battery into the L298N motor supply, NOT
the Pi's 5V. Tie one L298N GND to a Pi GND so the two boards share a ground
reference; only the six logic pins below go to the Pi. Wiring notes at the
bottom of this file.

Uses gpiozero, which picks the lgpio backend on the Pi 5's RP1 GPIO — the same
path robot_final.py uses for the IR sensor (RPi.GPIO does not work on the Pi 5).
"""
from __future__ import annotations

import sys
import time

# --- BCM GPIO pin map -> L298N inputs --------------------------------------
# Verified live with test_motors.py (toggle each pin, watch the wheel). EN
# carries speed (software PWM on these pins); the INx pins set direction.
# Avoids pins the project already uses: UART (GPIO14/15) and IR sensor (GPIO23).
LEFT_IN1,  LEFT_IN2,  LEFT_EN  = 27, 21, 17   # Motor A  (left wheel)
RIGHT_IN1, RIGHT_IN2, RIGHT_EN = 24, 22, 20   # Motor B  (right wheel)

# Flip a wheel here if it spins the wrong way (easier than re-wiring it).
LEFT_INVERT  = False
RIGHT_INVERT = False

DEFAULT_DUTY = 1.0   # 0..1 PWM duty on the EN pins (motor speed); full by default

# --- Motors-won't-start tuning --------------------------------------------
# DC motors (especially two in parallel through the L298N's ~2V drop) often only
# BUZZ at a low PWM duty — they need a strong kick to get moving, then can hold a
# lower speed. These defaults make "it just sits there and hums" go away.
MOTOR_PWM    = False  # EN driven as plain ON/OFF — full power, NO speed control.
                      #   Set True to bring back PWM speed control on the EN pins.
PWM_FREQUENCY = 1000  # Hz on the EN pins (smoother/stronger than gpiozero's 100 Hz default)
KICKSTART_S   = 0.25  # full-power pulse when a stopped wheel starts (beats stiction)
MIN_RUN_DUTY  = 0.55  # while moving, never command below this (lower = buzz, no spin)

try:
    from gpiozero import DigitalOutputDevice, PWMOutputDevice
    _GPIO_IMPORT_ERR = None
except Exception as exc:        # off-Pi / gpiozero missing -> degrade to no-op
    DigitalOutputDevice = PWMOutputDevice = None
    _GPIO_IMPORT_ERR = exc


class _Channel:
    """One L298N side: two direction pins (INx) + one enable pin (ENx).

    Classic explicit L298N control: EN carries the speed (PWM, or plain ON when
    MOTOR_PWM is False) and the two IN pins set direction. ENx MUST be wired to
    the Pi with its jumper REMOVED, or the channel stays disabled and the motor
    never moves. A stopped wheel gets a brief full-power kick (KICKSTART_S) so it
    actually starts instead of just humming at a low duty.
    """

    def __init__(self, in1: int, in2: int, en: int, invert: bool) -> None:
        self.in1 = DigitalOutputDevice(in1)
        self.in2 = DigitalOutputDevice(in2)
        if MOTOR_PWM:
            self.en = PWMOutputDevice(en, frequency=PWM_FREQUENCY)
        else:
            self.en = DigitalOutputDevice(en)   # full power, no speed control
        self.invert = invert
        self._moving = False
        self._duty = 0.0

    def _set_enable(self, duty: float) -> None:
        if MOTOR_PWM:
            self.en.value = duty            # PWMOutputDevice: 0..1 duty
        else:
            self.en.value = 1 if duty > 0 else 0   # DigitalOutputDevice: on/off

    def run(self, signed: float) -> None:
        """signed in [-1, 1]: + = forward, - = backward, magnitude = speed.
        Kicks a stopped wheel then settles — for driving ONE channel alone."""
        if self.apply(signed):
            time.sleep(KICKSTART_S)
            self.settle()

    def apply(self, signed: float) -> bool:
        """Set direction + enable. Returns True if this wheel is mid-kickstart
        (enable held at full power) and still needs settle() after the pulse.
        Split from the sleep so both channels can kick at the SAME time."""
        if self.invert:
            signed = -signed
        duty = abs(signed)
        if duty <= 0:
            self.stop()
            return False

        forward = signed >= 0
        self.in1.value = 1 if forward else 0
        self.in2.value = 0 if forward else 1

        self._duty = max(MIN_RUN_DUTY, min(1.0, duty))
        needs_kick = not self._moving and KICKSTART_S > 0
        self._set_enable(1.0 if needs_kick else self._duty)
        self._moving = True
        return needs_kick

    def settle(self) -> None:
        """Drop from the full-power kick to the commanded running duty."""
        self._set_enable(self._duty)

    def stop(self) -> None:
        self._set_enable(0)        # cut drive (coast)
        self.in1.off()
        self.in2.off()
        self._moving = False

    def close(self) -> None:
        for dev in (self.en, self.in1, self.in2):
            try:
                dev.close()
            except Exception:
                pass


class MotorDrive:
    """Differential drive over an L298N. GPIO pins are reserved lazily on first
    use so merely importing/constructing this never disturbs the rest of the
    robot. Two control channels (left/right); each may drive >1 motor in
    parallel off its OUT pair."""

    def __init__(self, duty: float = DEFAULT_DUTY) -> None:
        self._duty = _clamp01(duty)
        self._left: "_Channel | None" = None
        self._right: "_Channel | None" = None
        self._ready = False
        self._tried = False

    # ------------------------------------------------------------------
    def _ensure(self) -> bool:
        """Create the two channels on first use. Returns False if GPIO is
        unavailable (off-Pi, missing lib, or pins busy) — caller then no-ops."""
        if self._tried:
            return self._ready
        self._tried = True
        if PWMOutputDevice is None:
            print(f"Motors unavailable (gpiozero): {_GPIO_IMPORT_ERR}")
            return False
        try:
            self._left = _Channel(LEFT_IN1, LEFT_IN2, LEFT_EN, LEFT_INVERT)
            self._right = _Channel(RIGHT_IN1, RIGHT_IN2, RIGHT_EN, RIGHT_INVERT)
            self._ready = True
            print("Motors ready (L298N: EN=PWM speed, IN=direction)")
        except Exception as exc:
            print(f"Motors init failed: {exc}")
            self._ready = False
        return self._ready

    # ------------------------------------------------------------------
    def set_speed(self, duty: float) -> None:
        """Set motor speed (0..1). Applied on the next drive() call."""
        self._duty = _clamp01(duty)

    def drive(self, direction: str, duty: float | None = None) -> None:
        """Drive in one of: forward / backward / left / right. Unknown -> stop."""
        if not self._ensure():
            return
        if duty is not None:
            self._duty = _clamp01(duty)
        s = self._duty

        # (left, right) signed speeds: +1 ahead, -1 back.
        plan = {
            "forward":  (+s, +s),
            "backward": (-s, -s),
            "left":     (-s, +s),
            "right":    (+s, -s),
        }.get(direction)

        if plan is None:
            self.stop()
            return
        # Kick both sides together: prime each (full-power if it needs a kick),
        # sleep ONCE, then settle both to their running duty. This is what keeps
        # the two motors from starting ~KICKSTART_S apart.
        kick_left = self._left.apply(plan[0])
        kick_right = self._right.apply(plan[1])
        if kick_left or kick_right:
            time.sleep(KICKSTART_S)
            self._left.settle()
            self._right.settle()

    def stop(self) -> None:
        """Cut power to both sides (coast to a halt)."""
        if not self._ready:
            return
        try:
            self._left.stop()
            self._right.stop()
        except Exception as exc:
            print(f"Motor stop warning: {exc}")

    def close(self) -> None:
        """Release the GPIO pins. Safe to call when never started."""
        self.stop()
        for ch in (self._left, self._right):
            if ch is not None:
                ch.close()
        self._left = self._right = None
        self._ready = False


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def create_motor_drive(duty: float = DEFAULT_DUTY) -> MotorDrive:
    return MotorDrive(duty=duty)


def _self_test(seq=("forward", "backward", "left", "right"), hold: float = 1.5) -> None:
    """Drive each direction for a moment. Run directly to test the motors alone."""
    mode = f"PWM @ {PWM_FREQUENCY} Hz" if MOTOR_PWM else "DIGITAL full-on (no PWM)"
    print(f"Motor self-test — enable mode: {mode}")
    print("(Stop the motion worker first — it holds these GPIO pins.)\n")
    d = create_motor_drive()
    try:
        for direction in seq:
            print(f"  {direction} ...")
            d.drive(direction)
            time.sleep(hold)
            d.stop()
            time.sleep(0.4)
    finally:
        d.close()
    print("\nDone. If nothing moved, see the wiring checklist at the bottom of this file —")
    print("first suspects: ENA/ENB jumpers still on, EN not wired, no shared ground, dead battery.")


if __name__ == "__main__":
    # python3 motor_controller.py          -> test WITH PWM speed control
    # python3 motor_controller.py digital  -> test with EN full-on, NO PWM
    if len(sys.argv) > 1 and sys.argv[1].lower() in ("digital", "nopwm", "full"):
        MOTOR_PWM = False
    _self_test()


# ===========================================================================
#  L298N + 2 DC MOTORS WIRING  (Raspberry Pi 5, separate motor battery)
# ===========================================================================
#
#  The L298N is a dual H-bridge: it takes the Pi's low-current direction/PWM
#  logic signals and switches the high-current motor battery to the motors.
#
#  POWER (keep motor power OFF the Pi). Example rig: ~8V battery, 5V "yellow" TT
#  gear motors:
#    Battery (+ ~8V)    -> L298N  +12V (VS / motor supply)
#    Battery (-)        -> L298N  GND
#    L298N GND          -> Pi GND        <- shared ground reference (REQUIRED)
#    L298N "5V-EN" jumper -> ON. With VS <= 12V the board's regulator then makes
#                          its own 5V LOGIC supply on the +5V pin. You do NOT wire
#                          the Pi's 5V here — the only Pi<->L298N power wire is GND.
#    Motors get ~6V (8V minus the L298N's ~2V drop) -> fine for 3-6V yellow motors.
#
#  VOLTAGES — what to measure where (this trips everyone up):
#    * Pi GPIO/EN/IN pins  = 3.3V logic, NEVER 5V. ~3.3V when HIGH (less on a PWM
#      pin, since PWM averages it down) is CORRECT. The L298N reads >2.3V as HIGH,
#      so 3.3V drives it fine. Do not expect/seek 5V on a Pi pin.
#    * L298N "+5V" pin     = ~5V, produced by the board's own regulator (jumper ON
#      + battery on VS). If this reads 0V the logic is unpowered and the motors
#      CANNOT move even with perfect 3.3V signals -> check the jumper and VS.
#
#  MOTORS (4 total, 2 per side wired in PARALLEL onto one output each):
#    Left  pair  -> OUT1 / OUT2   (both left motors share this channel)
#    Right pair  -> OUT3 / OUT4   (both right motors share this channel)
#    Wire each side's two motors the SAME way so they spin together; if a side
#    spins backwards, swap that channel's two output wires OR flip *_INVERT above.
#    NOTE: two motors in parallel draw ~2x current. A single L298N channel is
#    only ~2A — if the two motors' combined stall current exceeds that, give each
#    side its own L298N (or use a higher-current driver like a BTS7960).
#
#  LOGIC (Pi BCM -> L298N, all 3.3V), matching the pin map at the top of this file:
#    GPIO27 -> IN1     GPIO21 -> IN2     GPIO17 -> ENA   (left  motor)
#    GPIO24 -> IN3     GPIO22 -> IN4     GPIO20 -> ENB   (right motor)
#    Remove the ENA/ENB *signal* jumpers (the ones tying ENA/ENB to +5V) so the
#    Pi's PWM controls speed. (Different from the "5V-EN" power jumper above.)
#
#  These six pins avoid the UART (GPIO14/15 -> servo bus) and the IR sensor
#  (GPIO23) the project already uses. EN on 17/20 use software PWM (fine on the
#  Pi 5's lgpio backend); set MOTOR_PWM=False for plain full-on if you prefer.
#
#  Quick test (stop the motion worker first — it holds these pins):
#    python3 motor_controller.py            # with PWM speed control
#    python3 motor_controller.py digital    # EN full-on, no PWM (isolates PWM issues)
# ===========================================================================
