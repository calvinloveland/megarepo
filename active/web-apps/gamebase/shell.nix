{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    (python3.withPackages (ps: [
      ps.flask
      ps.pyyaml
      ps.pytest
    ]))
  ];

  shellHook = ''
    echo "🕹️  Gamebase environment ready"
    echo "    Run tests:  PYTHONPATH=src python3 -m pytest -q"
    echo "    Run server: PYTHONPATH=src PORT=5121 python3 -m gamebase"
  '';
}
