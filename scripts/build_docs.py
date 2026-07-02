#!/usr/bin/env python3
"""Build the MkDocs documentation site locally.

Builds the staged docs tree via build_docs_site.py, then runs mkdocs build.

Usage:
    python scripts/build_docs.py           # full build
    python scripts/build_docs.py --serve   # build + serve at localhost:8000
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BUILD_DOCS_SITE = REPO_ROOT / "scripts" / "build_docs_site.py"
MKDOCS_CONFIG = REPO_ROOT / "mkdocs.yml"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the MkDocs documentation site locally")
    parser.add_argument("--serve", action="store_true", help="run mkdocs serve after building")
    args = parser.parse_args()

    # Step 1: stage .md files via build_docs_site.py
    print("=== Stage docs tree ===")
    if BUILD_DOCS_SITE.exists():
        result = subprocess.run([sys.executable, str(BUILD_DOCS_SITE)], cwd=REPO_ROOT)
        if result.returncode != 0:
            print("FAILED: build_docs_site.py")
            return result.returncode
    else:
        print(f"  (build_docs_site.py not found at {BUILD_DOCS_SITE}, skipping staging)")

    # Step 2: mkdocs build
    print("\n=== MkDocs build ===")
    cmd = ["mkdocs", "build", "--strict"]
    if args.serve:
        cmd = ["mkdocs", "serve"]

    result = subprocess.run(cmd, cwd=REPO_ROOT)
    if result.returncode != 0:
        print("FAILED: mkdocs build")
        return result.returncode

    print("\n✓ Docs site built successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
