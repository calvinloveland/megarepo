#!/usr/bin/env bash
set -e
cd /home/calvin/code/megarepo/active/personal/calnix
echo "Testing flake check..."
nix flake check 2>&1 | tail -20
echo "===== FLAKE CHECK COMPLETE ====="
