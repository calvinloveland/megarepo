"""Test configuration for vroomon.

Skip physics/graphics tests unless optional dependencies are installed.
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import pytest


def _is_missing(module_name: str) -> bool:
    try:
        importlib.import_module(module_name)
    except ImportError:
        return True
    return False


_MISSING_DEPS = (
    []
    if os.environ.get("VROOMON_REQUIRE_GRAPHICS") == "1"
    else [name for name in ("pygame", "pymunk") if _is_missing(name)]
)


def pytest_ignore_collect(collection_path: Path, config: pytest.Config) -> bool:
    if not _MISSING_DEPS:
        return False
    return "tests" in str(collection_path)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not _MISSING_DEPS:
        return
    reason = f"Missing optional dependencies: {', '.join(_MISSING_DEPS)}"
    marker = pytest.mark.skip(reason=reason)
    for item in items:
        item.add_marker(marker)
