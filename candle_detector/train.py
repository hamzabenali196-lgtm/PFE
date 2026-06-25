# -*- coding: utf-8 -*-
"""
Fine-tune a small YOLO model to detect a candle / small flame (single class).

RUN THIS ON A GPU MACHINE OR GOOGLE COLAB — the Raspberry Pi cannot train.
Copy the whole candle_detector/ folder (with the labeled dataset) to the GPU box.

  pip install ultralytics
  python3 train.py                 # uses GPU if available, else CPU
  python3 train.py --epochs 150 --base yolo11s.pt

When done, the weights you deploy are at:
  outputs/candle_yolo/weights/best.pt
Copy that back to the Pi as  fire_detection_model.pt  (see README).

Notes tuned for candle flames:
  * imgsz 640 — the flame is small, keep resolution high during training.
  * hsv_h kept LOW — flame COLOR is the signal; don't recolor flames away.
  * mixup/mosaic moderate — helps generalize with a small dataset.
"""
import argparse

import torch
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="yolo11n.pt", help="base weights to fine-tune from")
    ap.add_argument("--data", default="dataset.yaml")
    ap.add_argument("--epochs", type=int, default=120)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--name", default="candle_yolo")
    args = ap.parse_args()

    device = 0 if torch.cuda.is_available() else "cpu"
    print(f"Training on device: {device}")

    model = YOLO(args.base)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=device,
        project="outputs",
        name=args.name,
        patience=40,
        cos_lr=True,
        # augmentation tuned for a small, color-defined target
        hsv_h=0.01,     # keep flame hue stable (low)
        hsv_s=0.5,
        hsv_v=0.4,
        degrees=5.0,
        translate=0.1,
        scale=0.4,
        fliplr=0.5,
        mosaic=0.6,
        mixup=0.1,
        close_mosaic=15,
    )

    # Quick sanity validation on the held-out set.
    metrics = model.val(data=args.data, imgsz=args.imgsz, device=device)
    print("Validation mAP50-95:", metrics.box.map)
    print("Validation mAP50   :", metrics.box.map50)
    print("Best weights: outputs/%s/weights/best.pt" % args.name)


if __name__ == "__main__":
    main()
