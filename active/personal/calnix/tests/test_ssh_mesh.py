#!/usr/bin/env python3
"""Static regression guard for the calnix cross-host SSH mesh.

Assurance goal: 1337book must be able to SSH into haswell and thinker (and, in
general, every calnix host must authorize every host's client key) after a
rebuild — not merely because someone hand-edited a ``~/.ssh/authorized_keys``.

These tests are offline: they assert the flake source declares the required keys
in the shared base module. The live end-to-end check lives in
``scripts/verify_ssh_mesh.py`` (``--live``).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_spec = importlib.util.spec_from_file_location(
    "verify_ssh_mesh", ROOT / "scripts" / "verify_ssh_mesh.py"
)
mesh = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(mesh)


def test_declared_keys_include_every_host_client_key():
    declared = mesh.parse_declared_keys()
    for host, key in mesh.HOST_CLIENT_KEYS.items():
        assert key in declared, f"{host} client key missing from modules/base.nix"


def test_1337book_reaches_haswell_and_thinker():
    """The explicitly requested guarantee."""
    declared = mesh.parse_declared_keys()
    key = mesh.HOST_CLIENT_KEYS["1337book"]
    assert key in declared
    for target in ("haswell", "thinker"):
        assert mesh.host_imports_base(target), f"{target} must import the shared base module"


def test_every_host_imports_shared_base_module():
    for host in mesh.HOSTS:
        assert mesh.host_imports_base(host), f"hosts/{host}/configuration.nix must import base.nix"


def test_default_mesh_has_no_static_failures():
    failures = [msg for ok, msg in mesh.static_checks(mesh.DEFAULT_MESH) if not ok]
    assert failures == [], f"static SSH mesh checks failed: {failures}"


def test_parse_declared_keys_errors_without_block(tmp_path):
    bogus = tmp_path / "base.nix"
    bogus.write_text("{ }: { }")
    try:
        mesh.parse_declared_keys(bogus)
    except ValueError:
        return
    raise AssertionError("expected ValueError for a base.nix without an authorizedKeys block")


if __name__ == "__main__":
    import sys

    failures = [msg for ok, msg in mesh.static_checks(mesh.DEFAULT_MESH) if not ok]
    if failures:
        print("SSH mesh static checks FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        sys.exit(1)
    print("SSH mesh static checks passed.")
