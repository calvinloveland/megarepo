#!/usr/bin/env bash
# Run all tests for Conway's Game of War
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHROMIUM="/nix/store/r7ifk1v95jfl02775kgbrd61dyr1rfsx-chromium-148.0.7778.178/bin/chromium"

echo "═══ Python unit tests ═══"
cd "$SCRIPT_DIR"
.venv/bin/python -m pytest src/conways_game_of_war/test_game_state.py -v

echo ""
echo "═══ Playwright browser tests ═══"
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$CHROMIUM" npm test
