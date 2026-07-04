#!/usr/bin/env bash
set -o pipefail

PROJECT_DIR="/home/pi/PFE"

# Sound/speaker output (paplay/pacat/espeak) goes through the user's PipeWire
# session; systemd doesn't set this, and without it every audio call fails.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# PIDs of the processes we launch directly (npm, python, ...). Each of these may
# fork grandchildren — npm -> nodemon -> node, vite -> esbuild — so on shutdown we
# must kill the WHOLE tree, not just these PIDs. A plain `kill $pid` left those
# grandchildren orphaned and still holding port 4000 / the camera / the GPIO,
# which is why the project kept running after the script was stopped.
PIDS=()

# Recursively send a signal to a process and all of its descendants (deepest first).
kill_tree() {
  local sig=$1 pid=$2 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$sig" "$child"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT   # disarm so cleanup runs exactly once
  echo
  echo "Arret du projet - extinction de tous les processus..."

  # Polite shutdown first.
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill_tree TERM "$pid"
  done

  # Give them up to ~3s to exit, then force-kill whatever is left.
  for _ in 1 2 3 4 5 6; do
    local alive=0
    for pid in "${PIDS[@]:-}"; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
    done
    [ "$alive" -eq 0 ] && break
    sleep 0.5
  done

  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill_tree KILL "$pid"
  done
  echo "Arrete."
}

# INT/TERM (Ctrl+C, systemctl stop) and normal EXIT all funnel through cleanup.
trap cleanup INT TERM EXIT

# Shared broker — start it but don't kill it on exit (other things may use it).
sudo systemctl start mosquitto 2>/dev/null || true

cd "$PROJECT_DIR"
python3 robot_motion_worker.py &
PIDS+=("$!")

python3 robot_final.py &
PIDS+=("$!")

cd "$PROJECT_DIR/backend"
npm run dev &
PIDS+=("$!")

cd "$PROJECT_DIR/frontend"
npm run dev &
PIDS+=("$!")

echo "Projet demarre (PIDs: ${PIDS[*]}). Ctrl+C pour tout arreter."

# Wait for the FIRST process to exit. If any one dies (or crashes), we fall through
# and the EXIT trap tears the rest down — no half-running project, no orphans.
wait -n
