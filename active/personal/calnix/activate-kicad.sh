#!/usr/bin/env bash
# activate-kicad.sh — Activate the new NixOS configuration with KiCad
#
# This script activates the pre-built NixOS system configuration
# that includes KiCad. Run it after the build has completed.
#
# Usage:
#   ./activate-kicad.sh
#
# The build step already completed — this simply runs nixos-rebuild
# switch using the already-built artifacts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Activating NixOS configuration with KiCad..."
echo "Flake: ${REPO_ROOT}#1337book"
echo ""
echo "You will be prompted for your sudo password."
echo ""

exec sudo nixos-rebuild switch --flake "${REPO_ROOT}#1337book" "$@"
