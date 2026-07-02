# Auto Mode — Implementation Plan

> New feature: split the robot into **two operating modes** — **Manual** (the current
> project, unchanged) and **Auto** (a new autonomous patrol mode that searches for
> humans/fire, drives forward until the IR sensor sees an obstacle, then turns right
> ~90° and keeps going). Recording is always-on in Auto mode.
>
> **Build order (requested):** UI / web page first → backend → Python / servos last.

---

## 1. Feature spec (what the user asked for)

| # | Requirement | Notes |
|---|---|---|
| 1 | Two modes: **Manual** and **Auto** | Manual = the existing dashboard, untouched. |
| 2 | Auto = autonomous patrol | Searches for **human** OR **fire** while moving. |
| 3 | Scans **right / left** and drives **always forward** | Interpreted as: head-camera pan sweeps left↔right while the body walks forward (see Open Question Q1). |
| 4 | On **IR obstacle** → turn **right ~90°** | Exact 90° timing unknown → make the turn duration **tunable** from the UI, calibrate live. |
| 5 | Auto mode → **recording always ON** automatically | Starts when Auto is entered, stops when leaving Auto. User does not press record. |
| 6 | Can **watch previous recordings while recording is ON** | Media list stays visible & playable during an active recording. |

---

## 2. Behaviour: Manual vs Auto

### Manual (today, unchanged)
- D-pad drive (forward/back/left/right), show moves, head pan/tilt, speed, height.
- Manual record start/stop.
- Detection alerts (human / fire / obstacle) shown but robot does **not** act on them.

### Auto (new)
```
                 ┌─────────────── AUTO LOOP ───────────────┐
   enter Auto →  │  drive FORWARD continuously             │
                 │  + head pan sweeps  left ↔ right (scan)  │
                 │  + recording is ON                       │
                 │                                          │
   robot/obstacle = "1"  ──►  STOP forward                  │
                 │            turn RIGHT for AUTO_TURN_MS    │  (the ~90°, tunable)
                 │            resume FORWARD                 │
                 │                                          │
   human / fire detected ──► alert + photo + APPROACH it     │  (steer toward target,
                 │            ("go to it if possible")        │   "go to it if possible")
   leave Auto  ←  │  stop loop, stand, stop recording        │
                 └──────────────────────────────────────────┘
```

---

## 3. Mode data-flow (new plumbing)

```
[UI] Mode toggle (Manual│Auto)
      │  POST /api/robot/mode { mode }
      ▼
[Backend] robotState.mode = mode
      ├─ publishMode(mode)  ──► MQTT  robot/mode   "manual"|"auto"
      ├─ mode==auto ? startVideoRecording() : stopVideoRecording()
      └─ io.emit('robot:mode', { mode })  ──► all browsers
                                   │                    │
      ┌────────────────────────────┘                    ▼
      ▼                                          [UI] switch layout
[Motion worker] on robot/mode:                   (manual dash ↔ auto dash)
   mode==auto  → start autonomous loop
   mode==manual→ stop loop, stand
   subscribes robot/obstacle to react to IR
```

New MQTT topic: **`robot/mode`** (backend → motion worker, retained-style latest value).

---

## 4. What ALREADY EXISTS (reuse — do NOT rebuild) ✅

These are done and directly reusable by Auto mode:

- [x] **IR obstacle sensor** read + publish `robot/obstacle` "1"/"0" — `robot_final.py:215`
- [x] **Backend obstacle handling** → emits `robot:obstacle` on change — `backend/src/mqttClient.js:115`
- [x] **Obstacle shown in UI** (AlertPanel "Obstacle (IR)") — `frontend/src/components/AlertPanel.jsx:57`
- [x] **Turning gait**: `turn_right()` / `run_phase("right", …)` — `robot_controller.py:660,672`
- [x] **Forward drive loop** via `active_direction` + `run_phase` — `robot_motion_worker.py:155`
- [x] **Head pan servo** (oz = servo 20) move path — `robot_motion_worker.py:185` / `robot/servo/oz`
- [x] **Human detection** (Caffe SSD) + alert/photo — `robot_final.py:174`
- [x] **Fire detection** (HSV flame) + alert/photo — `robot_final.py:189`
- [x] **Video recording** (auto audio, ffmpeg MP4) + start/stop API — `backend/src/videoService.js`
- [x] **Recordings list UI** (play/download/delete) — `frontend/src/components/VideoRecorder.jsx`

> Implication: Auto mode is mostly **orchestration** — wiring a mode switch and an
> autonomous loop on top of pieces that already work. No new vision/recording code.

---

## 5. Implementation phases

### ▣ PHASE 1 — Frontend / UI  *(do FIRST, before backend & Python)*

Goal: the whole mode UX is visible and clickable, talking to a (temporary) stubbed API,
**before** any servo command is wired.

