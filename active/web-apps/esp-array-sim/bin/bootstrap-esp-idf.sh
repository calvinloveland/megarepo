#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ESP_IDF_VERSION="v5.2.2"
ESP_IDF_DIR="$ROOT_DIR/.esp-idf/esp-idf"
IDF_TOOLS_PATH="$ROOT_DIR/.esp-idf/tools"
ACTIVATE_SH="$ROOT_DIR/.esp-idf/activate-idf.sh"
SUBMODULE_MARKER="$ROOT_DIR/.esp-idf/.submodules-ready-$ESP_IDF_VERSION"
MODE="checkout-only"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--checkout-only|--install-tools]

Bootstraps a project-local ESP-IDF checkout for the ESP Array firmware skeleton.

Modes:
  --checkout-only   clone + checkout + submodules only (default)
  --install-tools   also run ./install.sh esp32 with IDF_TOOLS_PATH inside the repo

Outputs:
  $ESP_IDF_DIR
  $IDF_TOOLS_PATH
  $ACTIVATE_SH
EOF
}

case "${1:-}" in
  ""|--checkout-only) MODE="checkout-only" ;;
  --install-tools) MODE="install-tools" ;;
  -h|--help) usage; exit 0 ;;
  *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
esac

mkdir -p "$ROOT_DIR/.esp-idf"

if [ ! -d "$ESP_IDF_DIR/.git" ]; then
  git clone --depth 1 --branch "$ESP_IDF_VERSION" https://github.com/espressif/esp-idf.git "$ESP_IDF_DIR"
else
  git -C "$ESP_IDF_DIR" fetch --tags origin
  git -C "$ESP_IDF_DIR" checkout "$ESP_IDF_VERSION"
fi

if [ -f "$SUBMODULE_MARKER" ]; then
  echo "submodules already prepared for $ESP_IDF_VERSION"
elif [ -d "$ESP_IDF_DIR/components/esp_wifi/lib" ] && [ -d "$ESP_IDF_DIR/components/mbedtls/mbedtls" ]; then
  echo "existing submodule checkout detected; marking $ESP_IDF_VERSION as prepared"
  touch "$SUBMODULE_MARKER"
else
  git -C "$ESP_IDF_DIR" submodule update --init --recursive --depth 1
  touch "$SUBMODULE_MARKER"
fi

cat > "$ACTIVATE_SH" <<EOF
#!/usr/bin/env bash
export IDF_PATH="$ESP_IDF_DIR"
export IDF_TOOLS_PATH="$IDF_TOOLS_PATH"
if [ -f "\$IDF_PATH/export.sh" ]; then
  . "\$IDF_PATH/export.sh"
else
  echo "ESP-IDF export.sh not found at \$IDF_PATH/export.sh" >&2
fi
EOF
chmod +x "$ACTIVATE_SH"

echo "checked out ESP-IDF $ESP_IDF_VERSION at $ESP_IDF_DIR"
echo "wrote activation helper: $ACTIVATE_SH"

if [ "$MODE" = "install-tools" ]; then
  export IDF_TOOLS_PATH
  export PIP_IGNORE_INSTALLED=1
  rm -rf "$IDF_TOOLS_PATH/python_env"
  (cd "$ESP_IDF_DIR" && ./install.sh esp32)
  echo "installed ESP-IDF tools into $IDF_TOOLS_PATH"
  echo "next: source $ACTIVATE_SH"
else
  echo "checkout complete (tools not installed yet)"
  echo "next: run $(basename "$0") --install-tools"
fi
