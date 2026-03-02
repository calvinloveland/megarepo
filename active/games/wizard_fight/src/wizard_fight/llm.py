"""LLM related helpers separated from heavier `research` module so tests can
import them without pulling in jsonschema and other optional deps.
"""
from __future__ import annotations

import os


def llm_backend_label() -> str:
    """Resolve a short backend label from environment configuration."""
    spell_backend = os.getenv("WIZARD_FIGHT_SPELL_BACKEND")
    resolved = None
    if spell_backend:
        sb = spell_backend.lower()
        if sb == "copilot":
            model = os.getenv("WIZARD_FIGHT_COPILOT_MODEL", "raptor-mini")
            resolved = f"copilot:{model}"
        else:
            resolved = sb
    if resolved is None:
        mode = os.getenv("WIZARD_FIGHT_LLM_MODE", "local").lower()
        if mode == "openai":
            model = os.getenv("WIZARD_FIGHT_LLM_MODEL", "gpt-4o-mini")
            resolved = f"openai:{model}"
        elif mode == "local":
            backend = os.getenv("WIZARD_FIGHT_LOCAL_BACKEND", "ollama").lower()
            if backend == "ollama":
                model = os.getenv("WIZARD_FIGHT_OLLAMA_MODEL", "llama3.2")
                resolved = f"ollama:{model}"
            elif backend == "transformers":
                model = os.getenv("WIZARD_FIGHT_LOCAL_MODEL", "sshleifer/tiny-gpt2")
                resolved = f"transformers:{model}"
            else:
                resolved = f"local:{backend}"
        else:
            resolved = mode
    return resolved