- [ ] **1.1 Mode toggle** in the header — segmented control `Manual | Auto`
  - `frontend/src/App.jsx`: add `mode` state, `robot:mode` socket listener, `postMode()` call.
  - New component `frontend/src/components/ModeToggle.jsx`.
  - Visual: Auto = amber/active accent so it's obvious the robot is autonomous.
- [ ] **1.2 Auto-mode layout** (conditional on `mode === 'auto'`)
  - Big LiveCamera (reuse) with a persistent **● REC** + **AUTO** badge.
  - New `AutoStatusPanel.jsx`: shows current robot action — `Searching` / `Obstacle → turning` / `Scanning`, plus human/fire/obstacle live state (reuse AlertPanel data).
  - Manual controls (D-pad, moves, speed, height) **hidden/disabled** in Auto.
- [ ] **1.3 Media visible during recording**
  - In Auto, show VideoRecorder **list** (read-only — no manual start/stop button; show "Auto-recording ●" instead). Confirm list stays playable while a recording runs.
- [ ] **1.4 Turn-tuning control** (to find the real 90°)
  - In AutoStatusPanel: a `Turn duration (ms)` number input + **"Test turn"** button.
  - Sends `auto:turn_ms:<N>` (set) and `auto:test_turn` (one 90°-ish turn) so the user can calibrate without an obstacle.
- [ ] **1.5 api.js helpers**: `postMode(mode)`, `postAutoConfig({turnMs})`, `postAutoTestTurn()`.
- [ ] **1.6 Styles**: `frontend/src/styles.css` — mode toggle, auto badge, status panel.

**Stub for Phase 1:** backend `/api/robot/mode` can initially just echo the mode &
emit `robot:mode` (no servo/record side-effects yet) so the UI is fully testable.

---

### ▣ PHASE 2 — Backend (Node.js)

- [ ] **2.1 State**: add `mode: 'manual'` to `robotState` — `backend/src/state.js`.
- [ ] **2.2 MQTT**: `publishMode(mode)` → topic `robot/mode`; add to `mqttClient.js`.
      (Publish `retain:true` so a motion-worker that boots later still gets the mode.)
- [ ] **2.3 Route** `POST /api/robot/mode { mode }` — `robotRoutes.js`:
  - validate `manual|auto`; set `robotState.mode`; `publishMode(mode)`.
  - `auto` → `startVideoRecording({autoManaged:true})`; `manual` → `stopVideoRecording()`.
  - `io.emit('robot:mode', { mode })`.
- [ ] **2.4** `GET /api/robot/state` already returns `robotState` → `mode` ships for free.
- [ ] **2.5 Socket**: emit current `mode` on new connection (already via `robot:state`).
- [ ] **2.6** (Optional) guard: in Auto, ignore manual `robot/command` drive inputs server-side too (defence-in-depth; UI already hides them).

---

### ▣ PHASE 3 — Python (motion worker + sensor)

- [ ] **3.1 Subscribe** to `robot/mode` and `robot/obstacle` — `robot_motion_worker.py:on_connect`.
- [ ] **3.2 Mode state** `self.mode`; on `robot/mode`:
  - `auto` → set forward as active, start scan, set `self.auto_active=True`.
  - `manual` → stop loop, `stand()`.
- [ ] **3.3 Obstacle reaction**: cache latest obstacle; in the main loop, when
      `mode==auto` and obstacle==1 → run `auto_turn_right()` then resume forward.
- [ ] **3.4 `auto_turn_right()`** — time-based turn:
  ```python
  AUTO_TURN_MS = 1500           # initial guess; tuned live via auto:turn_ms
  end = time.time() + self.auto_turn_ms/1000
  phase = 0
  while time.time() < end and self.mode == "auto":
      phase = self.robot.run_phase("right", phase, step_time_ms=self.step_time_ms, …)
  ```
- [ ] **3.5 Head scan** (`AUTO_HEAD_SCAN=True`): the **HEAD** (servo `oz`/20), not the body,
      sweeps `[left, center, right, center]` every `SCAN_PERIOD` s while walking forward.
- [ ] **3.6 Approach target** ("go to it if possible"): when a human/fire is detected,
      steer toward it using the in-frame position (`robot/feu_position` already exists for
      fire; add an equivalent human-position publish in `robot_final.py`). Center the head
      on the target, nudge body left/right toward it, advance, then resume search.
- [ ] **3.7 Tuning commands** in `normalize_command`/`execute`:
  - `auto:turn_ms:<N>` → `self.auto_turn_ms = N`
  - `auto:test_turn` → run one `auto_turn_right()` (works even outside Auto, for calibration)
- [ ] **3.8 Safety**: entering Auto from any state does a clean `stand()` first; leaving
      Auto stops immediately. Stop event / SIGTERM already handled.

