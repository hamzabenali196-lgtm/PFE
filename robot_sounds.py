# -*- coding: utf-8 -*-
"""Robot sound effects, played on the Bluetooth speaker (PipeWire default sink).

Synthesizes short R2D2-style chirps — one distinct sound per move — into
`sounds/*.wav` on first run, then plays them with `paplay` (non-blocking).
The default sink is the paired Bluetooth speaker, so no device flag is needed.

Playback never raises: if the speaker/PipeWire is unavailable, moves must
still work silently.
"""
from __future__ import annotations

import os
import subprocess
import threading
from pathlib import Path

RATE = 22050
SOUNDS_DIR = Path(__file__).resolve().parent / "sounds"

# paplay needs the user's PipeWire socket; under systemd this env var is unset.
os.environ.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")


# ---------------------------------------------------------------------------
# Synthesis (numpy only needed the first time, to build the WAV files)
# ---------------------------------------------------------------------------

def _synth_all() -> dict:
    import numpy as np

    def env(n: int, attack: float = 0.008, release: float = 0.04):
        e = np.ones(n)
        a = max(1, int(attack * RATE))
        r = max(1, int(release * RATE))
        e[:a] = np.linspace(0, 1, a)
        e[-r:] *= np.linspace(1, 0, r)
        return e

    def tone(freq: float, dur: float, vol: float = 0.6, vib_hz: float = 0.0, vib_depth: float = 0.0):
        t = np.arange(int(dur * RATE)) / RATE
        f = freq + vib_depth * np.sin(2 * np.pi * vib_hz * t)
        phase = 2 * np.pi * np.cumsum(f) / RATE
        return vol * env(len(t)) * np.sin(phase)

    def chirp(f0: float, f1: float, dur: float, vol: float = 0.6):
        t = np.arange(int(dur * RATE)) / RATE
        f = np.linspace(f0, f1, len(t))
        phase = 2 * np.pi * np.cumsum(f) / RATE
        return vol * env(len(t)) * np.sin(phase)

    def click(vol: float = 0.4):
        """Short mechanical tick: a noise burst with a fast exponential decay."""
        n = int(0.03 * RATE)
        rng = np.random.default_rng(7)
        return vol * rng.uniform(-1, 1, n) * np.exp(-np.arange(n) / (0.004 * RATE))

    def gap(dur: float):
        return np.zeros(int(dur * RATE))

    def seq(*parts):
        return np.concatenate(parts)

    hello = seq(chirp(600, 1300, 0.12), gap(0.05), chirp(750, 1500, 0.14), gap(0.08),
                tone(1200, 0.35, vib_hz=12, vib_depth=150))
    bow = chirp(900, 350, 0.8, vol=0.55)
    trill = seq(*[seq(tone(900, 0.045), tone(1150, 0.045)) for _ in range(9)])
    mexican = seq(*[seq(tone(500 + i * 90, 0.11), gap(0.02)) for i in range(6)])
    bounce_hop = seq(chirp(280, 820, 0.15), gap(0.15))
    scale = seq(*[tone(700 + i * 200, 0.06) for i in range(6)])
    breath = tone(200, 2.4, vol=0.5, vib_hz=0.4, vib_depth=6)
    breath *= np.sin(np.linspace(0, np.pi, len(breath))) ** 2
    siren = seq(chirp(600, 1250, 0.35, vol=0.8), chirp(1250, 600, 0.35, vol=0.8))
    step = seq(click(), tone(140, 0.06, vol=0.3), gap(0.16),
               click(0.3), tone(160, 0.05, vol=0.25), gap(0.14))

    return {
        "hi": hello,
        "bow": bow,
        "shake": trill,
        "wave": seq(mexican, gap(0.1), mexican),
        "bounce": seq(*[bounce_hop for _ in range(4)]),
        "sway": tone(480, 2.6, vol=0.55, vib_hz=0.8, vib_depth=60),
        "tiptoe": seq(*[seq(tone(1500 if i % 2 else 1800, 0.04, vol=0.45), gap(0.14)) for i in range(10)]),
        "ripple": seq(scale, gap(0.12), scale, gap(0.12), scale),
        "pulse": seq(breath, gap(0.2), breath),
        "start": chirp(500, 1000, 0.08, vol=0.5),
        "stop": chirp(900, 400, 0.12, vol=0.5),
        "mode": seq(tone(700, 0.09), gap(0.04), tone(1050, 0.12)),
        "alert": seq(siren, siren, siren),
        "walk": step,
    }


