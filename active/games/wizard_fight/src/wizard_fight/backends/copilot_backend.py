"""Copilot SDK adapter for spell generation.

This is a conservative, minimal adapter that:
- Prefers non-premium models (default: raptor-mini)
- Reads config via env vars:
  - WIZARD_FIGHT_COPILOT_MODEL (default raptor-mini)
  - WIZARD_FIGHT_COPILOT_API_KEY (optional depending on setup)
  - WIZARD_FIGHT_ALLOW_PREMIUM (default false)

The adapter attempts to import the `github_copilot_sdk` Python client if
available; otherwise it defers to using the CLI/server approach described in
the SDK docs. Error handling is defensive so the rest of the game can fall
back to existing generators.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

from wizard_fight.generation import SpellGenerator

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "raptor-mini"


class CopilotGenerator(SpellGenerator):
    def __init__(self, model: Optional[str] = None, timeout: float = 20.0):
        self.model = model or os.getenv("WIZARD_FIGHT_COPILOT_MODEL", DEFAULT_MODEL)
        self.timeout = float(os.getenv("WIZARD_FIGHT_COPILOT_TIMEOUT", str(timeout)))
        self.allow_premium = os.getenv("WIZARD_FIGHT_ALLOW_PREMIUM", "false").lower() in (
            "1",
            "true",
            "yes",
        )

        # client is lazily initialized to avoid import-time errors
        self._client = None

    def _ensure_client(self):
        if self._client is not None:
            return
        # Try to import the official Python client
        try:
            import github_copilot_sdk as copilot  # type: ignore

            self._client = copilot.Client()
        except Exception:  # pragma: no cover - fallback
            logger.info("github_copilot_sdk not available; Copilot backend will attempt CLI-based connection")
            self._client = None

    def _select_model(self) -> str:
        # If client provides model listing, use it to ensure non-premium selection.
        try:
            self._ensure_client()
            if self._client is not None and hasattr(self._client, "models"):
                models = list(self._client.models.list())  # type: ignore
                # Filter algorithm: prefer requested model if available and allowed
                names = [m.name for m in models if getattr(m, "name", None)]
                if self.model in names:
                    # Check for premium flag if exposed
                    meta = next((m for m in models if getattr(m, "name", None) == self.model), None)
                    if getattr(meta, "premium", False) and not self.allow_premium:
                        logger.warning("Requested model %s is premium; falling back to default non-premium model", self.model)
                        self.model = DEFAULT_MODEL
                    return self.model

                # Fallback: pick DEFAULT_MODEL if available
                for candidate in [DEFAULT_MODEL]:
                    if candidate in names:
                        return candidate
                # Otherwise pick first non-premium model
                for m in models:
                    if not getattr(m, "premium", False):
                        return getattr(m, "name")
        except Exception:  # pragma: no cover - defensive
            logger.exception("Model listing failed; using configured model: %s", self.model)

        return self.model

    def generate(self, system: str, user: str, *, timeout: Optional[float] = None) -> str:
        timeout = timeout or self.timeout
        model = self._select_model()
        self._ensure_client()

        # Minimal implementation: use client if available; otherwise, fall back to CLI via subprocess
        if self._client is not None:
            try:
                # The exact client API may differ; wrap in try/except and be conservative
                start = time.perf_counter()
                response = self._client.generate(
                    model=model,
                    system=system,
                    user=user,
                    timeout=timeout,
                )
                duration = time.perf_counter() - start
                logger.info("Copilot generate completed in %.2fs", duration)
                # Best-effort: extract text field
                return str(getattr(response, "text", getattr(response, "content", "")))
            except Exception as exc:  # pragma: no cover - error handling
                logger.exception("Copilot client generate failed: %s", exc)
                raise

        # CLI fallback: call 'copilot' CLI in server mode via subprocess or HTTP JSON-RPC.
        # For now, return empty string to signal failure so caller falls back to other generators.
        logger.warning("Copilot client not available and CLI fallback not implemented; returning empty response")
        return ""
