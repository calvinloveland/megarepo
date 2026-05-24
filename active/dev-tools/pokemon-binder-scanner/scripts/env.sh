#!/bin/bash
# Source this file to set up the Python environment for the pokemon-binder-scanner.
# Usage: source scripts/env.sh
# Or: eval "$(scripts/env.sh)"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$HERE/.." && pwd)"
VENV="/data/home/calvin/pokemon-binder-scanner/.venv"

# NixOS shared library paths
NIX_LIBS=(
    /nix/store/si4q3zks5mn5jhzzyri9hhd3cv789vlm-gcc-15.2.0-lib/lib
    /nix/store/ixhlv41i2wpl84xgjcks061dz4yssbg3-zlib-1.3.2/lib
    /nix/store/fc1g44pg3i10wfzh3gb4m54pfgclsn76-libxcb-1.17.0/lib
    /nix/store/fdqacryg2w9kiwb94c9rzfsyff4im8xj-libglvnd-1.7.0/lib
    /nix/store/zcmsivndca5wmam9nwnbjrm0zkgykwfz-glib-2.86.3/lib
    /nix/store/gsn3vddway3289p6mzy5shd1paly8dp4-libpng-apng-1.6.56/lib
    /nix/store/6w9m0a1v9kx40q341wq4y337s8csqhyn-libtiff-4.7.1/lib
    /nix/store/vdz5z5d4qvsfqdafihrfwzi5r7wr24lk-libwebp-1.6.0/lib
)

export LD_LIBRARY_PATH="$(IFS=:; echo "${NIX_LIBS[*]}"):${LD_LIBRARY_PATH:-}"
export PATH="$VENV/bin:$PATH"
export PYTHONPATH="$PROJECT/src:${PYTHONPATH:-}"
export PYTHONUNBUFFERED=1

# If sourced with "eval", just print exports. Otherwise apply them.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    return 0  # sourced — vars already exported
fi

# Running as script: execute command or print env
if [ $# -gt 0 ]; then
    exec "$@"
else
    echo "export LD_LIBRARY_PATH='$LD_LIBRARY_PATH'"
    echo "export PATH='$PATH'"
    echo "export PYTHONPATH='$PYTHONPATH'"
    echo "export PYTHONUNBUFFERED=1"
fi
