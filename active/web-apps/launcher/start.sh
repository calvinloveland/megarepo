#!/usr/bin/env bash
# Start the Megarepo Launcher dashboard + reverse proxy
set -e
cd "$(dirname "$0")"
mkdir -p logs

# Start the reverse proxy on port 80 (requires root/sudo)
# For testing without root, set PROXY_PORT=8080
PROXY_PORT="${PROXY_PORT:-80}"
if [ "$PROXY_PORT" -lt 1024 ] && [ "$(id -u)" -ne 0 ]; then
  echo "⚠️  Port $PROXY_PORT requires root. Starting proxy on port 8080 instead."
  echo "   Use: sudo -E PROXY_PORT=80 ./start.sh for port 80"
  PROXY_PORT=8080
fi

echo "🚀 Starting reverse proxy on http://0.0.0.0:$PROXY_PORT"
node proxy.js &
PROXY_PID=$!
echo "   Proxy PID: $PROXY_PID"
echo ""
echo "🚀 Starting Megarepo Launcher on http://localhost:3001"
nix-shell --run "python3 app.py"

# Cleanup proxy on exit
kill $PROXY_PID 2>/dev/null || true
