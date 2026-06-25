# Candle / small-flame YOLO detector

The shipped `fire_detection_model.pt` is a **forest fire + smoke** model. A candle
is a *small red/orange flame with no smoke*, which that model never learned — so it
either misses it or false-alarms on every warm pixel. This folder fine-tunes a
small YOLO model on **your candle, from the robot's own camera**, as a single
`flame` class.

> Training needs a GPU (or Google Colab). The Pi can capture data and run the
> final model, but **cannot train**.

## Pipeline

### 1. Capture images — on the Pi
Use the same camera the robot uses, in the real environment. Capture several
sessions and **include negatives** (no candle) — they're what stop false alarms.

```bash
cd candle_detector
# positives: candle at different distances / angles
python3 capture_dataset.py --out dataset/captures/candle_a --count 120
python3 capture_dataset.py --out dataset/captures/candle_b --count 120
# hard cases: candle near lamps / warm objects
python3 capture_dataset.py --out dataset/captures/candle_hard --count 80
# negatives: NO candle — lamps, sunlight, red/orange things, faces, empty room
python3 capture_dataset.py --out dataset/captures/no_candle --count 150
```
Aim for **~300–600 images total**, roughly half with a candle, half without.

### 2. Label — single class `flame`
Draw one tight box around each flame. Tools: [Roboflow](https://roboflow.com),
`labelImg`, or Label Studio. Export **YOLO format**.
- Images with a candle → one (or more) `flame` boxes.
- Negative images → **empty label** (no boxes). These are valid training samples.

Put all labeled `name.jpg` + `name.txt` pairs into `dataset/labeled/`.

### 3. Split into train/val
```bash
python3 split_dataset.py --src dataset/labeled --val 0.2
```

### 4. Train — on GPU / Colab
Copy `candle_detector/` to the GPU machine, then:
```bash
pip install ultralytics
python3 train.py                 # yolo11n, 120 epochs
# or a bit bigger/stronger:
python3 train.py --base yolo11s.pt --epochs 150
```
Best weights land in `outputs/candle_yolo/weights/best.pt`. Check that
validation **mAP50** is healthy (aim > 0.8 for a clean single-class candle set).

### 5. Deploy — back on the Pi
```bash
cp outputs/candle_yolo/weights/best.pt ../fire_detection_model.pt
```
Then in [`../robot_final.py`](../robot_final.py) the new model has a single class,
so update the fire config:
```python
FIRE_CLASSES    = {0}     # new model: class 0 = 'flame'
FIRE_CONFIDENCE = 0.45    # raise it back up — a tuned model is accurate, so be strict
```
(The interim `0.25` was only to coax the wrong forest model — drop it once the
candle model is in.)

## Why this works when the forest model didn't
- **Domain match**: trained on your candle, your camera, your room.
- **Single class**: no competing `smoke`/`fog`/`factory-smoke` classes to confuse it.
- **Negatives**: explicitly teaches "warm/bright ≠ fire", killing the false alarms.
