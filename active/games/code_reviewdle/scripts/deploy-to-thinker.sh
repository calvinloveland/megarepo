#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_DIR
export BUILD_CONTEXT="$(cd -- "${APP_DIR}/../.." && pwd)"
export DOCKERFILE_RELATIVE_PATH="games/code_reviewdle/Dockerfile"
export IMAGE_REPOSITORY="codereviewdle"
export NAMESPACE="codereviewdle"
export DEPLOYMENT_NAME="codereviewdle"
export CONTAINER_NAME="codereviewdle"
export MANIFEST_PATH="${APP_DIR}/k8s/code-reviewdle.yaml"
export APP_VERSION_ENV_VAR="APP_VERSION"

exec "${APP_DIR}/../../web-apps/shared/scripts/deploy-to-thinker.sh" "$@"
