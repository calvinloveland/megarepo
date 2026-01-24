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

        # Try to import the official Python client in a robust way and pass CLI URL
        try:
            import importlib

            copilot_mod = importlib.import_module("github_copilot_sdk")
            ClientClass = getattr(copilot_mod, "CopilotClient", None) or getattr(
                copilot_mod, "Copilot", None
            ) or getattr(copilot_mod, "Client", None)
            if ClientClass is None:
                raise ImportError("No client class found in github_copilot_sdk")

            kwargs = {}
            cli_url = os.getenv("WIZARD_FIGHT_COPILOT_CLI_URL")
            if cli_url:
                # SDKs accept either cliUrl/cli_url naming conventions; try both via kwargs
                # If the constructor doesn't accept it, it will raise and we fall back.
                kwargs["cli_url"] = cli_url
                kwargs["cliUrl"] = cli_url

            try:
                self._client = ClientClass(**kwargs)
            except TypeError:
                # Try without kwargs
                self._client = ClientClass()

            # If client exposes a models attribute, good; otherwise we'll handle defensively later
        except Exception:  # pragma: no cover - fallback
            logger.info(
                "github_copilot_sdk not available or failed to initialize; Copilot backend will not be usable unless the SDK is installed or CLI URL is provided"
            )
            self._client = None

        # If client is not available and a local 'copilot' CLI seems present, log a hint
        if self._client is None:
            from shutil import which

            if which("copilot"):
                logger.info(
                    "'copilot' CLI found on PATH. To use with this backend, either install 'github-copilot-sdk' or run 'copilot --server --port 4321' and set WIZARD_FIGHT_COPILOT_CLI_URL=localhost:4321"
                )

    def _select_model(self) -> str:
        # If client provides model listing, use it to ensure non-premium selection.
        try:
            self._ensure_client()
            if self._client is not None and hasattr(self._client, "models"):
                raw_models = None
                # Support multiple model-listing shapes: attribute list, method list(), or iterable
                if hasattr(self._client.models, "list") and callable(getattr(self._client.models, "list")):
                    raw_models = list(self._client.models.list())  # type: ignore
                else:
                    raw_models = list(self._client.models)

                # Filter algorithm: prefer requested model if available and allowed
                names = [getattr(m, "name", None) for m in raw_models]
                if self.model in names:
                    # Check for premium flag if exposed
                    meta = next((m for m in raw_models if getattr(m, "name", None) == self.model), None)
                    if getattr(meta, "premium", False) and not self.allow_premium:
                        logger.warning("Requested model %s is premium; falling back to default non-premium model", self.model)
                        self.model = DEFAULT_MODEL
                    return self.model

                # Fallback: pick DEFAULT_MODEL if available
                for candidate in [DEFAULT_MODEL]:
                    if candidate in names:
                        return candidate
                # Otherwise pick first non-premium model
                for m in raw_models:
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
                # Try session-based API first (common pattern in SDKs)
                start = time.perf_counter()
                session = None
                if hasattr(self._client, "create_session"):
                    # Prefer named-arg style
                    try:
                        session = self._client.create_session(model=self.model, streaming=False)
                    except TypeError:
                        session = self._client.create_session({"model": self.model, "streaming": False})

                if session is not None:
                    # Try common session send/wait forms
                    try:
                        if hasattr(session, "send_and_wait"):
                            resp = session.send_and_wait({"prompt": f"{system}\n{user}\nJSON:"})
                        elif hasattr(session, "sendAndWait"):
                            resp = session.sendAndWait({"prompt": f"{system}\n{user}\nJSON:"})
                        else:
                            resp = session.send_and_wait(f"{system}\n{user}\nJSON:")
                    finally:
                        # Best-effort stop/cleanup
                        try:
                            if hasattr(session, "stop"):
                                session.stop()
                            elif hasattr(session, "close"):
                                session.close()
                        except Exception:
                            pass

                    duration = time.perf_counter() - start
                    logger.info("Copilot generate (session) completed in %.2fs", duration)
                    # Extract likely fields
                    for candidate in ("data", "content", "text", "message"):
                        if isinstance(resp, dict) and candidate in resp:
                            return str(resp[candidate])
                        if hasattr(resp, candidate):
                            return str(getattr(resp, candidate))
                    # Fallback to string conversion
                    return str(resp)

                # If no session API, try a one-shot generate method
                if hasattr(self._client, "generate"):
                    resp = self._client.generate(model=model, system=system, user=user, timeout=timeout)
                    duration = time.perf_counter() - start
                    logger.info("Copilot generate completed in %.2fs", duration)
                    return str(getattr(resp, "text", getattr(resp, "content", "")))

                # Unknown client shape
                logger.warning("Copilot client present but does not expose known generate APIs")
            except Exception as exc:  # pragma: no cover - error handling
                logger.exception("Copilot client generate failed: %s", exc)
                # Allow caller to catch; return empty string to fall back
                return ""

        # CLI fallback: call 'copilot' CLI in server mode via subprocess or HTTP JSON-RPC.
        # For now, return empty string to signal failure so caller falls back to other generators.
        logger.warning("Copilot client not available and CLI fallback not implemented; returning empty response")
        return ""
