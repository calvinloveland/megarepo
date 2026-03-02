"""Tests for Copilot generate flow with mocked client/session objects."""

from wizard_fight.backends.copilot_backend import CopilotGenerator


class DummySession:
    """Session mock returning deterministic payload."""

    def __init__(self, content):
        self._content = content

    def send_and_wait(self, _payload):
        """Return static content payload."""
        return {"data": self._content}

    def stop(self):
        """No-op stop method for compatibility."""
        return None


class DummyClient:
    """Client mock exposing create_session API."""

    def create_session(self, _model=None, _streaming=False):
        """Return dummy session instance."""
        return DummySession(
            "{\"generated_text\": \"{\\\"name\\\": \\\"Test\\\", "
            "\\\"description\\\": \\\"A test\\\"}\"}"
        )


def test_generate_with_dummy_client(monkeypatch):
    """Generation should return mocked payload text."""
    cg = CopilotGenerator()
    monkeypatch.setattr(cg, "client", DummyClient())

    text = cg.generate("system prompt", "user prompt")
    assert "generated_text" in text or "Test" in text
