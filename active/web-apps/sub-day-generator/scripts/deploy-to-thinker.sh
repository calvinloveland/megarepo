#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_DIR
export BUILD_CONTEXT="$(cd -- "${APP_DIR}/.." && pwd)"
export DOCKERFILE_RELATIVE_PATH="sub-day-generator/Dockerfile"
export IMAGE_REPOSITORY="sub-day-generator"
export NAMESPACE="sub-day-generator"
export DEPLOYMENT_NAME="sub-day-generator"
export CONTAINER_NAME="sub-day-generator"
export MANIFEST_PATH="${APP_DIR}/k8s/sub-day-generator.yaml"

exec "${APP_DIR}/../shared/scripts/deploy-to-thinker.sh" "$@"
