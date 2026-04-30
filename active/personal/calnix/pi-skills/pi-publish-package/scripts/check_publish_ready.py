#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def check(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True)
    output = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, output.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Check whether a Pi package looks ready for npm publish")
    parser.add_argument("path", help="Path to package directory")
    args = parser.parse_args()

    pkg_dir = Path(args.path).expanduser().resolve()
    package_json = pkg_dir / "package.json"

    if not pkg_dir.exists() or not pkg_dir.is_dir():
        print(f"ERROR: package directory not found: {pkg_dir}")
        return 2
    if not package_json.exists():
        print(f"ERROR: missing package.json: {package_json}")
        return 2

    pkg = json.loads(package_json.read_text())

    errors: list[str] = []
    warnings: list[str] = []
    infos: list[str] = []

    for required in ["name", "version"]:
        if not pkg.get(required):
            errors.append(f"missing required package.json field: {required}")

    keywords = pkg.get("keywords") or []
    if "pi-package" not in keywords:
        warnings.append('keywords does not include "pi-package" (pi.dev gallery discovery may not work)')

    pi_manifest = pkg.get("pi")
    if not isinstance(pi_manifest, dict):
        errors.append("missing pi manifest in package.json")
    else:
        if not any(pi_manifest.get(key) for key in ["extensions", "skills", "prompts", "themes"]):
            errors.append("pi manifest exists but does not declare extensions/skills/prompts/themes")

    for fname in ["README.md", "LICENSE"]:
        if not (pkg_dir / fname).exists():
            warnings.append(f"missing {fname}")

    for field in ["description", "author", "repository", "homepage", "bugs"]:
        if not pkg.get(field):
            warnings.append(f"missing recommended field: {field}")

    publish_access = ((pkg.get("publishConfig") or {}).get("access"))
    if str(pkg.get("name", "")).startswith("@") and publish_access != "public":
        warnings.append('scoped package without publishConfig.access="public"')

    code, out = check(["npm", "whoami"])
    if code == 0:
        infos.append(f"npm auth: logged in as {out.splitlines()[-1]}")
    else:
        warnings.append("npm auth: not logged in (run `npm login` before publish)")

    code, out = check(["npm", "pack"], cwd=pkg_dir)
    if code == 0:
        tarball = out.splitlines()[-1] if out.splitlines() else "(unknown tarball)"
        infos.append(f"npm pack: ok ({tarball})")
    else:
        errors.append("npm pack failed")
        infos.append(out)

    print(f"Package: {pkg_dir}")
    print(f"Name: {pkg.get('name')}")
    print(f"Version: {pkg.get('version')}")
    print()

    if infos:
        print("Info:")
        for item in infos:
            print(f"  - {item}")
        print()

    if warnings:
        print("Warnings:")
        for item in warnings:
            print(f"  - {item}")
        print()

    if errors:
        print("Errors:")
        for item in errors:
            print(f"  - {item}")
        return 1

    print("Publish readiness: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
