#!/usr/bin/env bash
# ── Run a Python command inside nix-shell with proper libraries ──
# This ensures libstdc++.so.6, libz.so.1, and other native dependencies
# are available for PyTorch, NumPy, and other ML libraries on NixOS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_DIR/.venv"

if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "❌ Virtual environment not found. Run scripts/setup_venv.sh first."
    exit 1
fi

# Find native library paths from nixpkgs
NIX_LIB_DIRS=""

for pkg_attr in "stdenv.cc.cc.lib" "zlib"; do
    pkg_path=$(nix eval --raw "nixpkgs#${pkg_attr}.outPath" 2>/dev/null)
    pkg_lib="${pkg_path}/lib"
    if [ -d "$pkg_lib" ]; then
        # Fetch into store if needed
        nix-store -r "$pkg_path" 2>/dev/null || true
        NIX_LIB_DIRS="${NIX_LIB_DIRS}:${pkg_lib}"
    fi
done

PYTHON_CMD="export LD_LIBRARY_PATH=\$LD_LIBRARY_PATH${NIX_LIB_DIRS} && source $VENV_DIR/bin/activate && cd $PROJECT_DIR && $@"

exec nix-shell -p python312 --command "$PYTHON_CMD"
