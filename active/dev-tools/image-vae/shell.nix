{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    python312
    python312Packages.torch
    python312Packages.torchvision
    python312Packages.numpy
    python312Packages.pillow
  ];

  shellHook = ''
    echo "━━━ image_vae dev shell ━━━━━━━━━━━━━━━━━"
    echo "  Python: $(python3 --version)"
    echo "  Torch:  $(python3 -c 'import torch; print(torch.__version__)' 2>/dev/null || echo '?')"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  '';
}
