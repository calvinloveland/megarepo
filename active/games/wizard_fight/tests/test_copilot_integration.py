import socket
import pytest

from wizard_fight.backends.copilot_backend import CopilotGenerator


def _can_connect(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


@pytest.mark.integration
@pytest.mark.skipif(not _can_connect("localhost", 4321), reason="Copilot CLI server not reachable on localhost:4321")
def test_copilot_integration_generate_and_model_enforcement(monkeypatch):
    # Ensure tests use the local CLI server
    monkeypatch.setenv("WIZARD_FIGHT_COPILOT_CLI_URL", "http://localhost:4321")

    cg = CopilotGenerator(model="raptor-mini")

    # Ensure client is initialized and we can list models
    cg._ensure_client()
    assert cg._client is not None, "Copilot client not initialized"

    # Confirm selected model is non-premium according to the server
    try:
        models = cg._client.list_models() if hasattr(cg._client, "list_models") else None
        if callable(models):
            models = models()
    except Exception:
        models = None

    selected = cg._select_model()
    assert isinstance(selected, str) and selected, "Selected model should be a non-empty string"

    # If model listing available, validate the selected model is non-premium
    if models:
        meta = next((m for m in models if (m.get("id") if isinstance(m, dict) else None) == selected), None)
        if meta and isinstance(meta, dict) and isinstance(meta.get("billing"), dict):
            assert not bool(meta["billing"].get("is_premium")), "Selected model should not be premium by default"

    # Finally perform a generate; this should return a non-empty string
    out = cg.generate("system: test", "user: say hello", timeout=10)
    assert isinstance(out, str)
    assert out.strip() != "", "Copilot generate returned empty response"
