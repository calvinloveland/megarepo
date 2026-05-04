#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_DIR
export BUILD_CONTEXT="$(cd -- "${APP_DIR}/.." && pwd)"
export DOCKERFILE_RELATIVE_PATH="sub-day-generator/Dockerfile"
export IMAGE_REPOSITORY="sub-day-generator"

exec "${APP_DIR}/../shared/scripts/publish-to-thinker-registry.sh" "$@"