> The IR sensor publishing already exists (`robot_final.py`); **no change needed there**
> unless we want a faster obstacle publish rate (currently throttled to `IR_PERIOD=0.5s`
> — may want ~0.15s in Auto for quicker stops). → tracked as Q3.

---

### ▣ PHASE 4 — Calibration & test

- [ ] **4.1** Bench test (robot lifted): toggle Auto → confirm forward + scan + record start.
- [ ] **4.2** Trip the IR by hand → confirm stop → right turn → resume.
- [ ] **4.3** Calibrate `AUTO_TURN_MS` with the Test-turn button until it's a real 90°,
      then bake the value in as the default.
- [ ] **4.4** Leave Auto → confirm stand + recording stops + saved clip appears in list.
- [ ] **4.5** Update `ARCHITECTURE.md` (new topic `robot/mode`, mode flow, auto loop).

---

## 6. New / changed interfaces summary

**New MQTT topic**
```
robot/mode      backend → motion worker     "manual" | "auto"   (retained)
```
**New REST**
```
POST /api/robot/mode          { mode: "manual"|"auto" }
POST /api/robot/auto/config   { turnMs: number }        # tuning
POST /api/robot/auto/test-turn                          # one calibration turn
```
**New Socket.IO**
```
robot:mode   →  { mode }
```
**New motion commands (over robot/command)**
```
auto:turn_ms:<N>     set turn duration
auto:test_turn       run one ~90° right turn (calibration)
```
**New files**
```
frontend/src/components/ModeToggle.jsx
frontend/src/components/AutoStatusPanel.jsx
```

---

## 7. Open questions / decisions (please confirm)

- **Q1 — "looking right/left": ✅ RESOLVED → HEAD pans, not the body.** The head camera
  sweeps left↔right (servo `oz`/20) while the body walks straight. The **body only turns
  when the IR sees an obstacle in front.** Flag: `AUTO_HEAD_SCAN = True` in the worker.
- **Q2 — On detecting a human/fire: ✅ RESOLVED → ALERT + APPROACH ("go to it if
  possible").** Don't just keep patrolling and don't just stop — steer toward the target
  (using the detection's position in the frame) and advance toward it, then resume search.
- **Q3 — Obstacle publish rate:** speed up IR publishing from 0.5s → ~0.15s in Auto so the
  robot stops sooner? (Small change in `robot_final.py`.)
- **Q4 — "Previous recordings while recording":** in Auto we do **one continuous clip**
  per session (previous = earlier sessions' clips in the list), OR **segment** the auto
  recording into chunks so earlier chunks become watchable mid-session? → *Default:
  continuous; segmenting is an optional enhancement.*
- **Q5 — Turn direction always right?** Spec says right. Keep it fixed right for now.

---

## 8. Master checklist (done ✅ / todo ☐)

```
REUSABLE (already done)
  ✅ IR obstacle publish        ✅ obstacle in backend + UI
  ✅ turn-right gait            ✅ forward drive loop
  ✅ head pan servo            ✅ human + fire detection
  ✅ video record + list UI

PHASE 1 — UI            ✅ mode toggle  ✅ auto layout  ✅ status panel
                        ✅ media-during-record  ✅ turn-tuning UI  ✅ api.js  ✅ styles
                        ✅ frontend build passes  ✅ backend endpoints curl-tested
PHASE 2 — Backend       ✅ state.mode  ✅ publishMode(MQTT, retained)  ✅ /mode route + record
                        ✅ /auto/config(publishes)  ✅ /auto/test-turn(publishes)  ✅ emit robot:mode
                        ✅ auto start/stop recording  ✅ guard manual cmds in auto  ✅ MQTT-tested
PHASE 3 — Python        ✅ subscribe mode+obstacle+targets  ✅ mode state/transitions  ✅ obstacle->turn
                        ✅ auto_turn_right  ✅ head scan  ✅ approach target  ✅ tuning cmds  ✅ safety
                        ✅ human-position publish  ✅ responsive IR publish  ☐ automated test suite (not yet committed)
PHASE 4 — Calibrate     ☐ bench test  ☐ IR trip test  ☐ tune 90°  ☐ exit test  ☐ docs   (NEEDS ROBOT)
```

---

### Status: **Phases 1–3 complete & verified in software.** Remaining: **Phase 4 — on-robot bench test + calibrate the real 90° turn** (needs the hardware).
Full Auto pipeline is wired end-to-end: UI toggle → backend (`robot/mode` retained +
always-on recording) → motion worker (forward + head scan → obstacle turns right → resume,
approach human/fire, live turn-timing calibration). The pipeline was verified in software
by manual curl/MQTT exercise of every endpoint and topic (no automated test suite is
committed yet — see Phase 3 checklist); the only thing left is running it on the robot
and dialling in `AUTO_TURN_MS`.
</content>
</invoke>
