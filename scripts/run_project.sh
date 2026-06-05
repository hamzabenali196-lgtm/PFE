#!/usr/bin/env bash
set -e

PROJECT_DIR="/home/pi/PFE"

cleanup() {
  if [ -n "${ROBOT_PID:-}" ] && kill -0 "$ROBOT_PID" 2>/dev/null; then
    kill "$ROBOT_PID" 2>/dev/null || true
  fi

  if [ -n "${MOTION_PID:-}" ] && kill -0 "$MOTION_PID" 2>/dev/null; then
    kill "$MOTION_PID" 2>/dev/null || true
  fi

  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

sudo systemctl start mosquitto

cd "$PROJECT_DIR"
python3 robot_motion_worker.py &
MOTION_PID=$!

cd "$PROJECT_DIR"
python3 robot_final.py &
ROBOT_PID=$!

cd "$PROJECT_DIR/backend"
npm run dev &
BACKEND_PID=$!

cd "$PROJECT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

wait "$MOTION_PID" "$ROBOT_PID" "$BACKEND_PID" "$FRONTEND_PID"
