"""Pytest fixtures and shared helpers for the drop app tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the src/ layout importable.
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


@pytest.fixture
def tmp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point drop's data paths at a tmp location for the duration of the test.

    `drop.storage` and `drop.app` import DATA_DIR/UPLOADS_DIR/INDEX_FILE via
    `from . import ...`, which creates a *local binding* in those modules.
    We have to patch the attribute on every module that captured the binding
    — patching only `drop.DATA_DIR` is not enough.

    We deliberately do NOT reload the modules: reloading would give
    `StorageFullError` (and other classes) a new identity, breaking
    `pytest.raises` comparisons in the tests.
    """
    import drop
    import drop.app
    import drop.storage

    data_dir = tmp_path / "data"
    uploads_dir = data_dir / "uploads"
    index_file = data_dir / "index.json"

    for mod in (drop, drop.storage, drop.app):
        monkeypatch.setattr(mod, "DATA_DIR", data_dir, raising=False)
        monkeypatch.setattr(mod, "UPLOADS_DIR", uploads_dir, raising=False)
        monkeypatch.setattr(mod, "INDEX_FILE", index_file, raising=False)

    return data_dir
