"""Pluggable spell generation interface and helpers.

Define a small, testable `SpellGenerator` abstract base class and a helper
`get_generator_from_env` that chooses a concrete backend based on
`WIZARD_FIGHT_SPELL_BACKEND` (defaults to `auto`/fallback to local behavior).

This keeps `research.py` LLM-agnostic and allows adding multiple backends.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
import importlib
import logging
import os
from typing import Optional

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

    @abstractmethod
    def backend_name(self) -> str:
        """Return a short identifier for telemetry/debug output."""


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

    def backend_name(self) -> str:
        return "local-fallback"


def get_generator_from_env() -> SpellGenerator:
    """Return a SpellGenerator instance configured by environment vars.

    - WIZARD_FIGHT_SPELL_BACKEND: 'auto' (default), 'local', 'openai', 'copilot'
    """
    backend = os.getenv("WIZARD_FIGHT_SPELL_BACKEND", "auto").lower()

    if backend == "copilot":
        copilot_generator = _load_copilot_generator()
        if copilot_generator is not None:
            return copilot_generator()
        logger.warning("Failed to initialize Copilot backend; falling back to local")

    try:
        research_module = importlib.import_module("wizard_fight.research")
    except ModuleNotFoundError as exc:
        raise RuntimeError("No available spell generator backends") from exc
    caller = getattr(research_module, "_call_llm", None)
    if caller is None:
        raise RuntimeError("No available spell generator backends")
    return LocalFallbackGenerator(caller)


def _load_copilot_generator():
    """Load Copilot generator class without hard import-time dependency."""
    try:
        module = importlib.import_module("wizard_fight.backends.copilot_backend")
    except ModuleNotFoundError:
        return None
    return getattr(module, "CopilotGenerator", None)
