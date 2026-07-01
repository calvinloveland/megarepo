#!/usr/bin/env bash
# Apply the vroomon k8s manifest when the thinker cluster is reachable.
# Run this after thinker comes back up.
#
# Usage:
#   ./scripts/deploy-when-ready.sh              # check and apply once
#   ./scripts/deploy-when-ready.sh --watch       # loop until cluster is up
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SECRETS_FILE="${PROJECT_DIR}/.secrets/cloudflared-token"
watch=0

if [[ "${1:-}" == "--watch" ]]; then
  watch=1
fi

check_cluster() {
  kubectl get nodes &>/dev/null
}

apply_manifest() {
  if [[ ! -f "${SECRETS_FILE}" ]]; then
    echo "No .secrets/cloudflared-token found." >&2
    echo "Run the deploy guide (make guide) or create the file manually." >&2
    exit 1
  fi

  SECRET=$(cat "${SECRETS_FILE}" | tr -d '[:space:]')
  if [[ -z "${SECRET}" ]]; then
    echo "Secret file is empty." >&2
    exit 1
  fi

  echo "==> Cluster is reachable. Applying vroomon manifest..."
  kubectl create namespace vroomon --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n vroomon delete secret vroomon-cloudflared-token --ignore-not-found
  kubectl -n vroomon create secret generic vroomon-cloudflared-token \
    --from-literal="token=${SECRET}"
  kubectl apply -f "${PROJECT_DIR}/k8s/vroomon.yaml"

  echo ""
  echo "==> Done! Check status:"
  echo "  kubectl -n vroomon get pods,svc,pvc"
  echo "  https://vroomon.shsw.dev"
}

if [[ ${watch} -eq 1 ]]; then
  echo "Waiting for k3s cluster (thinker)..."
  while ! check_cluster; do
    echo -n "."
    sleep 10
  done
  echo ""
  apply_manifest
else
  if check_cluster; then
    apply_manifest
  else
    echo "k3s cluster is not reachable." >&2
    echo "  Thinker may be down. Try again later, or use --watch to poll." >&2
    echo "  Current docker images ready:"
    docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep vroomon
    exit 1
  fi
fi
