#!/usr/bin/env bash
# Sub Day Generator Cloudflare Tunnel Management Script

TUNNEL_NAME="sub-day-generator"
APP_PORT=5000
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
CF_CONFIG="${CF_CONFIG:-$HOME/.cloudflared/config.yml}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$HOME/.local/bin/cloudflared}"
PUBLIC_URL="https://subday.shsw.dev"

case "$1" in
  start)
    echo "Starting Sub Day Generator..."
    cd "$APP_DIR"
    export FLASK_DEBUG=false PORT=$APP_PORT HOST=127.0.0.1
    nohup .venv/bin/gunicorn -w 2 -b 127.0.0.1:$APP_PORT "sub_day_generator.app:create_app()" > /tmp/sub-day-generator.log 2>&1 &
    echo $! > /tmp/sub-day-generator.pid
    echo "Sub Day Generator started (PID: $(cat /tmp/sub-day-generator.pid))"

    echo "Starting Cloudflare tunnel..."
    nohup "$CLOUDFLARED_BIN" tunnel --config "$CF_CONFIG" run $TUNNEL_NAME > /tmp/cloudflared-subday.log 2>&1 &
    echo $! > /tmp/cloudflared-subday.pid
    echo "Tunnel started (PID: $(cat /tmp/cloudflared-subday.pid))"

    sleep 3
    echo ""
    echo "✅ Services started!"
    echo "   Local: http://localhost:$APP_PORT"
    echo "   Public: $PUBLIC_URL"
    ;;

  stop)
    echo "Stopping services..."
    if [ -f /tmp/sub-day-generator.pid ]; then
      kill $(cat /tmp/sub-day-generator.pid) 2>/dev/null && echo "Sub Day Generator stopped" || echo "Sub Day Generator not running"
      rm -f /tmp/sub-day-generator.pid
    fi
    if [ -f /tmp/cloudflared-subday.pid ]; then
      kill $(cat /tmp/cloudflared-subday.pid) 2>/dev/null && echo "Cloudflare tunnel stopped" || echo "Tunnel not running"
      rm -f /tmp/cloudflared-subday.pid
    fi
    ;;

  restart)
    $0 stop
    sleep 2
    $0 start
    ;;

  status)
    echo "=== Service Status ==="
    if [ -f /tmp/sub-day-generator.pid ] && kill -0 $(cat /tmp/sub-day-generator.pid) 2>/dev/null; then
      echo "✅ Sub Day Generator: Running (PID: $(cat /tmp/sub-day-generator.pid))"
    else
      echo "❌ Sub Day Generator: Not running"
    fi

    if [ -f /tmp/cloudflared-subday.pid ] && kill -0 $(cat /tmp/cloudflared-subday.pid) 2>/dev/null; then
      echo "✅ Cloudflare Tunnel: Running (PID: $(cat /tmp/cloudflared-subday.pid))"
    else
      echo "❌ Cloudflare Tunnel: Not running"
    fi

    echo ""
    echo "=== URLs ==="
    echo "   Local: http://localhost:$APP_PORT"
    echo "   Public: $PUBLIC_URL"
    ;;

  logs)
    echo "=== Sub Day Generator Logs ==="
    tail -50 /tmp/sub-day-generator.log
    echo ""
    echo "=== Cloudflare Tunnel Logs ==="
    tail -50 /tmp/cloudflared-subday.log
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "Commands:"
    echo "  start   - Start Sub Day Generator and Cloudflare tunnel"
    echo "  stop    - Stop both services"
    echo "  restart - Restart both services"
    echo "  status  - Check if services are running"
    echo "  logs    - Show recent logs from both services"
    exit 1
    ;;
esac
