from __future__ import annotations

from pathlib import Path


SKILL_PATH = Path(__file__).resolve().parents[1] / "SKILL.md"


def test_skill_has_required_frontmatter_and_recommends_existing_extension() -> None:
    text = SKILL_PATH.read_text(encoding="utf-8")
    assert text.startswith("---\nname: pi-subagent-patterns\n")
    assert "description:" in text
    assert "examples/extensions/subagent" in text
    assert "use the existing subagent example extension" in text.lower()


def test_skill_documents_the_recommended_subagent_architecture() -> None:
    text = SKILL_PATH.read_text(encoding="utf-8")
    assert "spawn separate `pi` subprocesses" in text
    assert "JSON mode" in text
    assert "user-level agents" in text
    assert "project-local agents" in text
    assert "single" in text
    assert "parallel" in text
    assert "chain" in text
