{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    gcc
    gnumake
    cmake
    ninja
    python3
    git
    esptool
    espflash
    pkg-config
    jq
  ];

  shellHook = ''
    export ESP_ARRAY_FIRMWARE_DEV_SHELL=1
    echo "ESP Array firmware dev shell"
    echo "- generic build tools available: gcc, make, cmake, ninja"
    echo "- esp flash tools available: esptool, espflash"
    echo "- note: ESP-IDF itself (idf.py / IDF_PATH) is still not bundled here"
  '';
}
