#!/usr/bin/env bash
# Deploy Gamebase locally as a restartable container on 127.0.0.1:${PORT}.
#
# The public hostname (games.shsw.dev) is served by the local cloudflared
# tunnel, which forwards to this port. See DEPLOYMENT.md.
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-gamebase:local}"
CONTAINER="${CONTAINER:-gamebase}"
PORT="${PORT:-5121}"
REGISTRY_DIR="${REGISTRY_DIR:-${APP_DIR}/registry}"
DATA_DIR="${DATA_DIR:-${HOME}/.local/share/gamebase}"

mkdir -p "${DATA_DIR}"

echo "==> Building ${IMAGE}"
docker build -t "${IMAGE}" "${APP_DIR}"

echo "==> (Re)starting ${CONTAINER} on 127.0.0.1:${PORT}"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER}" --restart unless-stopped \
  -p "127.0.0.1:${PORT}:5121" \
  -v "${REGISTRY_DIR}:/app/registry" \
  -v "${DATA_DIR}:/app/instance" \
  "${IMAGE}"

echo "==> Waiting for health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "Gamebase is up at http://127.0.0.1:${PORT}"
    exit 0
  fi
  sleep 1
done

echo "Gamebase did not become healthy; recent logs:" >&2
docker logs --tail 40 "${CONTAINER}" >&2 || true
exit 1
