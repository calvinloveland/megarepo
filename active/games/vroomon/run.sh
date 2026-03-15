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

cd "${ELECTRON_DIR}"

if [[ ! -d node_modules ]] || [[ ! -f node_modules/.package-lock.json ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm install
fi

if is_nixos && command -v nix >/dev/null 2>&1; then
  npm run build
  exec nix --extra-experimental-features "nix-command flakes" shell nixpkgs#electron -c electron . "$@"
fi

exec npm start -- "$@"
