import os
import pytest
from wizard_fight.backends import copilot_backend


class DummyClient:
    class models:
        @staticmethod
        def list():
            # Provide a minimal list-like iterable of model metadata
            class M:
                def __init__(self, name, premium=False):
                    self.name = name
                    self.premium = premium

            return [M("raptor-mini", False), M("big-premium", True)]


def test_select_default_model(monkeypatch):
    cg = copilot_backend.CopilotGenerator()

    # Patch to use dummy client
    monkeypatch.setattr(copilot_backend, "DEFAULT_MODEL", "raptor-mini")
    monkeypatch.setattr(copilot_backend.CopilotGenerator, "_ensure_client", lambda self: setattr(self, "_client", DummyClient()))

    model = cg._select_model()
    assert model == "raptor-mini"


def test_refuse_premium_if_not_allowed(monkeypatch):
    cg = copilot_backend.CopilotGenerator(model="big-premium")
    monkeypatch.setattr(copilot_backend.CopilotGenerator, "_ensure_client", lambda self: setattr(self, "_client", DummyClient()))

    # Default allow_premium is false
    model = cg._select_model()
    assert model != "big-premium"


def test_allow_premium_if_flagged(monkeypatch):
    cg = copilot_backend.CopilotGenerator(model="big-premium")
    cg.allow_premium = True
    monkeypatch.setattr(copilot_backend.CopilotGenerator, "_ensure_client", lambda self: setattr(self, "_client", DummyClient()))

    model = cg._select_model()
    # With allow_premium True, requested model preserved
    assert model == "big-premium" or model == "big-premium"
