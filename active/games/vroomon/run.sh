#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON_DIR="${SCRIPT_DIR}/electron"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run vroomon." >&2
  exit 1
fi

is_nixos() {
  [[ -f /etc/os-release ]] && grep -qi '^ID=nixos' /etc/os-release
}

run_with_optional_xvfb() {
  if [[ -z "${DISPLAY:-}" ]] && command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run -a "$@"
    return
  fi

  "$@"
}

prepare_runtime_dirs() {
  RUNTIME_SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/vroomon-run-XXXXXX")"
  export TMPDIR="${RUNTIME_SANDBOX}/tmp"
  export XDG_RUNTIME_DIR="${RUNTIME_SANDBOX}/runtime"
  mkdir -p "${TMPDIR}" "${XDG_RUNTIME_DIR}"
  chmod 700 "${XDG_RUNTIME_DIR}"
}

cleanup_runtime_dirs() {
  if [[ -n "${RUNTIME_SANDBOX:-}" && -d "${RUNTIME_SANDBOX}" ]]; then
    rm -rf "${RUNTIME_SANDBOX}"
  fi
}

prefer_x11_when_display_is_available() {
  if [[ -n "${DISPLAY:-}" ]]; then
    unset WAYLAND_DISPLAY
    export XDG_SESSION_TYPE="x11"
    export ELECTRON_OZONE_PLATFORM_HINT="x11"
  fi
}

cd "${ELECTRON_DIR}"

prepare_runtime_dirs
trap cleanup_runtime_dirs EXIT
prefer_x11_when_display_is_available

if [[ ! -d node_modules ]] || [[ ! -f node_modules/.package-lock.json ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm install
fi

if is_nixos && command -v nix >/dev/null 2>&1; then
  export VROOMON_DISABLE_HARDWARE_ACCELERATION="${VROOMON_DISABLE_HARDWARE_ACCELERATION:-1}"
  export VROOMON_DISABLE_SANDBOX="${VROOMON_DISABLE_SANDBOX:-1}"
  export VROOMON_DISABLE_DEV_SHM_USAGE="${VROOMON_DISABLE_DEV_SHM_USAGE:-1}"
  npm run build
  run_with_optional_xvfb nix --extra-experimental-features "nix-command flakes" shell nixpkgs#electron -c electron . "$@"
  exit $?
fi

run_with_optional_xvfb npm start -- "$@"
