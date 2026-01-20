#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BACKEND_PORT=${WIZARD_FIGHT_PORT:-5055}
FRONTEND_PORT=${WIZARD_FIGHT_FRONTEND_PORT:-5175}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID"
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID"
  fi
}

trap cleanup EXIT

(
  cd "$ROOT_DIR"
  WIZARD_FIGHT_PORT="$BACKEND_PORT" WIZARD_FIGHT_HOST=0.0.0.0 \
    /workspaces/megarepo/.venv/bin/python -m wizard_fight.server
) &
BACKEND_PID=$!

(
  cd "$ROOT_DIR/frontend"
  VITE_SOCKET_URL="http://localhost:$BACKEND_PORT" \
    npm run dev -- --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

wait
