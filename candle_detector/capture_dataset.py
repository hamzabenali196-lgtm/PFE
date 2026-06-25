# -*- coding: utf-8 -*-
"""
Capture training images for the candle / small-flame detector.

Run this ON THE PI, using the SAME camera the robot uses, so the training
images match the real deployment domain (this matters more than dataset size).

Capture several short sessions:
  - candle ON at different distances / positions / angles  (positives)
  - candle ON with other warm/bright objects in view       (hard positives)
  - NO candle: lamps, sunlight, red/orange objects, faces   (negatives!)

Negatives are essential — they are what teach the model NOT to fire on every
warm pixel (the bug you just saw).

Examples:
  python3 capture_dataset.py --out dataset/captures/candle_close --count 120
  python3 capture_dataset.py --out dataset/captures/no_candle    --count 120 --interval 0.5
"""
import argparse
import os
import time

import cv2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output folder for captured .jpg frames")
    ap.add_argument("--count", type=int, default=120, help="how many frames to capture")
    ap.add_argument("--interval", type=float, default=0.7, help="seconds between frames")
    ap.add_argument("--camera", type=int, default=0, help="camera index (matches robot_final.py)")
    ap.add_argument("--warmup", type=int, default=15, help="frames to discard while camera adjusts exposure")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {args.camera}")

    # Discard initial frames so auto-exposure/white-balance settle.
    for _ in range(args.warmup):
        cap.read()

    prefix = time.strftime("%Y%m%d_%H%M%S")
    print(f"Capturing {args.count} frames to {args.out} (every {args.interval}s). Move the candle around!")
    saved = 0
    try:
        while saved < args.count:
            ok, frame = cap.read()
            if not ok:
                print("frame grab failed, retrying...")
                time.sleep(0.1)
                continue
            path = os.path.join(args.out, f"{prefix}_{saved:04d}.jpg")
            cv2.imwrite(path, frame)
            saved += 1
            if saved % 10 == 0:
                print(f"  {saved}/{args.count}")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped early")
    finally:
        cap.release()
    print(f"Done: {saved} frames in {args.out}")


if __name__ == "__main__":
    main()
