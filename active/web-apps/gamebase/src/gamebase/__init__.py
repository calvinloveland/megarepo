"""Gamebase — hosting and platform services for AI-created web games."""

from __future__ import annotations

from .app import create_app, get_db
from .config import Settings

__all__ = ["create_app", "get_db", "Settings"]
__version__ = "0.1.0"
