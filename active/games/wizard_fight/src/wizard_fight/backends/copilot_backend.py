"""Copilot backend adapter used by spell generation."""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from shutil import which
from typing import Any, Optional

try:
    from wizard_fight.generation import SpellGenerator
except ModuleNotFoundError:
    SpellGenerator = object  # pragma: no cover - fallback for local lint/runtime contexts


logger = logging.getLogger(__name__)

DEFAULT_MODEL = "raptor-mini"


class CopilotGenerator(SpellGenerator):
    """Spell generator backed by a Copilot-compatible SDK client."""

    def __init__(self, model: Optional[str] = None, timeout: float = 20.0):
        self.model = model or os.getenv("WIZARD_FIGHT_COPILOT_MODEL", DEFAULT_MODEL)
        self.timeout = float(os.getenv("WIZARD_FIGHT_COPILOT_TIMEOUT", str(timeout)))
        self.allow_premium = os.getenv("WIZARD_FIGHT_ALLOW_PREMIUM", "false").lower() in (
            "1",
            "true",
            "yes",
        )
        self._client = None

    @staticmethod
    def _load_client_class():
        module_names = ("copilot", "github_copilot_sdk")
        for module_name in module_names:
            try:
                module = importlib.import_module(module_name)
            except ModuleNotFoundError:
                continue
            for class_name in ("CopilotClient", "Copilot", "Client"):
                client_class = getattr(module, class_name, None)
                if client_class is not None:
                    return client_class
        return None

    @staticmethod
    def _build_client(client_class, cli_url: Optional[str]):
        if cli_url is None:
            try:
                return client_class()
            except TypeError:
                return client_class({})
        option_candidates = (
            ({"cli_url": cli_url},),
            ({"cliUrl": cli_url},),
            (),
        )
        keyword_candidates = ({"cli_url": cli_url}, {})
        for args in option_candidates:
            try:
                return client_class(*args)
            except TypeError:
                continue
        for kwargs in keyword_candidates:
            try:
                return client_class(**kwargs)
            except TypeError:
                continue
        return None

    def _ensure_client(self):
        """Initialize Copilot client lazily."""
        if self._client is not None:
            return
        client_class = self._load_client_class()
        if client_class is None:
            self._log_cli_hint()
            return
        cli_url = os.getenv("WIZARD_FIGHT_COPILOT_CLI_URL")
        self._client = self._build_client(client_class, cli_url)
        if self._client is None:
            self._log_cli_hint()

    @staticmethod
    def _log_cli_hint():
        if not which("copilot"):
            return
        logger.info(
            "'copilot' CLI found on PATH. Set WIZARD_FIGHT_COPILOT_CLI_URL to use CLI server mode."
        )

    @staticmethod
    def _run_async(coro):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)

        def runner():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(coro)
            finally:
                loop.close()

        with ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(runner).result()

    def _list_models(self):
        """Return available models as tuples of (model_id, is_premium)."""
        self._ensure_client()
        if self._client is None:
            return []

        if hasattr(self._client, "list_models"):
            model_items = self._client.list_models()
            if asyncio.iscoroutine(model_items):
                model_items = self._run_async(model_items)
            return self._normalize_dict_models(model_items)

        models_attr = getattr(self._client, "models", None)
        if models_attr is None:
            return []
        if hasattr(models_attr, "list") and callable(models_attr.list):
            model_items = list(models_attr.list())
        else:
            model_items = list(models_attr)
        return self._normalize_object_models(model_items)

    @staticmethod
    def _normalize_dict_models(model_items: Any):
        normalized = []
        for model in model_items or []:
            if not isinstance(model, dict):
                continue
            model_id = model.get("id")
            billing = model.get("billing")
            is_premium = bool(billing.get("is_premium")) if isinstance(billing, dict) else False
            if model_id:
                normalized.append((str(model_id), is_premium))
        return normalized

    @staticmethod
    def _normalize_object_models(model_items: Any):
        normalized = []
        for model in model_items or []:
            model_name = getattr(model, "name", None)
            if not model_name:
                continue
            normalized.append((str(model_name), bool(getattr(model, "premium", False))))
        return normalized

    def _select_model(self) -> str:
        """Select model respecting premium restrictions when metadata is available."""
        models = self._list_models()
        if not models:
            return self.model

        requested = self._resolve_requested_model(models)
        if requested is not None:
            return requested
        fallback = self._select_fallback_model(models)
        return fallback if fallback is not None else self.model

    def _resolve_requested_model(self, models):
        model_ids = {model_id for model_id, _ in models}
        requested = self.model
        if requested not in model_ids:
            return None
        if self.allow_premium or not self._is_premium_model(models, requested):
            return requested
        logger.warning(
            "Requested model %s is premium; falling back to non-premium model",
            requested,
        )
        self.model = DEFAULT_MODEL
        return None

    def _select_fallback_model(self, models):
        for model_id, is_premium in models:
            if model_id == DEFAULT_MODEL and (self.allow_premium or not is_premium):
                return model_id
        for model_id, is_premium in models:
            if self.allow_premium or not is_premium:
                return model_id
        return None

    @staticmethod
    def _is_premium_model(models, model_name):
        return any(model_id == model_name and is_premium for model_id, is_premium in models)

    def generate(self, system: str, user: str, *, timeout: Optional[float] = None) -> str:
        """Generate text from Copilot client, returning empty string on failure."""
        active_timeout = timeout or self.timeout
        model = self._select_model()
        self._ensure_client()
        if self._client is None:
            return ""
        try:
            if hasattr(self._client, "start") and hasattr(self._client, "create_session"):
                return self._generate_async_session(system, user, model, active_timeout)
            if hasattr(self._client, "create_session"):
                return self._generate_sync_session(system, user, model)
            if hasattr(self._client, "generate"):
                return self._generate_one_shot(system, user, model, active_timeout)
        except (AttributeError, RuntimeError, TypeError, ValueError):
            logger.exception("Copilot client generation failed")
            return ""
        logger.warning("Copilot client does not expose supported generation APIs")
        return ""

    def backend_name(self) -> str:
        """Return backend label for telemetry/debug."""
        return "copilot"

    def ensure_client(self) -> None:
        """Public wrapper for lazy client initialization."""
        self._ensure_client()

    @property
    def client(self):
        """Expose underlying SDK client for integration/testing hooks."""
        return self._client

    @client.setter
    def client(self, value) -> None:
        self._client = value

    def selected_model(self) -> str:
        """Public helper used by callers/tests that need the resolved model."""
        return self._select_model()

    def _generate_async_session(
        self, system: str, user: str, model: str, timeout: float
    ) -> str:
        async def run_session():
            await self._client.start()
            session = await self._client.create_session({"model": model})
            done = asyncio.Event()
            content_holder = {"text": ""}

            def on_event(event):
                event_type = getattr(getattr(event, "type", None), "value", "")
                if event_type == "assistant.message":
                    content = getattr(getattr(event, "data", None), "content", "")
                    content_holder["text"] = str(content)
                if event_type == "session.idle":
                    done.set()

            session.on(on_event)
            await session.send({"prompt": f"{system}\n{user}\nJSON:"})
            try:
                await asyncio.wait_for(done.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                logger.info("Copilot session timed out after %.1fs", timeout)
            await session.destroy()
            await self._client.stop()
            return content_holder["text"]

        start = time.perf_counter()
        response = self._run_async(run_session())
        duration = time.perf_counter() - start
        logger.info("Copilot async generation completed in %.2fs", duration)
        return str(response or "")

    def _generate_sync_session(self, system: str, user: str, model: str) -> str:
        start = time.perf_counter()
        session = self._create_sync_session(model)
        if session is None:
            return ""
        try:
            response = self._send_session_prompt(session, system, user)
        finally:
            self._cleanup_session(session)
        logger.info("Copilot session generation completed in %.2fs", time.perf_counter() - start)
        return self._extract_response_text(response)

    def _create_sync_session(self, model: str):
        try:
            return self._client.create_session(model=model, streaming=False)
        except TypeError:
            return self._client.create_session({"model": model, "streaming": False})

    @staticmethod
    def _send_session_prompt(session, system: str, user: str):
        prompt_payload = {"prompt": f"{system}\n{user}\nJSON:"}
        if hasattr(session, "send_and_wait"):
            return session.send_and_wait(prompt_payload)
        if hasattr(session, "sendAndWait"):
            return session.sendAndWait(prompt_payload)
        return session.send_and_wait(f"{system}\n{user}\nJSON:")

    @staticmethod
    def _cleanup_session(session):
        if hasattr(session, "stop"):
            session.stop()
        elif hasattr(session, "close"):
            session.close()

    def _generate_one_shot(self, system: str, user: str, model: str, timeout: float) -> str:
        start = time.perf_counter()
        response = self._client.generate(
            model=model,
            system=system,
            user=user,
            timeout=timeout,
        )
        logger.info("Copilot one-shot generation completed in %.2fs", time.perf_counter() - start)
        return self._extract_response_text(response)

    @staticmethod
    def _extract_response_text(response: Any) -> str:
        """Extract text content from common response shapes."""
        if isinstance(response, dict):
            for key in ("data", "content", "text", "message"):
                if key in response:
                    return str(response[key])
            return str(response)
        for key in ("text", "content", "message", "data"):
            if hasattr(response, key):
                return str(getattr(response, key))
        return str(response)
