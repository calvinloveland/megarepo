{ pkgs ? import <nixpkgs> {} }:

let
  pythonShim = pkgs.writeShellScriptBin "python" ''
    exec ${pkgs.python3}/bin/python3 "$@"
  '';
  steamRun = pkgs."steam-run-free";
in
pkgs.mkShell {
  packages = with pkgs; [
    gcc
    gnumake
    cmake
    ninja
    python3
    pythonShim
    git
    espflash
    steamRun
    pkg-config
    jq
  ];

  shellHook = ''
    export ESP_ARRAY_FIRMWARE_DEV_SHELL=1
    export ESP_ARRAY_FIRMWARE_ROOT="$PWD/firmware"
    if [ -d "$PWD/.esp-idf/esp-idf" ]; then
      export IDF_PATH="$PWD/.esp-idf/esp-idf"
      export IDF_TOOLS_PATH="$PWD/.esp-idf/tools"
    fi
    echo "ESP Array firmware dev shell"
    echo "- generic build tools available: gcc, make, cmake, ninja"
    echo "- esp flash tool available: espflash"
    echo "- ESP-IDF-managed Python tools are expected to come from the local IDF env, not nix-shell"
    echo "- FHS bridge available: steam-run (for generic Linux ESP-IDF tool binaries on NixOS)"
    if [ -n "''${IDF_PATH:-}" ]; then
      echo "- local ESP-IDF checkout detected: $IDF_PATH"
      echo "- to enter full Espressif env: source $PWD/.esp-idf/activate-idf.sh"
    else
      echo "- no local ESP-IDF checkout yet"
      echo "- bootstrap one with: bash bin/bootstrap-esp-idf.sh --checkout-only"
    fi
  '';
}
