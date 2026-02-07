#!/bin/bash
set -euo pipefail

if pgrep -x dockerd >/dev/null 2>&1; then
  echo "✅ dockerd already running"
  exit 0
fi

# Configure a daemon that avoids iptables/bridge setup (works in constrained kernels)
if [ -d /etc/docker ]; then
  sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "iptables": false,
  "bridge": "none",
  "ip-masq": false
}
EOF
else
  sudo mkdir -p /etc/docker
  sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "iptables": false,
  "bridge": "none",
  "ip-masq": false
}
EOF
fi

# Start dockerd in background
sudo -n sh -lc 'nohup dockerd --host=unix:///var/run/docker.sock >/tmp/dockerd.log 2>&1 &' || true

# Wait for socket
for i in {1..20}; do
  if docker version >/dev/null 2>&1; then
    echo "✅ dockerd started"
    exit 0
  fi
  sleep 1
done

echo "⚠️ dockerd failed to start; see /tmp/dockerd.log"
exit 1
