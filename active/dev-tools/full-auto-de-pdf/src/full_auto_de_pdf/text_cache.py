"""Shared text cache helpers for benchmark commands."""

from __future__ import annotations

from pathlib import Path
from typing import Callable


def load_or_fetch_text(path: Path, fetcher: Callable[[], str]) -> str:
    """Return cached text when present, otherwise fetch and cache it."""

    if path.exists():
        return path.read_text(encoding="utf-8")
    text = fetcher()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def load_or_fetch_optional_text(
    path: Path,
    fetcher: Callable[[], str | None],
) -> str | None:
    """Return cached optional text when present, otherwise fetch and cache it."""

    if path.exists():
        return path.read_text(encoding="utf-8")
    text = fetcher()
    if text is None:
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text
