{ pkgs, ... }:

let
  python = pkgs.python312;
  pythonEnv = python.withPackages (ps: with ps; [
    pip
    virtualenv
    setuptools
    wheel
    black
    flake8
    pylsp-mypy
    python-lsp-server
    debugpy
    pytest
    ipython
    jupyter
    requests
    numpy
    pandas
    matplotlib
    pygame
  ]);
in
{
  environment.systemPackages = with pkgs; [
    pythonEnv
    poetry
    uv
    ruff

    # SDL libraries for pygame
    SDL2
    SDL2_image
    SDL2_mixer
    SDL2_ttf
    SDL2_net
    SDL2_gfx

    # Additional multimedia libraries that pygame might use
    libpng
    libjpeg
    freetype
    portaudio
  ];
}
