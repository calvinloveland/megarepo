#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG_PATH:-${HOME}/.kube/thinker-k3s.yaml}"
KUBECTL_SERVER="${KUBECTL_SERVER:-}"
NAMESPACE="${NAMESPACE:-vernissage}"
PUBLIC_URL="${PUBLIC_URL:-https://thevernissage.art}"
THINKER_HOST="${THINKER_HOST:-thinker}"

KUBECTL_ARGS=(--kubeconfig "${KUBECONFIG_PATH}")
if [[ -n "${KUBECTL_SERVER}" ]]; then
  KUBECTL_ARGS+=(--server "${KUBECTL_SERVER}" --insecure-skip-tls-verify=true)
fi

echo '==> Deployment status'
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" get deploy vernissage
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" rollout status deployment/vernissage --timeout=180s

echo
echo '==> Pod status'
kubectl "${KUBECTL_ARGS[@]}" -n "${NAMESPACE}" get pods -o wide

echo
echo '==> Public checks'
curl -fsSI "${PUBLIC_URL}" | sed -n '1,8p'
echo '---'
curl -fsS "${PUBLIC_URL}/api/health"
echo
echo '---'
curl -fsS "${PUBLIC_URL}/api/ready"
echo

echo
echo '==> Registry tags on thinker'
ssh "${THINKER_HOST}" "bash -lc 'curl -fsS http://127.0.0.1:5000/v2/vernissage/tags/list'"
echo
