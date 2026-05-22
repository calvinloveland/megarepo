#!/bin/bash
# Post-download script: generate expanded manifest, render pages, and restart web app.
# Run after bulk_download_cards.py completes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_ROOT="/data/home/calvin/pokemon-binder-scanner"
VENV_PYTHON="$DATA_ROOT/.venv/bin/python3"

echo "=== Generating expanded binder manifest ==="
"$VENV_PYTHON" "$SCRIPT_DIR/generate_expanded_manifest.py" \
    --unique-cards 1500 \
    --output "$DATA_ROOT/expanded_binder_manifest.json"

echo ""
echo "=== Manifest generated ==="
"$VENV_PYTHON" -c "
import json
from pathlib import Path
m = json.loads(Path('$DATA_ROOT/expanded_binder_manifest.json').read_text())
unique = set()
for p in m['pages']:
    for s in p['slots']:
        if s.get('card'):
            unique.add(s['card']['canonical_card_id'])
print(f'  Pages: {len(m[\"pages\"])}')
print(f'  Total slots: {sum(len(p[\"slots\"]) for p in m[\"pages\"])}')
print(f'  Unique cards: {len(unique)}')
print(f'  Binder total: \${m[\"expected_binder_total_usd\"]:,.2f}')
print(f'  Reference images: {len(list(Path(\"$DATA_ROOT/reference_cards\").glob(\"*.png\")))}')
"

echo ""
echo "=== Restarting web app with expanded manifest ==="
# Kill existing web app
OLD_PID=$(cat "$DATA_ROOT/webapp.pid" 2>/dev/null || echo "")
if [ -n "$OLD_PID" ]; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
fi

# Start with expanded manifest
export POKEMON_BINDER_MANIFEST_PATH="$DATA_ROOT/expanded_binder_manifest.json"
export POKEMON_BINDER_DATA_ROOT="$DATA_ROOT"
export HOST="0.0.0.0"
export PORT="7860"

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
LOGFILE="$DATA_ROOT/logs/webapp_$(date +%Y%m%d_%H%M%S).log"
nohup "$VENV_PYTHON" -m pokemon_binder_scanner.cli web > "$LOGFILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$DATA_ROOT/webapp.pid"
echo "Web app restarted with expanded manifest (PID: $NEW_PID)"
echo "Log: $LOGFILE"
echo ""
echo "=== Done! ==="
echo "Web app: http://$(hostname -I | awk '{print $1}'):7860"
echo "Reference cards: $DATA_ROOT/reference_cards/"
echo "Manifest: $DATA_ROOT/expanded_binder_manifest.json"
