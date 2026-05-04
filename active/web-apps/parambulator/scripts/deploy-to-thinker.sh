#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_DIR
export BUILD_CONTEXT="$(cd -- "${APP_DIR}/.." && pwd)"
export DOCKERFILE_RELATIVE_PATH="parambulator/Dockerfile"
export IMAGE_REPOSITORY="parambulator"
export NAMESPACE="parambulator"
export DEPLOYMENT_NAME="parambulator"
export CONTAINER_NAME="parambulator"
export MANIFEST_PATH="${APP_DIR}/k8s/parambulator.yaml"
export APP_VERSION_ENV_VAR="APP_VERSION"

exec "${APP_DIR}/../shared/scripts/deploy-to-thinker.sh" "$@"
