#!/usr/bin/env bash
# One-time cloudflared setup for vroomon.shsw.dev.
# THIS SCRIPT DOES NOT SEND THE TOKEN THROUGH CHAT.
# It reads from your terminal only: prompt, env var, or existing file.
#
# Usage:
#   ./scripts/setup-cloudflared.sh                   # interactive (prompts for token)
#   VROOMON_CF_TOKEN='eyJ...' ./scripts/setup-cloudflared.sh   # from env var
#   ./scripts/setup-cloudflared.sh --copy-from <ns>  # copy from another app
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)/k8s"
NAMESPACE="vroomon"

if [[ ! -f "${K8S_DIR}/vroomon.yaml" ]]; then
  echo "Expected k8s manifest at ${K8S_DIR}/vroomon.yaml — not found." >&2
  exit 1
fi

# --- Mode 1: copy from an existing app ---
if [[ "${1:-}" == "--copy-from" ]]; then
  src_ns="${2:-}"
  if [[ -z "${src_ns}" ]]; then
    echo "Usage: $0 --copy-from <namespace>    e.g. $0 --copy-from thermofluid" >&2
    exit 1
  fi
  token=$(kubectl -n "${src_ns}" get secret "${src_ns}-cloudflared-token" \
    -o jsonpath='{.data.token}' 2>/dev/null | base64 -d || true)
  if [[ -z "${token}" ]]; then
    echo "No secret ${src_ns}-cloudflared-token found in namespace ${src_ns}." >&2
    echo "Try: kubectl -n ${src_ns} get secrets | grep cloudflared" >&2
    exit 1
  fi
  echo "==> Copied cloudflared token from namespace ${src_ns}"
  VROOMON_CF_TOKEN="${token}"
fi

# --- Mode 2: read from env var ---
if [[ -n "${VROOMON_CF_TOKEN:-}" ]]; then
  echo "==> Using VROOMON_CF_TOKEN from environment (${#VROOMON_CF_TOKEN} chars)"
  kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
  kubectl -n "${NAMESPACE}" delete secret vroomon-cloudflared-token --ignore-not-found
  kubectl -n "${NAMESPACE}" create secret generic vroomon-cloudflared-token \
    --from-literal="token=${VROOMON_CF_TOKEN}"
  echo "==> Secret created in namespace ${NAMESPACE}."
  echo "  Run: kubectl apply -f ${K8S_DIR}/vroomon.yaml"
  echo "  Or: make deploy"
  exit 0
fi

# --- Mode 3: interactive prompt ---
echo "Paste the cloudflared tunnel token and press Enter."
echo "(The token will not echo to your terminal.)"
echo ""
read -r -s -p "Token: " VROOMON_CF_TOKEN
echo ""
if [[ -z "${VROOMON_CF_TOKEN}" ]]; then
  echo "No token entered. Aborting." >&2
  exit 1
fi

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "${NAMESPACE}" delete secret vroomon-cloudflared-token --ignore-not-found
kubectl -n "${NAMESPACE}" create secret generic vroomon-cloudflared-token \
  --from-literal="token=${VROOMON_CF_TOKEN}"
echo ""
echo "==> Secret created. Next steps:"
echo "  1. kubectl apply -f ${K8S_DIR}/vroomon.yaml"
echo "  2. cloudflared tunnel route dns <tunnel-uuid> vroomon.shsw.dev"
echo "  3. cloudflared tunnel ingress validate ~/.cloudflared/config.yml"
echo "  4. kubectl -n ${NAMESPACE} rollout restart deployment/vroomon"
