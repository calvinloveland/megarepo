import pytest

from wizard_fight.backends.copilot_backend import CopilotGenerator


class DummySession:
    def __init__(self, content):
        self._content = content

    def send_and_wait(self, payload):
        return {"data": self._content}

    def stop(self):
        pass


class DummyClient:
    def create_session(self, model=None, streaming=False):
        return DummySession("{\"generated_text\": \"{\\\"name\\\": \\\"Test\\\", \\\"description\\\": \\\"A test\\\"}\"}")


def test_generate_with_dummy_client(monkeypatch):
    cg = CopilotGenerator()
    # Patch client
    monkeypatch.setattr(cg, "_client", DummyClient())

    text = cg.generate("system prompt", "user prompt")
    assert "generated_text" in text or "Test" in text
