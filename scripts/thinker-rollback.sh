#!/usr/bin/env bash
# ==============================================================================
# thinker-rollback.sh — Roll back thinker to the previous NixOS generation
#
# Run this when you get console access on thinker (physical keyboard + screen).
# It rolls back to the pre-rebuild generation and brings networking back up.
# ==============================================================================
set -euo pipefail

echo "=== Thinker Recovery ==="
echo ""

# 1. Check if we have internet
echo "--- Step 1: Check network ---"
if ping -c1 -W2 1.1.1.1 &>/dev/null; then
    echo "  ✅ Network is up"
else
    echo "  ⚠️  Network is down — trying to bring up..."
    sudo systemctl restart NetworkManager 2>/dev/null || sudo systemctl restart systemd-networkd 2>/dev/null || true
    sleep 3
    if ping -c1 -W2 1.1.1.1 &>/dev/null; then
        echo "  ✅ Network recovered"
    else
        echo "  ⚠️  Still no network — continuing with local rollback"
    fi
fi

echo ""

# 2. List available generations
echo "--- Step 2: List NixOS generations ---"
sudo nix-env --list-generations -p /nix/var/nix/profiles/system 2>/dev/null | tail -5
echo ""

# 3. Rollback to previous generation
echo "--- Step 3: Rollback to previous generation ---"
echo "  Rolling back to the previous working generation..."
sudo nixos-rebuild switch --rollback 2>&1 | tail -5
echo ""

# 4. Verify
echo "--- Step 4: Verify ---"
echo "  Current generation:"
nixos-version 2>/dev/null || echo "  (checking...)"
echo "  Network:"
ip addr show | grep -E "inet " | grep -v "127.0.0.1" || echo "  No IP assigned"
echo ""
echo "=== Done ==="
echo "If the rollback succeeded, thinker should be reachable via SSH again."
echo "Run: sudo nixos-rebuild switch --flake /home/calvin/calnix#thinker"
echo "  from haswell to re-deploy the latest config."
