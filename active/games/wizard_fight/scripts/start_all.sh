#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLLAMA_PID_FILE="$ROOT_DIR/.wizard_fight_ollama.pid"
OLLAMA_LOG="$ROOT_DIR/ollama.log"
STARTED_OLLAMA=0
OLLAMA_PID=""

start_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    echo "ollama not found on PATH. Install it or run scripts/dev.sh directly."
    return
  fi
  if curl -fs http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "ollama already running."
    return
  fi
  nohup ollama serve > "$OLLAMA_LOG" 2>&1 &
  OLLAMA_PID=$!
  STARTED_OLLAMA=1
  echo "$OLLAMA_PID" > "$OLLAMA_PID_FILE"
  sleep 1
}

cleanup() {
  if [[ "$STARTED_OLLAMA" == "1" ]] && [[ -n "$OLLAMA_PID" ]]; then
    if kill -0 "$OLLAMA_PID" 2>/dev/null; then
      kill "$OLLAMA_PID"
      wait "$OLLAMA_PID" 2>/dev/null || true
    fi
  fi
  if [[ -f "$OLLAMA_PID_FILE" ]]; then
    rm -f "$OLLAMA_PID_FILE"
  fi
}

trap cleanup EXIT

start_ollama

"$ROOT_DIR/scripts/dev.sh"
