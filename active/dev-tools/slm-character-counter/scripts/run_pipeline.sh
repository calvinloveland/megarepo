#!/usr/bin/env bash
# ── Full training pipeline: generate → train (DPO) → evaluate ──
# Usage:
#   bash scripts/run_pipeline.sh                    # full GPU run (default)
#   bash scripts/run_pipeline.sh --mini             # tiny CPU test (~5 min)
#   bash scripts/run_pipeline.sh --no-cuda ...      # CPU with custom args
#
# All commands run through run_in_nix.sh for NixOS compatibility.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_DIR/.venv"

# ── Detect mode ──────────────────────────────────────────────────────────────
if [ "${1:-}" = "--mini" ]; then
    echo "🧪 MINI TEST MODE (CPU, ~5 minutes)"
    echo ""
    EXTRA_ARGS="--no-cuda --num-epochs 1 --batch-size 1 --gradient-accumulation 1 --lr 5e-5 --train-examples 200 --eval-examples 20"
    shift
    # Also reduce data generation size
    TRAIN_EXAMPLES=200
    EVAL_EXAMPLES=20
else
    EXTRA_ARGS="${@:---no-cuda --num-epochs 3 --lr 5e-5}"
    TRAIN_EXAMPLES=10000
    EVAL_EXAMPLES=500
fi

# Make sure output dirs exist
mkdir -p "$PROJECT_DIR/data" "$PROJECT_DIR/outputs"

echo "========================================"
echo "  SLM Character Counter - Full Pipeline"
echo "========================================"

# ── Step 0: Check venv ──────────────────────────────────────────────────────
if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "❌ Virtual environment not found. Run scripts/setup_venv.sh first."
    exit 1
fi

echo ""
echo "📊 Step 1: Generating data (${TRAIN_EXAMPLES} train + ${EVAL_EXAMPLES} eval)..."
bash "$SCRIPT_DIR/run_in_nix.sh" python "$PROJECT_DIR/data/generate.py" \
    --output "$PROJECT_DIR/data" \
    --train-examples "$TRAIN_EXAMPLES" \
    --eval-examples "$EVAL_EXAMPLES" \
    --dpo \
    --seed 42

echo ""
echo "🏋️ Step 2: Training with DPO..."
echo "     Args: $EXTRA_ARGS"
bash "$SCRIPT_DIR/run_in_nix.sh" python "$PROJECT_DIR/training/train_dpo.py" \
    --data-dir "$PROJECT_DIR/data" \
    --output-dir "$PROJECT_DIR/outputs/slm-counter" \
    $EXTRA_ARGS

echo ""
echo "📋 Step 3: Evaluating..."
bash "$SCRIPT_DIR/run_in_nix.sh" python "$PROJECT_DIR/training/eval.py" \
    --model-path "$PROJECT_DIR/outputs/slm-counter" \
    --base-model "HuggingFaceTB/SmolLM2-135M-Instruct" \
    --num-samples "$EVAL_EXAMPLES" \
    --output "$PROJECT_DIR/outputs/eval_results.json"

echo ""
echo "========================================"
echo "  ✔ Pipeline complete!"
echo "========================================"
echo "  Model:    $PROJECT_DIR/outputs/slm-counter"
echo "  Results:  $PROJECT_DIR/outputs/eval_results.json"
echo ""
echo "  To train on GPU:"
echo "    bash scripts/run_pipeline.sh --fp16 --batch-size 8 --num-epochs 3"
echo ""
