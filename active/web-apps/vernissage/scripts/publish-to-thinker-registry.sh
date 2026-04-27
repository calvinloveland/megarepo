#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

THINKER_HOST="${THINKER_HOST:-thinker}"
REMOTE_REGISTRY_NAME="${REMOTE_REGISTRY_NAME:-thinker-registry}"
REMOTE_REGISTRY_DATA_DIR="${REMOTE_REGISTRY_DATA_DIR:-/home/calvin/.local/share/thinker-registry}"
REMOTE_REGISTRY_VOLUME_NAME="${REMOTE_REGISTRY_VOLUME_NAME:-thinker-registry-data}"
REMOTE_REGISTRY_ADDR="${REMOTE_REGISTRY_ADDR:-127.0.0.1:5000}"
REMOTE_REGISTRY_BIND_ADDR="${REMOTE_REGISTRY_BIND_ADDR:-127.0.0.1}"
REMOTE_BUILD_DOCKER_HOST="${REMOTE_BUILD_DOCKER_HOST:-}"
REMOTE_REGISTRY_DOCKER_HOST="${REMOTE_REGISTRY_DOCKER_HOST:-}"
REMOTE_REGISTRY_NFS_ADDR="${REMOTE_REGISTRY_NFS_ADDR:-}"
REMOTE_REGISTRY_NFS_DEVICE="${REMOTE_REGISTRY_NFS_DEVICE:-}"
REMOTE_REGISTRY_NFS_OPTS="${REMOTE_REGISTRY_NFS_OPTS:-nfsvers=4,rw}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-vernissage}"
LOCAL_IMAGE="${LOCAL_IMAGE:-vernissage:thinker-build}"
IMAGE_TAG="${1:-${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)}}"
REMOTE_IMAGE_BASE="${REMOTE_REGISTRY_ADDR}/${IMAGE_REPOSITORY}"
REMOTE_IMAGE_TAGGED="${REMOTE_IMAGE_BASE}:${IMAGE_TAG}"
REMOTE_IMAGE_LATEST="${REMOTE_IMAGE_BASE}:latest"
REMOTE_BUILD_DIR=""

if [[ -n "${REMOTE_REGISTRY_NFS_ADDR}" || -n "${REMOTE_REGISTRY_NFS_DEVICE}" ]]; then
  if [[ -z "${REMOTE_REGISTRY_NFS_ADDR}" || -z "${REMOTE_REGISTRY_NFS_DEVICE}" ]]; then
    echo "REMOTE_REGISTRY_NFS_ADDR and REMOTE_REGISTRY_NFS_DEVICE must be set together." >&2
    exit 1
  fi
fi

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
  local use_nfs_volume="false"
  local desired_mount_ref="${REMOTE_REGISTRY_DATA_DIR}"
  local desired_port_binding="${REMOTE_REGISTRY_BIND_ADDR}:5000"
  local prepare_storage=""
  local create_container_storage_args=""

  if [[ -n "${REMOTE_REGISTRY_NFS_ADDR}" ]]; then
    use_nfs_volume="true"
    desired_mount_ref="${REMOTE_REGISTRY_VOLUME_NAME}"
    prepare_storage="
      registry_docker volume create \
        --driver local \
        --opt type=nfs \
        --opt o='addr=${REMOTE_REGISTRY_NFS_ADDR},${REMOTE_REGISTRY_NFS_OPTS}' \
        --opt device=':${REMOTE_REGISTRY_NFS_DEVICE}' \
        '${REMOTE_REGISTRY_VOLUME_NAME}' >/dev/null
    "
    create_container_storage_args="-v '${REMOTE_REGISTRY_VOLUME_NAME}:/var/lib/registry'"
  else
    prepare_storage="mkdir -p '${REMOTE_REGISTRY_DATA_DIR}'"
    create_container_storage_args="-v '${REMOTE_REGISTRY_DATA_DIR}:/var/lib/registry'"
  fi

  remote_bash "
    registry_docker() {
      if [[ -n '${REMOTE_REGISTRY_DOCKER_HOST}' ]]; then
        DOCKER_HOST='${REMOTE_REGISTRY_DOCKER_HOST}' docker \"\$@\"
      else
        docker \"\$@\"
      fi
    }
    ${prepare_storage}
    if registry_docker ps -a --format '{{.Names}}' | grep -qx '${REMOTE_REGISTRY_NAME}'; then
      mount_type=\$(registry_docker inspect --format '{{range .Mounts}}{{if eq .Destination \"/var/lib/registry\"}}{{.Type}}{{end}}{{end}}' '${REMOTE_REGISTRY_NAME}')
      mount_source=\$(registry_docker inspect --format '{{range .Mounts}}{{if eq .Destination \"/var/lib/registry\"}}{{if eq .Type \"volume\"}}{{.Name}}{{else}}{{.Source}}{{end}}{{end}}{{end}}' '${REMOTE_REGISTRY_NAME}')
      port_binding=\$(registry_docker inspect --format '{{with index .HostConfig.PortBindings \"5000/tcp\"}}{{(index . 0).HostIp}}:{{(index . 0).HostPort}}{{end}}' '${REMOTE_REGISTRY_NAME}')
      if [[ \"${use_nfs_volume}\" == 'true' ]]; then
        if [[ \"\${mount_type}\" != 'volume' || \"\${mount_source}\" != '${desired_mount_ref}' || \"\${port_binding}\" != '${desired_port_binding}' ]]; then
          registry_docker rm -f '${REMOTE_REGISTRY_NAME}' >/dev/null
        else
          registry_docker start '${REMOTE_REGISTRY_NAME}' >/dev/null || true
        fi
      else
        if [[ \"\${mount_type}\" != 'bind' || \"\${mount_source}\" != '${desired_mount_ref}' || \"\${port_binding}\" != '${desired_port_binding}' ]]; then
          registry_docker rm -f '${REMOTE_REGISTRY_NAME}' >/dev/null
        else
          registry_docker start '${REMOTE_REGISTRY_NAME}' >/dev/null || true
        fi
      fi
    fi
    if ! registry_docker ps -a --format '{{.Names}}' | grep -qx '${REMOTE_REGISTRY_NAME}'; then
      registry_docker run -d --restart unless-stopped \
        -p '${REMOTE_REGISTRY_BIND_ADDR}:5000:5000' \
        ${create_container_storage_args} \
        --name '${REMOTE_REGISTRY_NAME}' \
        registry:2 >/dev/null
    fi
    for attempt in {1..20}; do
      if curl -fsS http://${REMOTE_REGISTRY_ADDR}/v2/ >/dev/null; then
        break
      fi
      sleep 1
    done
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
  build_docker() {
    if [[ -n '${REMOTE_BUILD_DOCKER_HOST}' ]]; then
      DOCKER_HOST='${REMOTE_BUILD_DOCKER_HOST}' docker \"\$@\"
    else
      docker \"\$@\"
    fi
  }
  build_docker build -t '${REMOTE_IMAGE_TAGGED}' -t '${REMOTE_IMAGE_LATEST}' '${REMOTE_BUILD_DIR}'
  build_docker push '${REMOTE_IMAGE_TAGGED}' >/tmp/vernissage-push-tagged.log
  build_docker push '${REMOTE_IMAGE_LATEST}' >/tmp/vernissage-push-latest.log
  tail -n 3 /tmp/vernissage-push-tagged.log
  tail -n 3 /tmp/vernissage-push-latest.log
"

echo
echo "Published:"
echo "  ${REMOTE_IMAGE_TAGGED}"
echo "  ${REMOTE_IMAGE_LATEST}"
