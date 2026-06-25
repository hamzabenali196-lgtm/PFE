# -*- coding: utf-8 -*-
"""
Tune / verify the HSV flame detector used by robot_final.py.

The Pi is headless, so this SAVES an image instead of showing a window:
the left half is the camera frame with detected flame boxes, the right half is
the binary mask. Open the output file to see what the detector "sees".

Workflow to tune:
  1. Light the candle, point the robot camera at it.
  2. Stop robot_final.py (it holds the camera), then run:
        python3 flame_tune.py
  3. Open flame_debug.jpg. The flame should be a solid white blob in the mask
     and boxed on the left, with little/no white elsewhere.
  4. If the flame is MISSING from the mask -> the halo isn't being detected; in
     robot_final.py lower FLAME_HALO_SAT_MIN (and/or FLAME_HALO_VAL_MIN / FLAME_CORE_VAL).
     If OTHER stuff lights up -> raise FLAME_HALO_SAT_MIN / FLAME_WARM_DIFF.
  5. Re-run until only the flame shows. The constants live in robot_final.py and
     are imported here, so just edit them there.

You can also test a saved photo:  python3 flame_tune.py --image shot.jpg
"""
import argparse

import cv2

import robot_final as rf


def annotate(frame):
    boxes = rf.detect_flame(frame)
    mask = rf.flame_mask(frame)
    for i, (x, y, w, h) in enumerate(boxes):
        color = (0, 80, 255) if i == 0 else (0, 200, 255)
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
    mask_bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    combo = cv2.hconcat([frame, mask_bgr])
    return combo, boxes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", help="test a saved image instead of the live camera")
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--out", default="flame_debug.jpg")
    args = ap.parse_args()

    if args.image:
        frame = cv2.imread(args.image)
        if frame is None:
            raise SystemExit(f"Could not read {args.image}")
    else:
        cap = cv2.VideoCapture(args.camera)
        for _ in range(15):          # let exposure settle
            cap.read()
        ok, frame = cap.read()
        cap.release()
        if not ok:
            raise SystemExit("Could not grab a frame from the camera")

    combo, boxes = annotate(frame)
    cv2.imwrite(args.out, combo)
    print(f"{len(boxes)} flame box(es): {boxes}")
    print(f"Wrote {args.out} (left: detections, right: mask)")


if __name__ == "__main__":
    main()
