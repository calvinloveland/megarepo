#!/usr/bin/env bash
# Auto-restarting launcher for Washing Machine Tycoon
PORT="${PORT:-3002}"
DIR="$(cd "$(dirname "$0")" && pwd)"

while true; do
  echo "[$(date)] Starting WMT server on port $PORT..."
  cd "$DIR" && PORT="$PORT" node server.mjs
  EXIT_CODE=$?
  echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 2s..."
  sleep 2
done
