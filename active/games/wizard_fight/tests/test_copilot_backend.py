"""Unit tests for model selection behavior in Copilot backend."""

from types import SimpleNamespace

from wizard_fight.backends import copilot_backend


def _dummy_client():
    models = [
        SimpleNamespace(name="raptor-mini", premium=False),
        SimpleNamespace(name="big-premium", premium=True),
    ]
    return SimpleNamespace(models=SimpleNamespace(list=lambda: models))


def test_select_default_model(monkeypatch):
    """Requested default model should remain selected when available."""
    cg = copilot_backend.CopilotGenerator()
    monkeypatch.setattr(copilot_backend, "DEFAULT_MODEL", "raptor-mini")
    monkeypatch.setattr(
        copilot_backend.CopilotGenerator,
        "_ensure_client",
        lambda self: setattr(self, "client", _dummy_client()),
    )

    model = cg.selected_model()
    assert model == "raptor-mini"


def test_refuse_premium_if_not_allowed(monkeypatch):
    """Premium requested model should be rejected without allow flag."""
    cg = copilot_backend.CopilotGenerator(model="big-premium")
    monkeypatch.setattr(
        copilot_backend.CopilotGenerator,
        "_ensure_client",
        lambda self: setattr(self, "client", _dummy_client()),
    )

    model = cg.selected_model()
    assert model != "big-premium"


def test_allow_premium_if_flagged(monkeypatch):
    """Premium requested model should be preserved when allowed."""
    cg = copilot_backend.CopilotGenerator(model="big-premium")
    cg.allow_premium = True
    monkeypatch.setattr(
        copilot_backend.CopilotGenerator,
        "_ensure_client",
        lambda self: setattr(self, "client", _dummy_client()),
    )

    model = cg.selected_model()
    assert model == "big-premium"
