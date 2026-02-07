#!/bin/bash
# Parambulator Cloudflare Tunnel Management Script

TUNNEL_NAME="parambulator"
TUNNEL_ID="4cdefe39-9519-41ac-8d7b-d21d975c3df0"
APP_PORT=5000
APP_DIR="/workspaces/megarepo/active/web-apps/parambulator"

case "$1" in
  start)
    echo "Starting Parambulator..."
    cd "$APP_DIR"
    SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
    export SECRET_KEY FLASK_DEBUG=false PORT=$APP_PORT HOST=127.0.0.1
    nohup python -m parambulator.app > /tmp/parambulator.log 2>&1 &
    echo $! > /tmp/parambulator.pid
    echo "Parambulator started (PID: $(cat /tmp/parambulator.pid))"
    
    echo "Starting Cloudflare tunnel..."
    nohup cloudflared tunnel --config /home/vscode/.cloudflared/config.yml run $TUNNEL_NAME > /tmp/cloudflared.log 2>&1 &
    echo $! > /tmp/cloudflared.pid
    echo "Tunnel started (PID: $(cat /tmp/cloudflared.pid))"
    
    sleep 3
    echo ""
    echo "✅ Services started!"
    echo "   Local: http://localhost:$APP_PORT"
    echo "   Public: https://parambulator.shsw.dev"
    ;;
    
  stop)
    echo "Stopping services..."
    if [ -f /tmp/parambulator.pid ]; then
      kill $(cat /tmp/parambulator.pid) 2>/dev/null && echo "Parambulator stopped" || echo "Parambulator not running"
      rm -f /tmp/parambulator.pid
    fi
    if [ -f /tmp/cloudflared.pid ]; then
      kill $(cat /tmp/cloudflared.pid) 2>/dev/null && echo "Cloudflare tunnel stopped" || echo "Tunnel not running"
      rm -f /tmp/cloudflared.pid
    fi
    ;;
    
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
    
  status)
    echo "=== Service Status ==="
    if [ -f /tmp/parambulator.pid ] && kill -0 $(cat /tmp/parambulator.pid) 2>/dev/null; then
      echo "✅ Parambulator: Running (PID: $(cat /tmp/parambulator.pid))"
    else
      echo "❌ Parambulator: Not running"
    fi
    
    if [ -f /tmp/cloudflared.pid ] && kill -0 $(cat /tmp/cloudflared.pid) 2>/dev/null; then
      echo "✅ Cloudflare Tunnel: Running (PID: $(cat /tmp/cloudflared.pid))"
    else
      echo "❌ Cloudflare Tunnel: Not running"
    fi
    
    echo ""
    echo "=== URLs ==="
    echo "   Local: http://localhost:$APP_PORT"
    echo "   Public: https://parambulator.shsw.dev"
    ;;
    
  logs)
    echo "=== Parambulator Logs ==="
    tail -50 /tmp/parambulator.log
    echo ""
    echo "=== Cloudflare Tunnel Logs ==="
    tail -50 /tmp/cloudflared.log
    ;;
    
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "Commands:"
    echo "  start   - Start Parambulator and Cloudflare tunnel"
    echo "  stop    - Stop both services"
    echo "  restart - Restart both services"
    echo "  status  - Check if services are running"
    echo "  logs    - Show recent logs from both services"
    exit 1
    ;;
esac
