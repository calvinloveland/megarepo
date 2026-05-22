#!/bin/bash
# Launch the Pokemon Binder Scanner web app
# Uses /data for card storage and cache
#
# Usage:
#   ./scripts/run_webapp.sh              # start foreground
#   ./scripts/run_webapp.sh --daemon     # start background, log to file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_ROOT="/data/home/calvin/pokemon-binder-scanner"
VENV_PYTHON="$DATA_ROOT/.venv/bin/python3"
LOG_DIR="$DATA_ROOT/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Default manifest: use the expanded one if it exists, otherwise fall back to the fixture
EXPANDED_MANIFEST="$DATA_ROOT/expanded_binder_manifest.json"
FIXTURE_MANIFEST="$PROJECT_DIR/tests/fixtures/pokemon_binder/manifest.json"

# Default to the lean fixture manifest for fast interactive scanning.
# Set POKEMON_BINDER_MANIFEST_PATH to the expanded manifest for bulk testing.
if [ -n "${POKEMON_BINDER_MANIFEST_PATH:-}" ]; then
    MANIFEST_PATH="$POKEMON_BINDER_MANIFEST_PATH"
    echo "Using manifest from env: $MANIFEST_PATH"
elif [ -f "$EXPANDED_MANIFEST" ] && [ "${USE_EXPANDED:-0}" = "1" ]; then
    MANIFEST_PATH="$EXPANDED_MANIFEST"
    echo "Using expanded manifest: $MANIFEST_PATH"
else
    MANIFEST_PATH="$FIXTURE_MANIFEST"
    echo "Using fixture manifest: $MANIFEST_PATH"
fi

export POKEMON_BINDER_MANIFEST_PATH="$MANIFEST_PATH"
export POKEMON_BINDER_DATA_ROOT="$DATA_ROOT"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-7860}"

# NixOS: collect required shared library paths
GCC_LIB=/nix/store/si4q3zks5mn5jhzzyri9hhd3cv789vlm-gcc-15.2.0-lib/lib
ZLIB=/nix/store/ixhlv41i2wpl84xgjcks061dz4yssbg3-zlib-1.3.2/lib
XCB=/nix/store/fc1g44pg3i10wfzh3gb4m54pfgclsn76-libxcb-1.17.0/lib
GL=/nix/store/fdqacryg2w9kiwb94c9rzfsyff4im8xj-libglvnd-1.7.0/lib
GLIB=/nix/store/zcmsivndca5wmam9nwnbjrm0zkgykwfz-glib-2.86.3/lib
PNG=/nix/store/gsn3vddway3289p6mzy5shd1paly8dp4-libpng-apng-1.6.56/lib
TIFF=/nix/store/6w9m0a1v9kx40q341wq4y337s8csqhyn-libtiff-4.7.1/lib
WEBP=/nix/store/vdz5z5d4qvsfqdafihrfwzi5r7wr24lk-libwebp-1.6.0/lib
export LD_LIBRARY_PATH="$GCC_LIB:$ZLIB:$XCB:$GL:$GLIB:$PNG:$TIFF:$WEBP"

cd "$PROJECT_DIR"

if [ "${1:-}" = "--daemon" ]; then
    LOGFILE="$LOG_DIR/webapp_$(date +%Y%m%d_%H%M%S).log"
    echo "Starting webapp in background (log: $LOGFILE)"
    nohup "$VENV_PYTHON" -m pokemon_binder_scanner.cli web > "$LOGFILE" 2>&1 &
    PID=$!
    echo "PID: $PID"
    echo "$PID" > "$DATA_ROOT/webapp.pid"
    echo "Monitor: tail -f $LOGFILE"
else
    echo "Starting webapp on http://${HOST}:${PORT}"
    echo "Press Ctrl+C to stop"
    exec "$VENV_PYTHON" -m pokemon_binder_scanner.cli web
fi
