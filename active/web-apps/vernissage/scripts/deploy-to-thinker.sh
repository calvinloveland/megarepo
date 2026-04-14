#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

KUBECONFIG_PATH="${KUBECONFIG_PATH:-${HOME}/.kube/thinker-k3s.yaml}"
NAMESPACE="${NAMESPACE:-vernissage}"
IMAGE_TAG="${1:-${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}}"
REMOTE_IMAGE="${REMOTE_IMAGE:-127.0.0.1:5000/vernissage:latest}"
APP_VERSION="thinker-registry-${IMAGE_TAG}"

"${SCRIPT_DIR}/publish-to-thinker-registry.sh" "${IMAGE_TAG}"

echo "==> Applying manifest (preserving existing live secrets)"
python - "${APP_DIR}/k8s/vernissage.yaml" <<'PY' | kubectl --kubeconfig "${KUBECONFIG_PATH}" apply -f -
import sys
import yaml

manifest_path = sys.argv[1]
with open(manifest_path, 'r', encoding='utf-8') as handle:
    docs = [doc for doc in yaml.safe_load_all(handle) if doc and doc.get('kind') != 'Secret']

yaml.safe_dump_all(docs, sys.stdout, sort_keys=False)
PY

echo "==> Updating deployed image and app version"
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" set image deployment/vernissage vernissage="${REMOTE_IMAGE}"
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" patch secret vernissage-env --type merge -p "{\"stringData\":{\"APP_VERSION\":\"${APP_VERSION}\"}}"

echo "==> Restarting rollout"
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" rollout restart deployment/vernissage
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" rollout status deployment/vernissage --timeout=180s

echo
echo "Current deployment:"
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" get deployment vernissage -o wide
kubectl --kubeconfig "${KUBECONFIG_PATH}" -n "${NAMESPACE}" get pods -o wide
