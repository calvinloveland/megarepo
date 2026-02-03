"""Copilot SDK client wrapper for lint fixes."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "raptor-mini"


class CopilotFixer:
    def __init__(
        self,
        model: Optional[str] = None,
        timeout: float = 20.0,
        cli_url: Optional[str] = None,
        allow_premium: Optional[bool] = None,
    ) -> None:
        self.model = model or os.getenv("COPILOT_LINT_FIXER_MODEL", DEFAULT_MODEL)
        self.timeout = float(os.getenv("COPILOT_LINT_FIXER_TIMEOUT", str(timeout)))
        self.cli_url = cli_url or os.getenv("COPILOT_LINT_FIXER_CLI_URL")
        allow_env = os.getenv("COPILOT_LINT_FIXER_ALLOW_PREMIUM")
        if allow_premium is None:
            self.allow_premium = (allow_env or "false").lower() in ("1", "true", "yes")
        else:
            self.allow_premium = allow_premium

        self._client = None

    def _ensure_client(self) -> None:
        if self._client is not None:
            return

        try:
            import importlib

            copilot_mod = None
            client_class = None
            try:
                copilot_mod = importlib.import_module("copilot")
                client_class = getattr(copilot_mod, "CopilotClient", None)
            except Exception:
                copilot_mod = importlib.import_module("github_copilot_sdk")
                client_class = (
                    getattr(copilot_mod, "CopilotClient", None)
                    or getattr(copilot_mod, "Copilot", None)
                    or getattr(copilot_mod, "Client", None)
                )

            if client_class is None:
                raise ImportError("No client class found in copilot SDK module")

            if self.cli_url:
                try:
                    self._client = client_class({"cli_url": self.cli_url})
                except TypeError:
                    try:
                        self._client = client_class({"cliUrl": self.cli_url})
                    except TypeError:
                        try:
                            self._client = client_class(cli_url=self.cli_url)
                        except TypeError:
                            self._client = client_class()
            else:
                try:
                    self._client = client_class()
                except TypeError:
                    self._client = client_class({})
        except Exception as exc:  # pragma: no cover - defensive
            logger.info("Copilot SDK not available or failed to initialize: %s", exc)
            self._client = None

    def _run_async(self, coro):
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
            future = executor.submit(runner)
            return future.result()

    def _select_model(self) -> str:
        self._ensure_client()
        if self._client is None:
            return self.model

        try:
            if hasattr(self._client, "list_models"):
                async def list_models_with_start():
                    if hasattr(self._client, "start") and hasattr(self._client, "stop"):
                        await self._client.start()
                        try:
                            return await self._client.list_models()
                        finally:
                            await self._client.stop()
                    return await self._client.list_models()

                models = self._run_async(list_models_with_start())
                if models:
                    requested = self.model
                    for model in models:
                        model_id = model.get("id") if isinstance(model, dict) else None
                        billing = model.get("billing") if isinstance(model, dict) else None
                        is_premium = False
                        if isinstance(billing, dict):
                            is_premium = bool(billing.get("is_premium"))
                        if model_id == requested:
                            if is_premium and not self.allow_premium:
                                raise RuntimeError(
                                    f"Requested model {requested} is premium and allow_premium is false"
                                )
                            return requested

                    if requested != DEFAULT_MODEL:
                        for model in models:
                            model_id = model.get("id") if isinstance(model, dict) else None
                            billing = model.get("billing") if isinstance(model, dict) else None
                            is_premium = False
                            if isinstance(billing, dict):
                                is_premium = bool(billing.get("is_premium"))
                            if model_id == DEFAULT_MODEL and (self.allow_premium or not is_premium):
                                self.model = DEFAULT_MODEL
                                return DEFAULT_MODEL

                    for model in models:
                        model_id = model.get("id") if isinstance(model, dict) else None
                        billing = model.get("billing") if isinstance(model, dict) else None
                        is_premium = False
                        if isinstance(billing, dict):
                            is_premium = bool(billing.get("is_premium"))
                        if model_id and not is_premium:
                            self.model = model_id
                            return model_id

            if hasattr(self._client, "models"):
                raw_models = None
                if hasattr(self._client.models, "list") and callable(getattr(self._client.models, "list")):
                    raw_models = list(self._client.models.list())  # type: ignore
                else:
                    raw_models = list(self._client.models)

                names = [getattr(m, "name", None) for m in raw_models]
                if self.model in names:
                    meta = next((m for m in raw_models if getattr(m, "name", None) == self.model), None)
                    if getattr(meta, "premium", False) and not self.allow_premium:
                        raise RuntimeError(
                            f"Requested model {self.model} is premium and allow_premium is false"
                        )
                    return self.model

                for candidate in [DEFAULT_MODEL]:
                    if candidate in names:
                        self.model = candidate
                        return candidate

                for m in raw_models:
                    if not getattr(m, "premium", False):
                        self.model = getattr(m, "name")
                        return self.model
        except Exception as exc:
            logger.warning("Model selection failed; using configured model %s: %s", self.model, exc)

        return self.model

    def generate_fix(self, system: str, user: str) -> str:
        self._ensure_client()
        if self._client is None:
            raise RuntimeError("Copilot client is not available")

        resolved_model = self._select_model()
        logger.info("Copilot model: %s (allow_premium=%s)", resolved_model, self.allow_premium)

        start = time.perf_counter()

        if hasattr(self._client, "start") and hasattr(self._client, "create_session"):
            async def run_session():
                await self._client.start()
                session = await self._client.create_session({"model": resolved_model})
                done = asyncio.Event()
                content_holder = {"text": ""}

                def on_event(event):
                    try:
                        if event.type.value == "assistant.message":
                            content_holder["text"] = event.data.content
                        elif event.type.value == "session.idle":
                            done.set()
                    except Exception:
                        pass

                session.on(on_event)
                await session.send({"prompt": f"{system}\n{user}\nJSON:"})
                try:
                    await asyncio.wait_for(done.wait(), timeout=self.timeout)
                except asyncio.TimeoutError:
                    pass
                await session.destroy()
                await self._client.stop()
                return content_holder["text"]

            response = self._run_async(run_session())
            logger.info("Copilot generate (async client) completed in %.2fs", time.perf_counter() - start)
            return str(response or "")

        session = None
        if hasattr(self._client, "create_session"):
            try:
                session = self._client.create_session(model=resolved_model, streaming=False)
            except TypeError:
                session = self._client.create_session({"model": resolved_model, "streaming": False})

        if session is not None:
            if hasattr(session, "send_and_wait"):
                response = session.send_and_wait({"prompt": f"{system}\n{user}\nJSON:"})
                return str(response or "")
            if hasattr(session, "send") and hasattr(session, "wait"):
                session.send({"prompt": f"{system}\n{user}\nJSON:"})
                response = session.wait(timeout=self.timeout)
                return str(response or "")

        if hasattr(self._client, "complete"):
            response = self._client.complete(
                {
                    "model": resolved_model,
                    "prompt": f"{system}\n{user}\nJSON:",
                }
            )
            return str(response or "")

        raise RuntimeError("Unsupported Copilot client interface")


def build_fix_prompt(file_path: str, issue: Dict[str, Any], content: str) -> tuple[str, str]:
    system = (
        "You are a code-fixing assistant. "
        "You are given a single pylint issue and a file. "
        "Return JSON only with a single key: updated_file. "
        "The updated_file value must be the full updated file content. "
        "Do not include markdown or explanations. "
        "Only fix the specified issue; avoid unrelated changes."
    )

    issue_payload = json.dumps(issue, indent=2, sort_keys=True)
    user = (
        f"File path: {file_path}\n"
        f"Pylint issue JSON:\n{issue_payload}\n\n"
        "Current file contents:\n"
        f"{content}\n"
    )
    return system, user


def extract_updated_file(response: str) -> Optional[str]:
    if not response:
        return None

    try:
        parsed = json.loads(response)
        if isinstance(parsed, dict) and "updated_file" in parsed:
            return str(parsed["updated_file"])
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", response, flags=re.DOTALL)
    if not match:
        return None

    try:
        parsed = json.loads(match.group(0))
        if isinstance(parsed, dict) and "updated_file" in parsed:
            return str(parsed["updated_file"])
    except json.JSONDecodeError:
        return None

    return None
