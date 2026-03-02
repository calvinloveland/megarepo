"""LLM backend label tests for configuration-driven selection."""

from wizard_fight.llm import llm_backend_label


def test_llm_label_copilot(monkeypatch):
    """Copilot backend should include the configured model in its label."""
    monkeypatch.setenv("WIZARD_FIGHT_SPELL_BACKEND", "copilot")
    monkeypatch.setenv("WIZARD_FIGHT_COPILOT_MODEL", "raptor-mini")
    assert llm_backend_label() == "copilot:raptor-mini"


def test_llm_label_openai(monkeypatch):
    """OpenAI backend label should be prefixed with openai."""
    monkeypatch.delenv("WIZARD_FIGHT_SPELL_BACKEND", raising=False)
    monkeypatch.setenv("WIZARD_FIGHT_LLM_MODE", "openai")
    monkeypatch.setenv("WIZARD_FIGHT_LLM_MODEL", "gpt-4o-mini")
    assert llm_backend_label().startswith("openai:")
