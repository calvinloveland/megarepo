"""Pluggable spell generation interface and helpers.

Define a small, testable `SpellGenerator` abstract base class and a helper
`get_generator_from_env` that chooses a concrete backend based on
`WIZARD_FIGHT_SPELL_BACKEND` (defaults to `auto`/fallback to local behavior).

This keeps `research.py` LLM-agnostic and allows adding multiple backends.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import os
import logging

logger = logging.getLogger(__name__)


class SpellGenerator(ABC):
    """Abstract interface for spell generation backends."""

    @abstractmethod
    def generate(self, system: str, user: str, *, timeout: Optional[float] = None) -> str:
        """Return the raw generated text from the backend.

        Args:
            system: system prompt/content
            user: user prompt/content
            timeout: seconds to wait before timing out

        Returns:
            Raw text output from model (usually contains JSON payload)
        """


class LocalFallbackGenerator(SpellGenerator):
    """Adapter that invokes existing local/openai/ollama helpers in research.py.

    This keeps behavior backward-compatible until a dedicated adapter is
    implemented.
    """

    def __init__(self, caller):
        # caller is expected to have a .call(system, user) -> str method
        self._caller = caller

    def generate(self, system: str, user: str, *, timeout: Optional[float] = None) -> str:
        return self._caller(system, user)


def get_generator_from_env() -> SpellGenerator:
    """Return a SpellGenerator instance configured by environment vars.

    - WIZARD_FIGHT_SPELL_BACKEND: 'auto' (default), 'local', 'openai', 'copilot'
    """
    backend = os.getenv("WIZARD_FIGHT_SPELL_BACKEND", "auto").lower()

    # Lazy import to avoid hard dependency
    try:
        if backend == "copilot":
            from wizard_fight.backends.copilot_backend import CopilotGenerator

            return CopilotGenerator()
    except Exception:  # pragma: no cover - defensive import
        logger.exception("Failed to initialize Copilot backend; falling back to local")

    # Default fallback: use existing _call_llm behavior in research module
    try:
        from wizard_fight import research as research_module

        return LocalFallbackGenerator(research_module._call_llm)
    except Exception:  # pragma: no cover - defensive
        raise RuntimeError("No available spell generator backends")
