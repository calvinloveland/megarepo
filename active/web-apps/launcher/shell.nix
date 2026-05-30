{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    # Core Python
    python3

    # Launcher deps
    python3Packages.flask
    python3Packages.pyyaml

    # Common web app deps
    python3Packages.gunicorn
    python3Packages.flask-wtf
    python3Packages.flask-socketio
    python3Packages.flask-cors
    python3Packages.flask-sqlalchemy
    python3Packages.sqlalchemy
    python3Packages.werkzeug
    python3Packages.pydantic
    python3Packages.loguru
    python3Packages.pytest
    python3Packages.requests

    # Node.js for frontend apps
    nodejs_22
  ];

  # Prettier shell prompt
  shellHook = ''
    echo "📦 Megarepo Launcher environment ready"
  '';
}
