#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export APP_DIR
export BUILD_CONTEXT="$(cd -- "${APP_DIR}/.." && pwd)"
export DOCKERFILE_RELATIVE_PATH="parambulator/Dockerfile"
export IMAGE_REPOSITORY="parambulator"

exec "${APP_DIR}/../shared/scripts/publish-to-thinker-registry.sh" "$@"
