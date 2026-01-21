#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.wizard_fight_dev.pids"

BACKEND_PORT=${WIZARD_FIGHT_PORT:-5055}
FRONTEND_PORT=${WIZARD_FIGHT_FRONTEND_PORT:-5175}
LLM_MODE=${WIZARD_FIGHT_LLM_MODE:-local}
LOCAL_BACKEND=${WIZARD_FIGHT_LOCAL_BACKEND:-ollama}
OLLAMA_URL=${WIZARD_FIGHT_OLLAMA_URL:-http://localhost:11434/api/generate}
OLLAMA_MODEL=${WIZARD_FIGHT_OLLAMA_MODEL:-llama3.2}

stop_pid() {
  local pid="$1"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    wait "$pid" 2>/dev/null || true
  fi
}

stop_by_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  for pid in $pids; do
    stop_pid "$pid"
  done
}

restart_if_running() {
  if [[ -f "$PID_FILE" ]]; then
    read -r old_backend old_frontend < "$PID_FILE" || true
    stop_pid "$old_backend"
    stop_pid "$old_frontend"
  fi
  stop_by_port "$BACKEND_PORT"
  stop_by_port "$FRONTEND_PORT"
}

cleanup() {
  stop_pid "${BACKEND_PID:-}"
  stop_pid "${FRONTEND_PID:-}"
  rm -f "$PID_FILE"
}

trap cleanup EXIT

restart_if_running

(
  cd "$ROOT_DIR"
  PYTHONPATH="$ROOT_DIR/src" \
    WIZARD_FIGHT_PORT="$BACKEND_PORT" \
    WIZARD_FIGHT_HOST=0.0.0.0 \
    WIZARD_FIGHT_LLM_MODE="$LLM_MODE" \
    WIZARD_FIGHT_LOCAL_BACKEND="$LOCAL_BACKEND" \
    WIZARD_FIGHT_OLLAMA_URL="$OLLAMA_URL" \
    WIZARD_FIGHT_OLLAMA_MODEL="$OLLAMA_MODEL" \
    /workspaces/megarepo/.venv/bin/python -m wizard_fight.server
) &
BACKEND_PID=$!

(
  cd "$ROOT_DIR/frontend"
  /workspaces/megarepo/.venv/bin/python -m http.server "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

echo "$BACKEND_PID $FRONTEND_PID" > "$PID_FILE"

wait
