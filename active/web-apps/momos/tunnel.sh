#!/usr/bin/env bash
# Cozi Cloudflare Tunnel Management Script

TUNNEL_NAME="cozi"
APP_PORT=5000
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
CF_CONFIG="${CF_CONFIG:-$HOME/.cloudflared/config.yml}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$HOME/.local/bin/cloudflared}"
PUBLIC_URL="https://cozi.shsw.dev"

case "$1" in
  start)
    echo "Starting Cozi..."
    cd "$APP_DIR"
    export FLASK_DEBUG=false PORT=$APP_PORT HOST=127.0.0.1
    nohup .venv/bin/gunicorn -w 2 -b 127.0.0.1:$APP_PORT "momos.app:create_app()" > /tmp/cozi.log 2>&1 &
    echo $! > /tmp/cozi.pid
    echo "Cozi started (PID: $(cat /tmp/cozi.pid))"

    echo "Starting Cloudflare tunnel..."
    nohup "$CLOUDFLARED_BIN" tunnel --config "$CF_CONFIG" run $TUNNEL_NAME > /tmp/cloudflared-cozi.log 2>&1 &
    echo $! > /tmp/cloudflared-cozi.pid
    echo "Tunnel started (PID: $(cat /tmp/cloudflared-cozi.pid))"

    sleep 3
    echo ""
    echo "✅ Services started!"
    echo "   Local: http://localhost:$APP_PORT"
    echo "   Public: $PUBLIC_URL"
    ;;

  stop)
    echo "Stopping services..."
    if [ -f /tmp/cozi.pid ]; then
      kill $(cat /tmp/cozi.pid) 2>/dev/null && echo "Cozi stopped" || echo "Cozi not running"
      rm -f /tmp/cozi.pid
    fi
    if [ -f /tmp/cloudflared-cozi.pid ]; then
      kill $(cat /tmp/cloudflared-cozi.pid) 2>/dev/null && echo "Cloudflare tunnel stopped" || echo "Tunnel not running"
      rm -f /tmp/cloudflared-cozi.pid
    fi
    ;;

  restart)
    $0 stop
    sleep 2
    $0 start
    ;;

  status)
    echo "=== Service Status ==="
    if [ -f /tmp/cozi.pid ] && kill -0 $(cat /tmp/cozi.pid) 2>/dev/null; then
      echo "✅ Cozi: Running (PID: $(cat /tmp/cozi.pid))"
    else
      echo "❌ Cozi: Not running"
    fi

    if [ -f /tmp/cloudflared-cozi.pid ] && kill -0 $(cat /tmp/cloudflared-cozi.pid) 2>/dev/null; then
      echo "✅ Cloudflare Tunnel: Running (PID: $(cat /tmp/cloudflared-cozi.pid))"
    else
      echo "❌ Cloudflare Tunnel: Not running"
    fi

    echo ""
    echo "=== URLs ==="
    echo "   Local: http://localhost:$APP_PORT"
    echo "   Public: $PUBLIC_URL"
    ;;

  logs)
    echo "=== Cozi Logs ==="
    tail -50 /tmp/cozi.log
    echo ""
    echo "=== Cloudflare Tunnel Logs ==="
    tail -50 /tmp/cloudflared-cozi.log
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "Commands:"
    echo "  start   - Start Cozi and Cloudflare tunnel"
    echo "  stop    - Stop both services"
    echo "  restart - Restart both services"
    echo "  status  - Check if services are running"
    echo "  logs    - Show recent logs from both services"
    exit 1
    ;;
esac
