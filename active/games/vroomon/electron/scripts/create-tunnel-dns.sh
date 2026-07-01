#!/usr/bin/env bash
# Create the vroomon.shsw.dev DNS route in the homelab cloudflared tunnel.
#
# This script does NOT contain the tunnel token. You only need the
# tunnel UUID, which is the public identifier visible in the
# Cloudflare Zero Trust dashboard under Tunnels → <your tunnel> →
# "Tunnel ID".
#
# Usage:
#   ./scripts/create-tunnel-dns.sh <tunnel-uuid>
#
# Example:
#   ./scripts/create-tunnel-dns.sh a0e187ad-b0c8-499b-882a-32c25ff2730c
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <tunnel-uuid>" >&2
  echo "  Find it at https://one.dash.cloudflare.com/ → Zero Trust → Networks → Tunnels" >&2
  exit 1
fi

tunnel_id="$1"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not on PATH. Install from https://pkg.cloudflare.com/" >&2
  exit 1
fi

echo "==> Routing vroomon.shsw.dev to tunnel ${tunnel_id}"
cloudflared tunnel route dns "${tunnel_id}" vroomon.shsw.dev

echo
echo "DNS record created. To verify:"
echo "  dig +short vroomon.shsw.dev"
echo
echo "To check the tunnel is forwarding traffic:"
echo "  cloudflared tunnel info ${tunnel_id}"
