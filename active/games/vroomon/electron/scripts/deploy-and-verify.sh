#!/usr/bin/env bash
# One-shot vroomon deploy + verify.
#
# Preconditions (all checked, with friendly hints if missing):
#   - the k3s cluster is reachable (default kubeconfig: ~/.kube/thinker-k3s.yaml)
#   - .secrets/cloudflared-token exists (from the Zero Trust dashboard; created
#     by the deploy-guide or manually — never pasted into chat)
#
# Steps: namespace -> secret (from the token FILE, never the CLI) -> apply the
# k8s manifest -> rollout status -> readiness wait -> summary + the two
# user-side steps that remain (cloudflared ingress in ~/.cloudflared/config.yml
# and the DNS route).
#
# Usage:
#   ./scripts/deploy-and-verify.sh [--skip-push]
#   KUBECONFIG=/path/to/kubeconfig ./scripts/deploy-and-verify.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${PROJECT_DIR}/k8s/vroomon.yaml"
SECRETS_DIR="${PROJECT_DIR}/.secrets"
TOKEN_FILE="${SECRETS_DIR}/cloudflared-token"
KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/thinker-k3s.yaml}"
NAMESPACE="vroomon"

echo "== vroomon deploy + verify =="

# ---- preflight ---------------------------------------------------------------
fail=0
if [[ ! -f "${MANIFEST}" ]]; then
  echo "✗ manifest missing: ${MANIFEST}"
  fail=1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "✗ tunnel token missing: ${TOKEN_FILE}"
  echo "  Get it from the Zero Trust dashboard and write it to that file"
  echo "  (or run: node ${SCRIPT_DIR}/deploy-guide.mjs and save it there)."
  fail=1
fi
if ! KUBECONFIG="${KUBECONFIG}" timeout 20 kubectl get nodes >/dev/null 2>&1; then
  echo "✗ k3s cluster unreachable via ${KUBECONFIG}"
  echo "  Start the 'thinker' box / check the API at 192.168.1.191:6443."
  fail=1
fi
if [[ "${fail}" -eq 1 ]]; then
  echo "Preflight failed — fix the items above, then re-run."
  exit 1
fi

export KUBECONFIG
echo "✓ cluster reachable (context: $(kubectl config current-context))"

# ---- namespace + secret (token taken from the FILE, never the CLI) ----------
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
if kubectl -n "${NAMESPACE}" get secret vroomon-cloudflared-token >/dev/null 2>&1; then
  echo "✓ tunnel secret already present"
else
  kubectl -n "${NAMESPACE}" create secret generic vroomon-cloudflared-token \
    --from-file=token="${TOKEN_FILE}"
  echo "✓ tunnel secret created from ${TOKEN_FILE}"
fi

# ---- apply + rollout ---------------------------------------------------------
kubectl apply -f "${MANIFEST}"
echo "--- rollout status ---"
kubectl -n "${NAMESPACE}" rollout status deployment/vroomon --timeout=180s || true
kubectl -n "${NAMESPACE}" wait --for=condition=available deployment/vroomon --timeout=180s

# ---- verify -----------------------------------------------------------------
echo "--- pod/service state ---"
kubectl -n "${NAMESPACE}" get pods,svc,pvc
if kubectl -n "${NAMESPACE}" exec deploy/vroomon -c vroomon -- \
    curl -sI http://127.0.0.1:5112 >/dev/null 2>&1; then
  echo "✓ vroomon web server answers inside the pod on :5112"
else
  echo "⚠ pod logic: could not curl :5112 inside the pod — check logs:"
  echo "  kubectl -n ${NAMESPACE} logs -l app=vroomon -c vroomon --previous"
fi

cat <<'EOF'

== Two user-side steps remain (outside this script) ==
1. cloudflared ingress in ~/.cloudflared/config.yml (above the catch-all):
     - hostname: vroomon.shsw.dev
       service: http://127.0.0.1:5112
   then: cloudflared tunnel ingress validate ~/.cloudflared/config.yml
   and restart the tunnel (pkill the running cloudflared process, relaunch).
2. DNS route once (needs the tunnel id):
     cloudflared tunnel route dns <tunnel-id> vroomon.shsw.dev
Then: curl -I https://vroomon.shsw.dev
EOF
echo "== done =="