#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_DIR
export BUILD_CONTEXT="$(cd -- "${APP_DIR}/.." && pwd)"
export DOCKERFILE_RELATIVE_PATH="momos/Dockerfile"
export IMAGE_REPOSITORY="cozi"
export NAMESPACE="cozi"
export DEPLOYMENT_NAME="cozi"
export CONTAINER_NAME="cozi"
export MANIFEST_PATH="${APP_DIR}/k8s/cozi.yaml"

exec "${APP_DIR}/../shared/scripts/deploy-to-thinker.sh" "$@"
