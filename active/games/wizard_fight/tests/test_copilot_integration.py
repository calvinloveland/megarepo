"""Integration tests for Copilot backend with optional local CLI server."""

import asyncio
import importlib
import os
import socket
import pytest

from wizard_fight.backends.copilot_backend import CopilotGenerator


def _can_connect(host: str, port: int, timeout: float = 1.0) -> bool:
    """Return True when TCP connection can be established."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


FORCE_COPILOT_TEST = os.getenv("WIZARD_FIGHT_FORCE_COPILOT_TEST", "").lower() in (
    "1",
    "true",
    "yes",
)
SHOULD_SKIP = (not FORCE_COPILOT_TEST) and (not _can_connect("localhost", 4321))


@pytest.mark.integration
@pytest.mark.skipif(SHOULD_SKIP, reason="Copilot CLI server not reachable on localhost:4321")
def test_copilot_integration_generate_and_model_enforcement(monkeypatch):
    """Use live Copilot server to verify model selection and generation behavior."""
    monkeypatch.setenv("WIZARD_FIGHT_COPILOT_CLI_URL", "http://localhost:4321")

    cg = CopilotGenerator(model="raptor-mini")
    _ensure_client_available(cg)
    models = _list_models_safe(cg)
    selected = cg.selected_model()
    assert isinstance(selected, str) and selected, (
        "Selected model should be a non-empty string"
    )
    _assert_non_premium_when_metadata_exists(models, selected)

    # Finally perform a generate; this should return a non-empty string
    out = cg.generate("system: test", "user: say hello", timeout=10)
    assert isinstance(out, str)
    assert out.strip() != "", "Copilot generate returned empty response"


def _ensure_client_available(generator: CopilotGenerator) -> None:
    """Initialize client or skip if Copilot SDK is unavailable."""
    generator.ensure_client()
    if generator.client is not None:
        return
    try:
        copilot_client = importlib.import_module("copilot").CopilotClient
    except ModuleNotFoundError:
        pytest.skip("Copilot SDK not importable and client initialization failed")
    generator.client = copilot_client({"cli_url": "http://localhost:4321"})


def _list_models_safe(generator: CopilotGenerator):
    """Best-effort model listing compatible with sync and async clients."""
    if not hasattr(generator.client, "list_models"):
        return None
    try:
        models = generator.client.list_models()
        if callable(models):
            models = models()
        if asyncio.iscoroutine(models):
            models = asyncio.run(models)
        return models
    except (AttributeError, RuntimeError, TypeError, ValueError):
        return None


def _assert_non_premium_when_metadata_exists(models, selected: str) -> None:
    """Assert selected model is non-premium when billing metadata is present."""
    if not models:
        return
    meta = next(
        (
            item
            for item in models
            if (item.get("id") if isinstance(item, dict) else None) == selected
        ),
        None,
    )
    if not isinstance(meta, dict):
        return
    billing = meta.get("billing")
    if not isinstance(billing, dict):
        return
    assert not bool(billing.get("is_premium")), "Selected model should not be premium by default"
