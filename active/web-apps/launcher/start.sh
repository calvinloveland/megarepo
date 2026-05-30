#!/usr/bin/env bash
# Start the Megarepo Launcher dashboard
set -e
cd "$(dirname "$0")"
mkdir -p logs
echo "🚀 Starting Megarepo Launcher on http://localhost:3001"
exec nix-shell --run "python3 app.py"
