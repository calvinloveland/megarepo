"""LLM related helpers separated from heavier `research` module so tests can
import them without pulling in jsonschema and other optional deps.
"""
from __future__ import annotations

import os


def llm_backend_label() -> str:
    # Prefer explicit spell backend if configured
    spell_backend = os.getenv("WIZARD_FIGHT_SPELL_BACKEND")
    if spell_backend:
        sb = spell_backend.lower()
        if sb == "copilot":
            model = os.getenv("WIZARD_FIGHT_COPILOT_MODEL", "raptor-mini")
            return f"copilot:{model}"
        return sb

    mode = os.getenv("WIZARD_FIGHT_LLM_MODE", "local").lower()
    if mode == "openai":
        model = os.getenv("WIZARD_FIGHT_LLM_MODEL", "gpt-4o-mini")
        return f"openai:{model}"
    if mode == "local":
        backend = os.getenv("WIZARD_FIGHT_LOCAL_BACKEND", "ollama").lower()
        if backend == "ollama":
            model = os.getenv("WIZARD_FIGHT_OLLAMA_MODEL", "llama3.2")
            return f"ollama:{model}"
        if backend == "transformers":
            model = os.getenv("WIZARD_FIGHT_LOCAL_MODEL", "sshleifer/tiny-gpt2")
            return f"transformers:{model}"
        return f"local:{backend}"
    return mode
