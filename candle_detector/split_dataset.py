# -*- coding: utf-8 -*-
"""
Split a flat folder of labeled images into YOLO train/val structure.

Expected input: a folder with matching pairs  name.jpg + name.txt
(YOLO label files; an image with NO flame should have an EMPTY .txt — that is a
valid "background" sample and is important for reducing false positives).

Produces:
  dataset/images/train  dataset/labels/train
  dataset/images/val    dataset/labels/val

Example:
  python3 split_dataset.py --src dataset/labeled --val 0.2
"""
import argparse
import os
import random
import shutil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="folder of labeled image+txt pairs")
    ap.add_argument("--val", type=float, default=0.2, help="validation fraction")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    ds = os.path.join(here, "dataset")
    imgs = [f for f in os.listdir(args.src) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    if not imgs:
        raise SystemExit(f"No images found in {args.src}")

    random.seed(args.seed)
    random.shuffle(imgs)
    n_val = int(len(imgs) * args.val)
    splits = {"val": imgs[:n_val], "train": imgs[n_val:]}

    for split, files in splits.items():
        img_dir = os.path.join(ds, "images", split)
        lbl_dir = os.path.join(ds, "labels", split)
        os.makedirs(img_dir, exist_ok=True)
        os.makedirs(lbl_dir, exist_ok=True)
        missing = 0
        for f in files:
            stem = os.path.splitext(f)[0]
            shutil.copy(os.path.join(args.src, f), os.path.join(img_dir, f))
            txt = os.path.join(args.src, stem + ".txt")
            if os.path.exists(txt):
                shutil.copy(txt, os.path.join(lbl_dir, stem + ".txt"))
            else:
                # no label file -> treat as background (empty label)
                open(os.path.join(lbl_dir, stem + ".txt"), "w").close()
                missing += 1
        print(f"{split}: {len(files)} images ({missing} background/empty labels)")

    print(f"Total: {len(imgs)} images -> {len(splits['train'])} train / {len(splits['val'])} val")


if __name__ == "__main__":
    main()
