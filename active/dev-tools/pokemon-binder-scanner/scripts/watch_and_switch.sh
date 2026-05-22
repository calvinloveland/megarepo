#!/bin/bash
# Watcher: poll the download until it finishes, then generate manifest and restart webapp
set -euo pipefail

DATA_ROOT="/data/home/calvin/pokemon-binder-scanner"
VENV_PYTHON="$DATA_ROOT/.venv/bin/python3"
MANIFEST="$DATA_ROOT/cards_manifest.json"
DOWNLOAD_LOG="$DATA_ROOT/logs/download.log"

echo "Watching download at $DOWNLOAD_LOG..."

while true; do
    if grep -q "Done!" "$DOWNLOAD_LOG" 2>/dev/null; then
        echo "Download complete!"
        break
    fi
    # Check if process is still running
    if ! pgrep -f "bulk_download_cards.py" > /dev/null 2>&1; then
        echo "Download process exited."
        break
    fi
    tail -1 "$DOWNLOAD_LOG" 2>/dev/null
    sleep 15
done

echo ""
echo "=== Generating expanded binder manifest ==="
cd "$(dirname "$0")/.."

GCC_LIB=/nix/store/si4q3zks5mn5jhzzyri9hhd3cv789vlm-gcc-15.2.0-lib/lib
ZLIB=/nix/store/ixhlv41i2wpl84xgjcks061dz4yssbg3-zlib-1.3.2/lib
XCB=/nix/store/fc1g44pg3i10wfzh3gb4m54pfgclsn76-libxcb-1.17.0/lib
GL=/nix/store/fdqacryg2w9kiwb94c9rzfsyff4im8xj-libglvnd-1.7.0/lib
GLIB=/nix/store/zcmsivndca5wmam9nwnbjrm0zkgykwfz-glib-2.86.3/lib
PNG=/nix/store/gsn3vddway3289p6mzy5shd1paly8dp4-libpng-apng-1.6.56/lib
TIFF=/nix/store/6w9m0a1v9kx40q341wq4y337s8csqhyn-libtiff-4.7.1/lib
WEBP=/nix/store/vdz5z5d4qvsfqdafihrfwzi5r7wr24lk-libwebp-1.6.0/lib
export LD_LIBRARY_PATH="$GCC_LIB:$ZLIB:$XCB:$GL:$GLIB:$PNG:$TIFF:$WEBP"

"$VENV_PYTHON" scripts/generate_expanded_manifest.py \
    --unique-cards 1500 \
    --output "$DATA_ROOT/expanded_binder_manifest.json"

echo ""
echo "=== Restarting web app with expanded manifest ==="
OLD_PID=$(cat "$DATA_ROOT/webapp.pid" 2>/dev/null || echo "")
if [ -n "$OLD_PID" ]; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
fi

export POKEMON_BINDER_MANIFEST_PATH="$DATA_ROOT/expanded_binder_manifest.json"
export POKEMON_BINDER_DATA_ROOT="$DATA_ROOT"
export HOST="0.0.0.0"
export PORT="7860"

LOGFILE="$DATA_ROOT/logs/webapp_$(date +%Y%m%d_%H%M%S).log"
nohup "$VENV_PYTHON" -m pokemon_binder_scanner.cli web > "$LOGFILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$DATA_ROOT/webapp.pid"

echo ""
echo "=== Done! ==="
echo "  Web: http://$(hostname -I | awk '{print $1}'):7860"
echo "  Reference cards: $(ls $DATA_ROOT/reference_cards/ | wc -l) images"
echo "  Unique cards in manifest: $("$VENV_PYTHON" -c "import json;m=json.loads(open('$DATA_ROOT/expanded_binder_manifest.json'));print(len({s['card']['canonical_card_id'] for p in m['pages'] for s in p['slots'] if s.get('card')}))" 2>/dev/null)"
echo "  Binder total: $("$VENV_PYTHON" -c "import json;m=json.loads(open('$DATA_ROOT/expanded_binder_manifest.json'));print(f'\\\${m[\"expected_binder_total_usd\"]:,.2f}')" 2>/dev/null)"
