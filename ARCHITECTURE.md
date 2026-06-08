# Spider Robot — Full Architecture

> Master's project — Raspberry Pi 5 hexapod robot with real-time web dashboard, computer vision, and MQTT-based control.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture Diagram](#system-architecture-diagram)
3. [Hardware Layer](#hardware-layer)
4. [Software Layers](#software-layers)
   - [Python — Vision & Detection](#1-python--vision--detection-robot_finalpy)
   - [Python — Motion Worker](#2-python--motion-worker-robot_motion_workerpy)
   - [Python — Robot Controller](#3-python--robot-controller-robot_controllerpy)
   - [Python — Lobot Serial Driver](#4-python--lobot-serial-driver-lobot_controllerpy)
   - [MQTT Broker](#5-mqtt-broker-mosquitto)
   - [Node.js Backend](#6-nodejs-backend-backend)
   - [React Frontend](#7-react-frontend-frontend)
5. [MQTT Topic Map](#mqtt-topic-map)
6. [Data Flows](#data-flows)
   - [Motion Command Flow](#a-motion-command-flow)
   - [Vision Detection Flow](#b-vision-detection-flow)
   - [Live Video Stream Flow](#c-live-video-stream-flow)
7. [Movement System](#movement-system)
8. [Auto-Start on Boot](#auto-start-on-boot)
9. [Network & Phone Access](#network--phone-access)
10. [File Structure](#file-structure)
11. [Environment Variables](#environment-variables)

---

## Overview

The Spider Robot is a 6-legged robot (hexapod) built around a Raspberry Pi 5. It uses:

- **18 servo motors** (3 per leg: hip, knee, ankle) controlled over UART serial.
- **USB camera** for live MJPEG streaming and real-time face detection using a Caffe SSD model.
- **USB microphone** for audio recording and voice command detection.
- **MQTT** as the internal message bus tying every component together.
- **Node.js/Socket.IO backend** as the real-time bridge between MQTT and the web UI.
- **React frontend** served on the local network, accessible from any device on the same Wi-Fi.

---

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        RASPBERRY PI 5                            │
│                                                                  │
│  ┌─────────────────┐       ┌──────────────────────────────────┐  │
│  │  robot_final.py │       │    robot_motion_worker.py        │  │
│  │                 │       │                                  │  │
│  │  OpenCV camera  │       │  Receives commands from MQTT     │  │
│  │  Face detection │       │  Dispatches to                   │  │
│  │  (Caffe SSD)    │       │  SpiderRobotController           │  │
│  │                 │       │                                  │  │
│  │  Publishes:     │       │  robot_controller.py             │  │
│  │  robot/flux     │       │  ├─ MovementLibrary (gaits)      │  │
│  │  robot/photo    │       │  ├─ show moves (sway/tiptoe/…)   │  │
│  │  robot/detection│       │  └─ LobotController              │  │
│  │  robot/alerte   │       │       │                          │  │
│  │  robot/localisa.│       │       │ UART serial              │  │
│  └────────┬────────┘       └───────┼──────────────────────────┘  │
│           │                        │                              │
│           │   ┌────────────────────▼─────────┐                   │
│           │   │         /dev/ttyAMA0          │                   │
│           │   │     LobotController           │                   │
│           │   │  Builds & sends binary        │                   │
│           │   │  servo packets (18 servos)    │                   │
│           │   └──────────────┬────────────────┘                   │
│           │                  │                                    │
│    ┌──────▼──────────────────▼─────────────────────────────────┐ │
│    │               MQTT BROKER  (Mosquitto :1883)              │ │
│    │                                                           │ │
│    │  Inbound topics              Outbound topics              │ │
│    │  robot/flux                  robot/command                │ │
│    │  robot/photo                 robot/servo/oy               │ │
│    │  robot/detection             robot/servo/oz               │ │
│    │  robot/alerte_vocale                                      │ │
│    │  robot/localisation                                       │ │
│    │  robot/status                                             │ │
│    │  robot/motion/status                                      │ │
│    │  robot/motion/event                                       │ │
│    └──────────────────────────────────┬────────────────────────┘ │
│                                       │                          │
│    ┌──────────────────────────────────▼────────────────────────┐ │
│    │              Node.js Backend  (:4000)                     │ │
│    │                                                           │ │
│    │  Express REST API         Socket.IO (real-time)           │ │
│    │  /api/robot/*             robot:frame                     │ │
│    │  /api/health              robot:alert                     │ │
│    │  /screenshots/*           robot:state                     │ │
│    │  /recordings/*            robot:status                    │ │
│    │  /videos/*                robot:history:add               │ │
│    │                           robot:photo                     │ │
│    │  micService  ──arecord    robot:mic                       │ │
│    │  videoService──ffmpeg     robot:video                     │ │
│    │  historyStore──filesystem robot:location                  │ │
│    └──────────────────────────────────┬────────────────────────┘ │
│                                       │                          │
│    ┌──────────────────────────────────▼────────────────────────┐ │
│    │              Vite / React Frontend  (:5173)               │ │
│    │                                                           │ │
│    │  LiveCamera   AlertPanel    ServoControls  LocationPanel  │ │
│    │  MicPanel     VideoRecorder DetectionHistory StatusBadge  │ │
│    └───────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
          │
          │  Wi-Fi  (phone hotspot, fixed IP 192.168.137.57)
          │
    ┌─────▼──────┐
    │   Phone    │  http://192.168.137.57:5173
    │  Browser   │
    └────────────┘
```

---

## Hardware Layer

| Component | Details |
|---|---|
| **Board** | Raspberry Pi 5 |
| **Servos** | 18× LobotServo — 3 per leg (hip, knee, ankle) |
| **Serial** | UART `/dev/ttyAMA0` at 9600 baud |
| **Camera** | USB webcam, OpenCV `VideoCapture(0)` |
| **Microphone** | USB mic, ALSA `arecord` |
| **Connectivity** | Wi-Fi, connected to phone hotspot |
| **Leg layout** | TRIPOD_A: leg_1, leg_3, leg_5 / TRIPOD_B: leg_2, leg_4, leg_6 |
| **Sides** | LEFT: leg_1–3 / RIGHT: leg_4–6 |

### Servo ID Layout

Each leg has 3 servos, numbered consecutively:

```
leg_1: hip=1  knee=2  ankle=3    (left front)
leg_2: hip=4  knee=5  ankle=6    (left middle)
leg_3: hip=7  knee=8  ankle=9    (left rear)
leg_4: hip=10 knee=11 ankle=12   (right front)
leg_5: hip=13 knee=14 ankle=15   (right middle)
leg_6: hip=16 knee=17 ankle=18   (right rear)
```

### Servo Position Reference

| Constant | Value | Meaning |
|---|---|---|
| `CENTER` | 1500 | Neutral / home position |
| `STAND_HEIGHT` | 1300 | Normal standing ankle position |
| `KNEE_GROUND` | 1500 | Knee fully down |
| `KNEE_LIFT` | 900 | Knee raised (leg lifted off ground) |
| `ANKLE_LIFT` | 800 | Ankle raised |
| `HIP_NEUTRAL` | 1500 | Hip pointing straight |
| `HIP_STEP_FORWARD` | 1750 | Hip pushed forward |
| `HIP_STEP_BACK` | 1250 | Hip pushed back |

---

## Software Layers

### 1. Python — Vision & Detection (`robot_final.py`)

**What it does:** Runs continuously, reading frames from the USB camera, running face detection, and publishing results to MQTT.

**Face detection model:** OpenCV DNN with a pre-trained Caffe SSD network:
- `deploy.prototxt` — network architecture
- `res10_300x300_ssd_iter_140000.caffemodel` — pre-trained weights
- Confidence threshold: `0.6`

**Stability filter:** A raw detection is only accepted after 8 consecutive frames agree (`frames_stables_detection = 8`). This prevents false alerts from a single bad frame.

**On human detected:**
1. Publishes alert text to `robot/alerte_vocale` and `robot/detection`
2. Publishes a JPEG snapshot to `robot/photo`
3. Publishes GPS coordinates to `robot/localisation`

**On human gone:**
1. Publishes a clear message to `robot/detection`

**Every frame:** Publishes a base64-encoded JPEG to `robot/flux` (live stream at ~20 fps, quality 25).

**Legacy TCP socket:** Optionally sends frames to a PC viewer at `PC_IP:5005` — fails silently if unavailable.

---

### 2. Python — Motion Worker (`robot_motion_worker.py`)

**What it does:** Subscribes to `robot/command`, translates commands into robot movements, and manages the walk/run loop.

**Two command types:**

| Type | Examples | Behaviour |
|---|---|---|
| **One-shot** | `hi`, `bow`, `shake`, `wave`, `bounce`, `sway`, `tiptoe`, `ripple`, `pulse` | Runs once, returns to idle |
| **Continuous** | `forward`, `backward`, `left`, `right` | Loops phase-by-phase until a new command arrives |

**Threading model:** A single background thread runs the main loop. Commands arrive via a `queue.Queue`. When walking, the loop calls `run_phase()` on each iteration and checks the queue between phases (non-blocking). When idle, it blocks on the queue waiting for the next command.

**Speed & height:** Adjustable via `speed:N` (1–10) and `height:N` commands. Speed is converted to `step_time_ms` for walk phases.

**MQTT feedback:** Publishes to `robot/motion/status` (online/offline) and `robot/motion/event` after each command.

---

### 3. Python — Robot Controller (`robot_controller.py`)

**What it does:** High-level abstraction over the 18 servos. Knows nothing about MQTT — it just provides named moves.

**Key classes:**

- **`LegPose`** — A dataclass holding `hip`, `knee`, `ankle` target positions (each can be `None` to leave unchanged).
- **`GroupPose`** — A pose applied to a named group of legs within one gait phase.
- **`MotionPhase`** — A list of `GroupPose`s executed simultaneously. Represents one step of a gait cycle.
- **`MotionPlan`** — A named sequence of `MotionPhase`s forming a complete repeating gait.
- **`MovementLibrary`** — Pre-defined plans for `forward`, `backward`, `left`, `right`. Uses the tripod gait.
- **`SpiderRobotController`** — Top-level controller. Methods: `stand`, `move_all`, `move_leg`, `move_legs`, and all expressive/show actions.

**Tripod gait principle:**  
While TRIPOD_A legs (1, 3, 5) swing forward in the air, TRIPOD_B legs (2, 4, 6) push against the ground — then they swap. This keeps the robot stable with at least 3 legs on the ground at all times.

**Show/expressive moves:**

| Command | What it does | Duration |
|---|---|---|
| `hi` | Lifts leg_6 and waves it side to side | ~3 s |
| `bow` | Dips front half of body, rear legs brace | ~2 s |
| `shake` | All hips oscillate left/right (shimmy) | ~2 s |
| `wave` | Each leg taps knee in sequence (Mexican wave) | ~2 s |
| `bounce` | All legs pulse up/down together | ~2 s |
| `sway` | Left/right ankle differential tilts body side to side | ~3 s |
| `tiptoe` | Rise on extended ankles, tripods alternate tiny lifts | ~3 s |
| `ripple` | Rolling knee-tap from leg_1 to leg_6, repeated | ~4 s |
| `pulse` | Slow breathing crouch — knees bend and extend | ~6 s |

---

### 4. Python — Lobot Serial Driver (`lobot_controller.py`)

**What it does:** Lowest layer. Builds and sends the binary serial packet format expected by the Lobot servo controller board.

**Packet format** (`CMD_SERVO_MOVE = 0x03`):

```
[0x55][0x55][length][0x03][count][time_lo][time_hi]
  followed by count × [servo_id][pos_lo][pos_hi]
```

- Header: two `0x55` bytes
- Length: `count × 3 + 5`
- Time: 16-bit little-endian milliseconds
- Each servo: ID + 16-bit little-endian position

All multi-servo moves are sent in a **single packet** so all servos start moving simultaneously.

---

### 5. MQTT Broker (Mosquitto)

Runs as a system service on `localhost:1883`. Acts as the central nervous system — every Python process and the Node.js backend communicate exclusively through it. Started automatically via `sudo systemctl start mosquitto` (in the run script) or as a systemd dependency.

---

### 6. Node.js Backend (`backend/`)

**Stack:** Express + Socket.IO + MQTT.js  
**Port:** `4000`

**Responsibilities:**

| Module | Purpose |
|---|---|
| `server.js` | HTTP server, Socket.IO, wires everything together |
| `mqttClient.js` | MQTT subscriber/publisher, translates MQTT→Socket.IO events |
| `state.js` | In-memory `robotState` object, shared across modules |
| `config.js` | Env-based configuration (`PORT`, `MQTT_URL`, etc.) |
| `historyStore.js` | Persists detection screenshots to disk as JSON metadata |
| `micService.js` | Spawns/kills `arecord`, streams raw PCM, writes WAV files |
| `videoService.js` | Spawns `ffmpeg`, pipes JPEG frames + PCM audio into MP4 |
| `routes/robotRoutes.js` | REST endpoints for state, history, mic, video, commands |

**Real-time bridge:**  
When a MQTT message arrives → `mqttClient.handleMessage()` updates `robotState` and emits a matching Socket.IO event to all connected browser clients. When a browser sends a command → `publishCommand()` forwards it to `robot/command` on MQTT.

**Video recording pipeline:**
```
USB mic (arecord) ──PCM chunks──► micService
                                       │
                                       ├──► WAV file (audio recording)
                                       └──► ffmpeg pipe:3 (video audio track)

USB camera (robot_final.py) ──JPEG──► MQTT robot/flux
                                           │
                                 mqttClient.handleVideoFrame()
                                           │
                                       ffmpeg pipe:0 (video frames)
                                           │
                                       MP4 file (H.264 + AAC)
```

**REST API summary:**

```
GET  /api/health              — uptime + MQTT status
GET  /api/robot/state         — full robotState snapshot
GET  /api/robot/history       — detection history list
DEL  /api/robot/history/:id   — remove one detection entry
GET  /api/robot/mic           — mic state
POST /api/robot/mic           — enable/disable mic  { enabled: bool }
POST /api/robot/recordings/start
POST /api/robot/recordings/stop
DEL  /api/robot/recordings/:id
POST /api/robot/videos/start
POST /api/robot/videos/stop
DEL  /api/robot/videos/:id
POST /api/robot/command       — send motion command  { command: string }
POST /api/robot/servo         — move camera servo    { axis: "oy"|"oz", value: 0–180 }
```

---

### 7. React Frontend (`frontend/`)

**Stack:** React 18 + Vite + Socket.IO client + Lucide icons  
**Port:** `5173` (Vite dev server, bound to `0.0.0.0`)

**Component map:**

```
App.jsx  (root — holds all state, socket connection)
├── header
│   ├── ConnectionPill (Backend socket status)
│   ├── ConnectionPill (MQTT status)
│   └── StatusBadge
├── primary-stack
│   └── LiveCamera       — MJPEG frame display (base64 img)
├── side-stack
│   ├── ServoControls    — D-pad + action buttons + speed slider
│   ├── AlertPanel       — last detection alert + snapshot photo
│   ├── MicPanel         — mic toggle + voice command (Web Speech API)
│   ├── VideoRecorder    — start/stop recording + video list
│   └── DetectionHistory — timestamped detection log with screenshots
└── location-stack
    └── LocationPanel    — GPS coordinates display
```

**ServoControls action buttons:**

| Button | Command sent | Robot action |
|---|---|---|
| Hi | `HELLO` | Wave with leg_6 |
| Bow | `bow` | Forward bow |
| Shake | `shake` | Hip shimmy |
| Wave | `wave` | Mexican wave |
| Bounce | `bounce` | Body pump |
| Sway | `sway` | Side-to-side tilt |
| Tiptoe | `tiptoe` | Rise and shuffle on toes |
| Ripple | `ripple` | Rolling knee wave |
| Pulse | `pulse` | Breathing crouch |

**Voice commands (MicPanel):**  
Uses the browser's Web Speech API. Recognized phrases (French/English):
- "saluer" / "hello" / "bonjour" → sends `HELLO`
- "gauche" / "left" → sends `left`
- "droite" / "right" → sends `right`

**Voice alert (App.jsx):**  
When a detection alert arrives, `window.speechSynthesis` reads the alert text aloud in the browser (can be toggled off).

---

## MQTT Topic Map

```
DIRECTION         TOPIC                    PUBLISHER           SUBSCRIBER
─────────────────────────────────────────────────────────────────────────
outbound ──►  robot/flux              robot_final.py       backend (→ Socket.IO robot:frame)
outbound ──►  robot/photo             robot_final.py       backend (→ screenshot save + robot:photo)
outbound ──►  robot/detection         robot_final.py       backend (→ robot:alert)
outbound ──►  robot/alerte_vocale     robot_final.py       backend (→ robot:alert)
outbound ──►  robot/localisation      robot_final.py       backend (→ robot:location)
outbound ──►  robot/status            robot_final.py       backend (→ robot:status)
outbound ──►  robot/motion/status     motion_worker.py     backend (→ robot:status)
outbound ──►  robot/motion/event      motion_worker.py     backend (→ robot:event)

inbound  ◄──  robot/command           backend              motion_worker.py
inbound  ◄──  robot/servo/oy          backend              robot_final.py (TODO: horizontal servo)
inbound  ◄──  robot/servo/oz          backend              robot_final.py (TODO: tilt servo)
```

---

## Data Flows

### A. Motion Command Flow

```
User taps "Sway" button in browser
        │
        ▼
ServoControls.jsx
  onDriveCommand('sway')
        │
        ▼
App.jsx → postRobotCommand('sway')
        │
        ▼
POST /api/robot/command  { command: 'sway' }
        │
        ▼
backend/mqttClient.js → publishCommand('sway')
        │
        ▼
MQTT broker  topic: robot/command  payload: "sway"
        │
        ▼
robot_motion_worker.py  on_message()
  → normalize_command('sway') → 'sway'
  → commands.put('sway')
        │
        ▼
MotionWorker main loop
  → one_shot_handlers()['sway']()
  → robot.sway()
        │
        ▼
SpiderRobotController.sway()
  for each cycle:
    move_legs({left: ankle=1150, right: ankle=1430})
    move_legs({left: ankle=1430, right: ankle=1150})
        │
        ▼
LobotController.move_servos([...18 servos...], time_ms)
        │
        ▼
UART /dev/ttyAMA0 → servo board → physical leg movement
```

### B. Vision Detection Flow

```
USB Camera frame
        │
        ▼
robot_final.py  cap.read()
        │
        ▼
OpenCV DNN  face_net.forward()
  confidence > 0.6 → nb_faces++
        │
        ▼
Stability filter
  8 consecutive frames agree?
        │ yes
        ▼
Publish to MQTT:
  robot/alerte_vocale  "Presence humaine detectee"
  robot/detection      "Presence humaine detectee"
  robot/photo          <base64 JPEG snapshot>
  robot/localisation   "35.7649,10.8062"
        │
        ▼
backend/mqttClient.js  handleMessage()
  → robotState.lastAlert updated
  → pendingDetection set
  → io.emit('robot:alert', ...)
  → saveDetectionScreenshot() after cooldown (15s)
        │
        ▼
Browser (App.jsx)
  socket.on('robot:alert') → setRobot state
  → AlertPanel shows alert text + snapshot
  → speechSynthesis speaks the alert text
  → DetectionHistory adds entry with timestamp
```

### C. Live Video Stream Flow

```
USB Camera frame (every 50ms)
        │
        ▼
robot_final.py
  cv2.imencode('.jpg', frame, quality=25)
  base64.b64encode(buffer)
  mqtt.publish('robot/flux', b64string)
        │
        ▼
MQTT → backend mqttClient.js
  handleVideoFrame(text)  ← also pipes to ffmpeg if recording
  io.emit('robot:frame', { image, frameCount, receivedAt })
        │
        ▼
Browser LiveCamera.jsx
  socket.on('robot:frame') → <img src="data:image/jpeg;base64,..." />
  (re-renders on each frame, ~20 fps)
```

---

## Movement System

The gait system is built around reusable, declarative **motion plans** rather than hard-coded servo sequences.

### Tripod gait (walk/turn)

A complete walk cycle has **4 phases**:

```
Phase 0 — TRIPOD_A lifts  (knee up, ankle up)
Phase 1 — TRIPOD_A swings forward, TRIPOD_B pushes back (hip movement)
Phase 2 — TRIPOD_A lands  (knee down, ankle down)
Phase 3 — TRIPOD_B lifts → swings → lands (same but swapped)
```

The motion worker calls `run_phase(direction, phase_index)` one phase at a time so it can check for new commands between phases without waiting for a full cycle.

### Hip mirroring

Right-side legs (`leg_4–6`) have their hip direction mirrored (`MIRROR_RIGHT_HIPS = True`). A "forward" hip command maps to `HIP_STEP_FORWARD` on the left but `HIP_STEP_BACK` on the right, so both sides push in the same physical direction.

### Show moves

Show moves use direct `move_all()` / `move_legs()` / `move_leg()` calls — no gait phases. They are designed to be visually interesting with small, smooth ankle/knee changes only:

- **sway** — ankle differential between left and right sides creates a body tilt
- **tiptoe** — all legs extend high (`ankle=1080`), then tripods alternate tiny knee taps
- **ripple** — each leg taps knee from 1500→1200→1500 in sequence, leg_1 to leg_6
- **pulse** — all knees bend slightly (`knee=1250`) then return, slow breathing rhythm

---

## Auto-Start on Boot

A systemd service starts the entire stack automatically when the Pi boots.

**Service file:** `/etc/systemd/system/pfe.service`

```ini
[Unit]
Description=PFE Spider Robot Project
After=network-online.target mosquitto.service
Wants=network-online.target mosquitto.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/PFE
ExecStart=/bin/bash /home/pi/PFE/scripts/run_project.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**`scripts/run_project.sh` start order:**
1. `sudo systemctl start mosquitto` — ensures broker is up
2. `python3 robot_motion_worker.py` — motion control
3. `python3 robot_final.py` — vision + camera
4. `npm run dev` (backend) — REST + Socket.IO server
5. `npm run dev` (frontend) — Vite dev server

The script traps `EXIT`/`INT`/`TERM` and kills all child processes on shutdown.

**Useful commands:**
```bash
sudo systemctl status pfe       # check if running
sudo journalctl -u pfe -f       # live logs
sudo systemctl restart pfe      # restart after code change
sudo systemctl stop pfe         # stop everything
```

---

## Network & Phone Access

The Pi connects to the **phone's mobile hotspot**. The IP is fixed at **`192.168.137.57`** (Windows hotspot default subnet — does not change as long as the same hotspot is used).

**Open in phone browser:**
```
http://192.168.137.57:5173      ← React UI (full dashboard)
http://192.168.137.57:4000/api/health  ← backend health check
```

No configuration needed — the Vite dev server and Express are both bound to `0.0.0.0`.

---

## File Structure

```
PFE/
├── robot_final.py                  # Vision + face detection + MQTT publisher
├── robot_motion_worker.py          # Motion command queue + MQTT subscriber
├── robot_controller.py             # High-level servo controller (gaits + show moves)
├── lobot_controller.py             # Low-level UART serial driver
├── deploy.prototxt                 # Caffe SSD network architecture
├── res10_300x300_ssd_iter_140000.caffemodel  # Pre-trained face detection weights
├── yolov8n.pt                      # YOLOv8 weights (available for future use)
├── requirements.txt                # Python deps: opencv, paho-mqtt, pyserial, ultralytics
├── scripts/
│   └── run_project.sh              # Launches all 4 processes
├── arduino_spider_servos/
│   └── arduino_spider_servos.ino   # Arduino prototype (tripod walk, sayHi)
├── backend/
│   ├── src/
│   │   ├── server.js               # Express + Socket.IO entry point
│   │   ├── config.js               # Env-based config
│   │   ├── state.js                # Shared in-memory robotState
│   │   ├── mqttClient.js           # MQTT ↔ Socket.IO bridge
│   │   ├── historyStore.js         # Detection screenshot persistence
│   │   ├── micService.js           # arecord process + WAV recording
│   │   ├── videoService.js         # ffmpeg process + MP4 recording
│   │   └── routes/robotRoutes.js   # REST API handlers
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Root component, socket connection, state
│   │   ├── lib/api.js              # Typed API helpers (fetch + socket)
│   │   ├── styles.css              # Light theme, responsive grid
│   │   └── components/
│   │       ├── ServoControls.jsx   # D-pad + action buttons + speed
│   │       ├── LiveCamera.jsx      # Real-time MJPEG display
│   │       ├── AlertPanel.jsx      # Detection alert + snapshot
│   │       ├── MicPanel.jsx        # Mic toggle + voice commands
│   │       ├── VideoRecorder.jsx   # Video start/stop + recordings list
│   │       ├── DetectionHistory.jsx# Timestamped detection log
│   │       ├── LocationPanel.jsx   # GPS coordinates
│   │       ├── StatusBadge.jsx     # Online/offline indicator
│   │       └── EventLog.jsx        # Raw event log
│   └── .env.example
└── /etc/systemd/system/pfe.service # Auto-start service (not in repo)
```

---

## Environment Variables

**Backend** (`backend/.env`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP server port |
| `MQTT_URL` | `mqtt://localhost:1883` | Mosquitto broker URL |
| `FRONTEND_ORIGIN` | `*` | CORS allowed origins |
| `MIC_DEVICE` | `auto` | ALSA device, e.g. `plughw:1,0` or `auto` |

**Frontend** (`frontend/.env`):

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Backend URL used by the browser |
