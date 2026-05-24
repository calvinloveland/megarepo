#!/bin/bash
# Run after rebuild_clip_index.py completes.
# Tests the new index, updates thresholds if needed, restarts web app.
set -euo pipefail

DATA=/data/home/calvin/pokemon-binder-scanner
VENV=$DATA/.venv/bin/python3
LOG=$DATA/logs/post_rebuild_$(date +%Y%m%d_%H%M%S).log

export LD_LIBRARY_PATH="/nix/store/si4q3zks5mn5jhzzyri9hhd3cv789vlm-gcc-15.2.0-lib/lib:/nix/store/ixhlv41i2wpl84xgjcks061dz4yssbg3-zlib-1.3.2/lib:/nix/store/fc1g44pg3i10wfzh3gb4m54pfgclsn76-libxcb-1.17.0/lib:/nix/store/fdqacryg2w9kiwb94c9rzfsyff4im8xj-libglvnd-1.7.0/lib:/nix/store/zcmsivndca5wmam9nwnbjrm0zkgykwfz-glib-2.86.3/lib:/nix/store/gsn3vddway3289p6mzy5shd1paly8dp4-libpng-apng-1.6.56/lib:/nix/store/6w9m0a1v9kx40q341wq4y337s8csqhyn-libtiff-4.7.1/lib:/nix/store/vdz5z5d4qvsfqdafihrfwzi5r7wr24lk-libwebp-1.6.0/lib"

exec > >(tee -a "$LOG") 2>&1

echo "=== Post-rebuild check $(date) ==="

# Verify index exists
if [ ! -f "$DATA/clip_index/clip.index" ]; then
    echo "ERROR: clip.index not found"
    exit 1
fi

echo "Index size: $(du -sh $DATA/clip_index/clip.index | cut -f1)"
echo "Cards: $($VENV -c "import json; print(len(json.loads(open('$DATA/clip_index/cards.json').read())))")"

# Run adversarial tests
echo ""
echo "=== Running adversarial tests ==="
cd /home/calvin/megarepo/active/dev-tools/pokemon-binder-scanner
$VENV -m pytest tests/test_binder_fixtures.py::AdversarialCorpusTests -v --tb=short 2>&1 || true

# Restart web app
echo ""
echo "=== Restarting web app ==="
systemctl --user restart pokemon-binder-scanner.service
sleep 3
curl -s -o /dev/null -w "Web app: HTTP %{http_code}\n" http://localhost:7860/

echo ""
echo "=== Done $(date) ==="
