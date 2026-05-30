#!/usr/bin/env bash
# Enable/disable megarepo web apps as systemd services on this host
# Usage: ./enable-web-apps.sh [enable|disable|status]
set -euo pipefail

HOST="${HOSTNAME:-haswell}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FLAKE_DIR="$(dirname "$SCRIPT_DIR")"

case "${1:-status}" in
  enable)
    echo "🔧 Building and switching to configuration with web apps enabled..."
    sudo nixos-rebuild switch --flake "$FLAKE_DIR#$HOST"
    echo ""
    echo "✅ Web apps enabled. Checking services..."
    systemctl list-units --type=service --state=running 'webapp-*' 2>/dev/null \
      || echo "No webapp services running yet."
    ;;
  disable)
    echo "🔧 Rebuilding without web apps..."
    # Temporarily disable by commenting out calnix.webApps in host config
    echo "Edit hosts/$HOST/configuration.nix and set calnix.webApps = {}; then re-run with 'enable'"
    ;;
  status)
    echo "📊 Web app services:"
    systemctl list-units --type=service 'webapp-*' 2>/dev/null \
      || echo "  No webapp services found"
    echo ""
    echo "📊 Cloudflare Tunnel services:"
    systemctl list-units --type=service 'cloudflared-*' 2>/dev/null \
      || echo "  No cloudflared services found"
    echo ""
    echo "📊 Ports in use by web apps:"
    ss -tlnp | grep -E '510[1-9]' || echo "  No web app ports active"
    ;;
  *)
    echo "Usage: $0 [enable|disable|status]"
    exit 1
    ;;
esac
