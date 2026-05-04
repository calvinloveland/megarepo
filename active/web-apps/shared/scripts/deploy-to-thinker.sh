#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

: "${APP_DIR:?APP_DIR is required}"
: "${IMAGE_REPOSITORY:?IMAGE_REPOSITORY is required}"
: "${NAMESPACE:?NAMESPACE is required}"
: "${DEPLOYMENT_NAME:?DEPLOYMENT_NAME is required}"
: "${CONTAINER_NAME:?CONTAINER_NAME is required}"
: "${MANIFEST_PATH:?MANIFEST_PATH is required}"

KUBECONFIG_PATH="${KUBECONFIG_PATH:-${HOME}/.kube/thinker-k3s.yaml}"
KUBECTL_SERVER="${KUBECTL_SERVER:-}"
IMAGE_TAG="${1:-${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}}"
REMOTE_IMAGE="${REMOTE_IMAGE:-127.0.0.1:5000/${IMAGE_REPOSITORY}:${IMAGE_TAG}}"
APP_VERSION_ENV_VAR="${APP_VERSION_ENV_VAR:-}"
APP_VERSION_VALUE="${APP_VERSION_VALUE:-thinker-registry-${IMAGE_TAG}}"
KUBECTL_ARGS=(--kubeconfig "${KUBECONFIG_PATH}")

if [[ -n "${KUBECTL_SERVER}" ]]; then
  KUBECTL_ARGS+=(--server "${KUBECTL_SERVER}" --insecure-skip-tls-verify=true)
fi

"${SCRIPT_DIR}/publish-to-thinker-registry.sh" "${IMAGE_TAG}"

echo "==> Applying manifest without bootstrap secrets"
python - "${MANIFEST_PATH}" <<'PY' | kubectl "${KUBECTL_ARGS[@]}" apply -f -
import pathlib
import sys

manifest = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
docs = []
for chunk in manifest.split("\n---\n"):
    stripped = chunk.strip()
    if not stripped:
        continue
    kind = None
    for line in stripped.splitlines():
        if line.startswith("kind:"):
            kind = line.split(":", 1)[1].strip()
            break
    if kind == "Secret":
        continue
    docs.append(stripped)

if docs:
    sys.stdout.write("\n---\n".join(docs) + "\n")
PY

echo "==> Updating deployed image"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" set image "deployment/${DEPLOYMENT_NAME}" "${CONTAINER_NAME}=${REMOTE_IMAGE}"

if [[ -n "${APP_VERSION_ENV_VAR}" ]]; then
  echo "==> Updating ${APP_VERSION_ENV_VAR}=${APP_VERSION_VALUE}"
  kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" set env "deployment/${DEPLOYMENT_NAME}" "${APP_VERSION_ENV_VAR}=${APP_VERSION_VALUE}"
fi

echo "==> Restarting rollout"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" rollout restart "deployment/${DEPLOYMENT_NAME}"
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" rollout status "deployment/${DEPLOYMENT_NAME}" --timeout=180s

echo
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" get deployment "${DEPLOYMENT_NAME}" -o wide
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" get pods -o wide
