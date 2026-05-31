#!/usr/bin/env bash
# ── Launch training at nice 19 (idle CPU cycles) ──
# Redirects stdout/stderr to a log file and runs in background.
# Stop with:  kill $(cat /path/to/training.pid)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/outputs/training.log"
PID_FILE="$PROJECT_DIR/outputs/training.pid"

mkdir -p "$PROJECT_DIR/outputs"

echo "🚀 Launching DPO training at nice 19 (idle CPU cycles)..."
echo "   Model:  HuggingFaceTB/SmolLM2-135M-Instruct"
echo "   Epochs: 3"
echo "   Batch:  4  (effective 16 with grad accum 4)"
echo "   Log:    $LOG_FILE"
echo "   PID:    $PID_FILE"
echo ""
echo "📊 Monitor:  tail -f $LOG_FILE"
echo "🛑 Stop:     kill \$(cat $PID_FILE)"
echo ""

# Run at nice 19 so it yields to interactive tasks
# Only supported CLI args are passed; rest use config.py defaults
nohup nice -n 19 bash "$SCRIPT_DIR/run_in_nix.sh" python "$PROJECT_DIR/training/train_dpo.py" \
    --data-dir "$PROJECT_DIR/data" \
    --output-dir "$PROJECT_DIR/outputs/slm-counter" \
    --no-cuda \
    --num-epochs 3 \
    --batch-size 4 \
    --gradient-accumulation 4 \
    --lr 5e-5 \
    --logging-steps 10 \
    --seed 42 \
    > "$LOG_FILE" 2>&1 &

PID=$!
echo $PID > "$PID_FILE"
echo "✔ Training started (PID $PID)"