def ensure_sound_files() -> None:
    """Generate any missing WAV files (fast, runs once per new sound)."""
    import wave

    SOUNDS_DIR.mkdir(exist_ok=True)
    missing = {name for name in _SOUND_NAMES if not (SOUNDS_DIR / f"{name}.wav").exists()}
    if not missing:
        return

    import numpy as np

    for name, samples in _synth_all().items():
        if name not in missing:
            continue
        pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
        with wave.open(str(SOUNDS_DIR / f"{name}.wav"), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(pcm.tobytes())
    print(f"Robot sounds generated: {sorted(missing)}")


_SOUND_NAMES = (
    "hi", "bow", "shake", "wave", "bounce", "sway", "tiptoe", "ripple", "pulse",
    "start", "stop", "mode", "alert", "walk",
)


# ---------------------------------------------------------------------------
# Playback
# ---------------------------------------------------------------------------

class SoundPlayer:
    """Fire-and-forget playback of the named sounds, plus a repeating walk loop."""

    def __init__(self) -> None:
        self._proc: subprocess.Popen | None = None
        self._loop_name: str | None = None
        self._loop_proc: subprocess.Popen | None = None
        self._loop_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._warned = False
        try:
            ensure_sound_files()
        except Exception as exc:  # sounds are best-effort, never block motion
            print(f"Sound generation failed (robot stays silent): {exc}")

    def play(self, name: str) -> None:
        """Play one sound, cutting off the previous one-shot if still running."""
        path = SOUNDS_DIR / f"{name}.wav"
        if not path.exists():
            return
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()
            self._proc = self._spawn(path)

    def start_loop(self, name: str = "walk") -> None:
        """Repeat a sound until stop_loop() — the walking/driving noise."""
        with self._lock:
            if self._loop_name == name:
                return
            self._stop_loop_locked()
            path = SOUNDS_DIR / f"{name}.wav"
            if not path.exists():
                return
            self._loop_name = name
            self._loop_thread = threading.Thread(target=self._loop_run, args=(name, path), daemon=True)
            self._loop_thread.start()

    def stop_loop(self) -> bool:
        """Stop the repeating sound. Returns True if one was playing."""
        with self._lock:
            return self._stop_loop_locked()

    def stop_all(self) -> None:
        self.stop_loop()
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.terminate()

    # -- internals -----------------------------------------------------------

    def _loop_run(self, name: str, path: Path) -> None:
        while self._loop_name == name:
            proc = self._spawn(path)
            if proc is None:
                return
            with self._lock:
                if self._loop_name != name:
                    proc.terminate()
                    return
                self._loop_proc = proc
            proc.wait()

    def _stop_loop_locked(self) -> bool:
        was_playing = self._loop_name is not None
        self._loop_name = None
        if self._loop_proc and self._loop_proc.poll() is None:
            self._loop_proc.terminate()
        self._loop_proc = None
        return was_playing

    def _spawn(self, path: Path) -> subprocess.Popen | None:
        try:
            return subprocess.Popen(
                ["paplay", str(path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            if not self._warned:
                self._warned = True
                print(f"Speaker unavailable, sounds disabled: {exc}")
            return None


if __name__ == "__main__":
    import sys
    import time

    ensure_sound_files()
    player = SoundPlayer()
    names = sys.argv[1:] or list(_SOUND_NAMES)
    for sound in names:
        print(f"Playing: {sound}")
        if sound == "walk":
            player.start_loop("walk")
            time.sleep(3)
            player.stop_loop()
        else:
            player.play(sound)
            time.sleep(3)
