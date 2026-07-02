#!/usr/bin/env python3
"""Build Docker images for web apps on demand.

Usage:
    python scripts/build_docker.py                          # build all images
    python scripts/build_docker.py parambulator             # build one
    python scripts/build_docker.py cozi sub-day-generator   # build several
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

IMAGES: dict[str, dict[str, str | Path]] = {
    "parambulator": {
        "dockerfile": REPO_ROOT / "active" / "web-apps" / "parambulator" / "Dockerfile",
        "context": REPO_ROOT / "active" / "web-apps",
    },
    "cozi": {
        "dockerfile": REPO_ROOT / "active" / "web-apps" / "momos" / "Dockerfile",
        "context": REPO_ROOT / "active" / "web-apps",
    },
    "sub-day-generator": {
        "dockerfile": REPO_ROOT / "active" / "web-apps" / "sub-day-generator" / "Dockerfile",
        "context": REPO_ROOT / "active" / "web-apps",
    },
    "thermofluid": {
        "dockerfile": REPO_ROOT / "active" / "web-apps" / "recursive-thermofluid-sandbox" / "Dockerfile",
        "context": REPO_ROOT / "active" / "web-apps",
    },
    "vernissage": {
        "dockerfile": REPO_ROOT / "active" / "web-apps" / "vernissage" / "Dockerfile",
        "context": REPO_ROOT / "active" / "web-apps" / "vernissage",
    },
}


def build_image(name: str, info: dict) -> int:
    dockerfile: Path = info["dockerfile"]
    context: Path = info["context"]

    if not dockerfile.exists():
        print(f"  SKIP {name}: Dockerfile not found at {dockerfile}")
        return 0  # not an error if file doesn't exist

    print(f"\n=== Building {name} ===")
    result = subprocess.run(
        [
            "docker", "buildx", "build",
            "--file", str(dockerfile),
            "--tag", f"{name}:local-check",
            str(context),
        ]
    )
    if result.returncode != 0:
        print(f"FAILED: {name}")
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Build web-app Docker images locally")
    parser.add_argument(
        "images", nargs="*", choices=list(IMAGES.keys()),
        help="which images to build (default: all)",
    )
    args = parser.parse_args()

    to_build = args.images if args.images else list(IMAGES.keys())
    exit_code = 0

    for name in to_build:
        exit_code |= build_image(name, IMAGES[name])

    if exit_code == 0:
        print("\n✓ Docker images built successfully")
    else:
        print(f"\n✗ Some Docker builds failed (exit {exit_code})")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
