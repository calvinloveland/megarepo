#!/usr/bin/env bash
# Build, push, and apply the vroomon deployment.
#
# This script is intentionally credential-free. It expects:
#   - docker to be installed and pointed at 127.0.0.1:5000
#   - kubectl to be configured for the homelab k3s context
#   - the vroomon-cloudflared-token secret to already exist
#     in the vroomon namespace (created with `kubectl create secret` —
#     see DEPLOYMENT.md for the exact command; never paste the token
#     into chat)
#
# Usage:
#   ./scripts/deploy.sh                 # build, push, apply
#   ./scripts/deploy.sh --build-only    # build + push, skip kubectl
#   ./scripts/deploy.sh --apply-only    # skip build, just apply manifest
#   ./scripts/deploy.sh --tag v0.2.0    # build with a custom tag
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REGISTRY="${VROOMON_REGISTRY:-127.0.0.1:5000}"
IMAGE_NAME="${VROOMON_IMAGE:-vroomon}"
DEFAULT_TAG="$(date -u +%Y%m%d-%H%M%S)"

build_only=0
apply_only=0
tag="${DEFAULT_TAG}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only) build_only=1; shift ;;
    --apply-only) apply_only=1; shift ;;
    --tag) tag="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

image="${REGISTRY}/${IMAGE_NAME}:${tag}"
manifest="${PROJECT_DIR}/k8s/vroomon.yaml"

if [[ ! -f "${manifest}" ]]; then
  echo "k8s manifest not found: ${manifest}" >&2
  exit 1
fi

if [[ ${apply_only} -eq 0 ]]; then
  echo "==> Building ${image}"
  docker build -t "${image}" -f "${PROJECT_DIR}/Dockerfile" "${PROJECT_DIR}"
  docker tag "${image}" "${REGISTRY}/${IMAGE_NAME}:latest"

  echo "==> Pushing to ${REGISTRY}"
  docker push "${image}"
  docker push "${REGISTRY}/${IMAGE_NAME}:latest"
fi

if [[ ${build_only} -eq 0 ]]; then
  echo "==> Applying manifest"
  kubectl create namespace vroomon --dry-run=client -o yaml | kubectl apply -f -
  kubectl apply -f "${manifest}"
  echo
  echo "Deployment status:"
  kubectl -n vroomon get pods,svc,pvc
fi

echo "==> Done. Tag pushed: ${image}"
