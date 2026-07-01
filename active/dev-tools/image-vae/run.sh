#!/usr/bin/env bash
# Run image-vae commands inside the venv with proper LD_LIBRARY_PATH for NixOS.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="/nix/store/si4q3zks5mn5jhzzyri9hhd3cv789vlm-gcc-15.2.0-lib/lib:$LD_LIBRARY_PATH"
exec "$DIR/.venv/bin/python" -m image_vae.cli "$@"
