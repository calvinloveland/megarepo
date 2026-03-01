"""Shared lint-related defaults used across modules."""

from __future__ import annotations

from typing import Any

COMMON_IGNORE_DIRS = (
    ".venv",
    "venv",
    ".env",
    "env",
    "node_modules",
    ".git",
    "__pycache__",
    ".tox",
    ".nox",
    ".eggs",
    "archive",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
)

PYLINT_IGNORE_DIRS = (
    ".git",
    ".venv",
    "venv",
    ".env",
    "env",
    "node_modules",
    "__pycache__",
    ".tox",
    ".nox",
    ".eggs",
    "archive",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
)
COVERAGE_IGNORE_PATTERNS = (
    *COMMON_IGNORE_DIRS[:10],
    "*.egg-info",
    "archive",
    "ui_tests",
    "build",
    "dist",
    ".mypy_cache",
    ".pytest_cache",
)
PROJECT_SCAN_IGNORE_DIRS = COMMON_IGNORE_DIRS


def coerce_bool(
    value: Any,
    *,
    default: bool = False,
    truthy_unknown_str: bool = False,
) -> bool:
    """Normalize common bool-like values into a boolean."""

    result = default
    if isinstance(value, bool):
        result = value
    elif isinstance(value, (int, float)):
        result = bool(value)
    elif isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            result = True
        elif normalized in {"0", "false", "no", "off"}:
            result = False
        elif normalized and truthy_unknown_str:
            result = True
    return result
