#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

KUBECONFIG_PATH="${KUBECONFIG_PATH:-${HOME}/.kube/thinker-k3s.yaml}"
KUBECTL_SERVER="${KUBECTL_SERVER:-}"
NAMESPACE="${NAMESPACE:-vernissage}"
IMAGE_TAG="${1:-${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}}"
REMOTE_IMAGE="${REMOTE_IMAGE:-127.0.0.1:5000/vernissage:latest}"
PUBLIC_URL="${PUBLIC_URL:-https://thevernissage.art}"
APP_VERSION="thinker-registry-${IMAGE_TAG}"

KUBECTL_ARGS=(--kubeconfig "${KUBECONFIG_PATH}")
if [[ -n "${KUBECTL_SERVER}" ]]; then
  KUBECTL_ARGS+=(--server "${KUBECTL_SERVER}" --insecure-skip-tls-verify=true)
fi

"${SCRIPT_DIR}/publish-to-thinker-registry.sh" "${IMAGE_TAG}"

echo "==> Applying manifest (preserving existing live secrets)"
python - "${APP_DIR}/k8s/vernissage.yaml" <<'PY' | kubectl "${KUBECTL_ARGS[@]}" apply -f -
import sys
import yaml

manifest_path = sys.argv[1]
with open(manifest_path, 'r', encoding='utf-8') as handle:
    docs = [doc for doc in yaml.safe_load_all(handle) if doc and doc.get('kind') != 'Secret']

yaml.safe_dump_all(docs, sys.stdout, sort_keys=False)
PY

echo "==> Updating deployed image and app version"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" set image deployment/vernissage vernissage="${REMOTE_IMAGE}"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" patch secret vernissage-env --type merge -p "{\"stringData\":{\"APP_VERSION\":\"${APP_VERSION}\",\"NEXTAUTH_URL\":\"${PUBLIC_URL}\"}}"

echo "==> Restarting rollout"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" rollout restart deployment/vernissage
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" rollout status deployment/vernissage --timeout=180s

echo
echo "Current deployment:"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" get deployment vernissage -o wide
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" get pods -o wide
