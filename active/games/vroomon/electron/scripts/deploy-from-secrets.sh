#!/usr/bin/env bash
# Full deploy from a local .secrets/cloudflared-token file.
# The secret file is .gitignored and NEVER goes through chat.
# Safe to run this script from any CI or local terminal.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SECRETS_FILE="${PROJECT_DIR}/.secrets/cloudflared-token"
REGISTRY="${VROOMON_REGISTRY:-127.0.0.1:5000}"
IMAGE="${VROOMON_IMAGE:-vroomon}"
TAG="$(date -u +%Y%m%d-%H%M%S)"
IMAGE_REF="${REGISTRY}/${IMAGE}:${TAG}"

if [[ ! -f "${SECRETS_FILE}" ]]; then
  echo "No .secrets/cloudflared-token found." >&2
  echo "Create it with:" >&2
  echo "  mkdir -p '${PROJECT_DIR}/.secrets'" >&2
  echo "  echo 'YOUR_TOKEN' > '${SECRETS_FILE}'" >&2
  echo "The token lives on your disk only — never pasted in chat." >&2
  exit 1
fi

SECRET=$(cat "${SECRETS_FILE}" | tr -d '[:space:]')

if [[ -z "${SECRET}" ]]; then
  echo "Secret file is empty: ${SECRETS_FILE}" >&2
  exit 1
fi

echo "==> Token loaded from disk (${#SECRET} chars)"

# Build the Docker image.
echo "==> Building ${IMAGE_REF}"
docker build -t "${IMAGE_REF}" -f "${PROJECT_DIR}/Dockerfile" "${PROJECT_DIR}" || {
  echo "  ! docker build failed. Check if Docker is running and the Dockerfile is valid." >&2
  exit 1
}
docker tag "${IMAGE_REF}" "${REGISTRY}/${IMAGE}:latest" 2>/dev/null || true

# Push to the local registry (optional — skip if no registry running).
if curl -s "http://${REGISTRY}/v2/_catalog" >/dev/null 2>&1; then
  echo "==> Pushing to ${REGISTRY}"
  docker push "${IMAGE_REF}" || echo "  ! push skipped (registry unreachable)"
  docker push "${REGISTRY}/${IMAGE}:latest" || true
else
  echo "==> No registry at ${REGISTRY}, skipping push."
fi

# Apply the k8s manifest (optional — skip if no kubectl).
if command -v kubectl &>/dev/null; then
  echo "==> Applying k8s manifest"
  kubectl create namespace vroomon --dry-run=client -o yaml 2>/dev/null | kubectl apply -f - 2>/dev/null || true
  kubectl -n vroomon delete secret vroomon-cloudflared-token --ignore-not-found 2>/dev/null || true
  kubectl -n vroomon create secret generic vroomon-cloudflared-token \
    --from-literal="token=${SECRET}" 2>/dev/null || {
    echo "  ! Could not create k8s secret. Is k3s running on this machine?" >&2
    echo "  To apply manually from another machine:" >&2
    echo "    scp ${SECRETS_FILE} launcher:.secrets/cloudflared-token" >&2
    echo "    ssh launcher 'cd ~/megarepo/active/games/vroomon/electron && make deploy'" >&2
  }
  kubectl apply -f "${PROJECT_DIR}/k8s/vroomon.yaml" 2>/dev/null || true
  echo ""
  echo "  Check pods: kubectl -n vroomon get pods"
else
  echo "==> kubectl not found, skipping k8s apply."
  echo "  The image is built locally. To deploy from another machine:"
  echo "    docker save ${IMAGE_REF} | ssh launcher docker load"
  echo "    ssh launcher 'cd ~/megarepo/games/vroomon/electron && make deploy'"
fi

echo ""
echo "==> Image built: ${IMAGE_REF}"
echo "  Build ID: ${TAG}"
