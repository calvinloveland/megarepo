#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

THINKER_HOST="${THINKER_HOST:-thinker}"
REMOTE_REGISTRY_NAME="${REMOTE_REGISTRY_NAME:-thinker-registry}"
REMOTE_REGISTRY_DATA_DIR="${REMOTE_REGISTRY_DATA_DIR:-/home/calvin/.local/share/thinker-registry}"
REMOTE_REGISTRY_ADDR="${REMOTE_REGISTRY_ADDR:-127.0.0.1:5000}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-vernissage}"
LOCAL_IMAGE="${LOCAL_IMAGE:-vernissage:thinker-build}"
IMAGE_TAG="${1:-${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}}"
REMOTE_IMAGE_BASE="${REMOTE_REGISTRY_ADDR}/${IMAGE_REPOSITORY}"
REMOTE_IMAGE_TAGGED="${REMOTE_IMAGE_BASE}:${IMAGE_TAG}"
REMOTE_IMAGE_LATEST="${REMOTE_IMAGE_BASE}:latest"
REMOTE_BUILD_DIR=""

remote_bash() {
  local script="$1"
  ssh "${THINKER_HOST}" 'bash -s' <<<"${script}"
}

cleanup_remote_build_dir() {
  if [[ -n "${REMOTE_BUILD_DIR}" ]]; then
    remote_bash "rm -rf '${REMOTE_BUILD_DIR}'"
  fi
}

trap cleanup_remote_build_dir EXIT

ensure_remote_registry() {
  remote_bash "
    mkdir -p '${REMOTE_REGISTRY_DATA_DIR}'
    if docker ps -a --format '{{.Names}}' | grep -qx '${REMOTE_REGISTRY_NAME}'; then
      docker start '${REMOTE_REGISTRY_NAME}' >/dev/null || true
    else
      docker run -d --restart unless-stopped \
        -p 127.0.0.1:5000:5000 \
        -v '${REMOTE_REGISTRY_DATA_DIR}:/var/lib/registry' \
        --name '${REMOTE_REGISTRY_NAME}' \
        registry:2 >/dev/null
    fi
    curl -fsS http://${REMOTE_REGISTRY_ADDR}/v2/ >/dev/null
  "
}

create_remote_build_dir() {
  REMOTE_BUILD_DIR="$(ssh "${THINKER_HOST}" 'mktemp -d /tmp/vernissage-build.XXXXXX')"
}

stream_source_to_remote() {
  tar \
    --exclude='.next' \
    --exclude='node_modules' \
    --exclude='runtime' \
    --exclude='playwright-report' \
    --exclude='test-results' \
    --exclude='data/*.db' \
    -C "${APP_DIR}" \
    -cf - . | ssh "${THINKER_HOST}" "tar -xf - -C '${REMOTE_BUILD_DIR}'"
}

echo "==> Ensuring private registry is running on ${THINKER_HOST}"
ensure_remote_registry

echo "==> Streaming current source tree to ${THINKER_HOST}"
create_remote_build_dir
stream_source_to_remote

echo "==> Pushing ${REMOTE_IMAGE_TAGGED} and ${REMOTE_IMAGE_LATEST}"
remote_bash "
  docker build -t '${REMOTE_IMAGE_TAGGED}' -t '${REMOTE_IMAGE_LATEST}' '${REMOTE_BUILD_DIR}'
  docker push '${REMOTE_IMAGE_TAGGED}' >/tmp/vernissage-push-tagged.log
  docker push '${REMOTE_IMAGE_LATEST}' >/tmp/vernissage-push-latest.log
  tail -n 3 /tmp/vernissage-push-tagged.log
  tail -n 3 /tmp/vernissage-push-latest.log
"

echo
echo "Published:"
echo "  ${REMOTE_IMAGE_TAGGED}"
echo "  ${REMOTE_IMAGE_LATEST}"
