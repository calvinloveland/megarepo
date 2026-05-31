#!/usr/bin/env bash
# ── Setup Python virtual environment for SLM character counter ──
# Creates a venv inside nix-shell so PyTorch native libs resolve correctly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_DIR/.venv"

echo "🔧 Setting up Python virtual environment for SLM character counter..."
echo "   Project: $PROJECT_DIR"
echo "   Venv:    $VENV_DIR"

# Create venv using nix-shell python (ensures compatible interpreter)
if [ ! -d "$VENV_DIR" ]; then
    echo "   Creating virtual environment..."
    nix-shell -p python312 --command \
        "python3 -m venv $VENV_DIR --system-site-packages"
    echo "   ✔ Virtual environment created"
else
    echo "   ✔ Virtual environment already exists"
fi

# Install ML dependencies inside nix-shell with native libs
echo "   Installing dependencies (this will download ~2GB of packages)..."
bash "$SCRIPT_DIR/run_in_nix.sh" pip install --quiet --upgrade pip setuptools wheel && \
bash "$SCRIPT_DIR/run_in_nix.sh" pip install --quiet torch transformers datasets trl peft accelerate pytest

echo ""
echo "✔ Setup complete!"
echo ""
echo "Use scripts/run_in_nix.sh to run any Python command:"
echo "  bash scripts/run_in_nix.sh python data/generate.py --dpo"
echo "  bash scripts/run_in_nix.sh python training/train_dpo.py"
echo ""
echo "Or run the full pipeline:"
echo "  bash scripts/run_pipeline.sh"
