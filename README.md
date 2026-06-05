# Robot Spider

Robot Spider is now separated into four managed parts:

```text
Python motion worker  <-  MQTT broker  <-  Node.js backend  <-  React frontend
servo commands            Mosquitto        REST + Socket.IO      dashboard UI

Python camera worker   ->  MQTT broker  ->  Node.js backend  ->  React frontend
camera + OpenCV            Mosquitto        live updates          dashboard UI
```

The motion worker owns servo commands. The camera worker owns camera and AI detection. The Node.js backend manages MQTT, API routes, realtime browser updates, and robot commands. The React frontend is the dashboard.

## Project Layout

```text
PFE/
  robot_motion_worker.py     # Python MQTT command listener and servo runner
  robot_controller.py        # High-level leg movement controller
  robot_final.py              # Python camera, detection, MQTT publisher
  deploy.prototxt             # OpenCV face detector config
  res10_300x300_...caffemodel # OpenCV face detector model
  requirements.txt            # Python dependencies

  backend/
    src/server.js             # Express + Socket.IO server
    src/mqttClient.js         # MQTT bridge
    src/routes/robotRoutes.js # REST robot commands

  frontend/
    src/App.jsx               # React dashboard
    src/components/           # Camera, controls, alerts, map, events

  web/index.html              # Legacy standalone HTML dashboard
```

## MQTT Topics

Robot publishes:

- `robot/flux`: base64 JPEG live camera frame
- `robot/photo`: base64 JPEG alert snapshot
- `robot/localisation`: coordinates as `lat,lon`
- `robot/alerte_vocale`: voice alert text
- `robot/detection`: detection alert text
- `robot/status`: robot status
- `robot/motion/status`: motion worker status
- `robot/motion/event`: last motion command executed

Backend publishes commands:

- `robot/command`: high-level commands like `HELLO` or `POSITION_REPOS`
- `robot/servo/oy`: horizontal servo angle, `0` to `180`
- `robot/servo/oz`: height/extension servo angle, `0` to `180`

Drive controls:

- Press `Z` or `ArrowUp`: publishes `start:run`; release publishes `stand`
- Press `S` or `ArrowDown`: publishes `start:backward`; release publishes `stand`
- Press `Q` or `ArrowLeft`: publishes `start:left`; release publishes `stand`
- Press `D` or `ArrowRight`: publishes `start:right`; release publishes `stand`

## Quick Start (one-liner)

```bash
sudo systemctl start mosquitto && cd /home/pi/PFE && python3 robot_motion_worker.py & python3 robot_final.py & cd backend && npm run dev & cd ../frontend && npm run dev
```

## Install Python Robot Service

```bash
sudo apt update
sudo apt install -y mosquitto python3-pip
python3 -m pip install --user --upgrade pip
python3 -m pip install --user -r requirements.txt
```

If Raspberry Pi OS blocks user installs with an externally-managed-environment error, use:

```bash
python3 -m pip install --break-system-packages -r requirements.txt
```

Start Mosquitto:

```bash
sudo systemctl enable --now mosquitto
```

Run the motion worker:

```bash
python3 robot_motion_worker.py
```

Run the camera worker:

```bash
python3 robot_final.py
```

## Install Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Default backend URL:

```text
http://localhost:4000
```

Backend health check:

```text
http://localhost:4000/api/health
```

## Install Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Default frontend URL:

```text
http://localhost:5173
```

If you open the dashboard from another machine, set `frontend/.env` like this:

```text
VITE_API_URL=http://<raspberry-pi-ip>:4000
```

## Notes

- The old Node-RED dashboard can remain installed, but the new React dashboard does not depend on it.
- `robot_final.py` currently logs servo and command messages. Add real GPIO/servo movement inside the TODO blocks when the hardware pins are confirmed.
- The backend already exposes REST endpoints and Socket.IO events, so adding authentication, database history, or more robot commands later will be straightforward.
- Detection history screenshots are saved under `backend/data/screenshots` while the backend is running. The backend clears that folder on backend startup and when `robot_final.py` starts, keeps at most 30 items, saves at most one detection screenshot every 15 seconds, and lets the dashboard delete selected screenshots.
- The USB microphone is controlled from the dashboard through the backend. It uses `arecord` with `MIC_DEVICE=auto` by default, selects the first capture device from `arecord -l`, streams a live audio level, and stops the capture process when deactivated. If auto-detection chooses the wrong input, set `MIC_DEVICE=plughw:<card>,<device>` in `backend/.env` using the card/device numbers shown by `arecord -l`. Browser speech commands are also enabled when supported by the browser.
- Mic recordings are saved as WAV files under `backend/data/recordings`. The dashboard can record, stop, play, download, and delete recordings. The backend clears old recordings on backend startup and when `robot_final.py` starts, and keeps at most 20 recordings during a run.
- Media recordings are saved as MP4 files under `backend/data/videos`. The single dashboard record button captures the live `robot/flux` frames plus USB microphone audio, so person-detection boxes drawn by `robot_final.py` and sound are included in the same downloadable video. The dashboard can record, stop, play, download, and delete videos. The backend clears old videos on backend startup and when `robot_final.py` starts, and keeps at most 10 videos during a run.
