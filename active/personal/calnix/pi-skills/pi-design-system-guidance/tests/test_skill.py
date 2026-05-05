from __future__ import annotations

from pathlib import Path


SKILL_DIR = Path(__file__).resolve().parents[1]
SKILL_PATH = SKILL_DIR / "SKILL.md"
CHECKLIST_PATH = SKILL_DIR / "references" / "checklist.md"


def test_skill_frontmatter_and_prompt_reference() -> None:
    text = SKILL_PATH.read_text(encoding="utf-8")

    assert text.startswith("---\nname: pi-design-system-guidance\n")
    assert "description:" in text
    assert "/design-system-guidance <ui-task>" in text
    assert "Use this skill when you are:" in text
    assert "ab_test_visuals" in text
    assert "references/checklist.md" in text


def test_checklist_covers_design_system_review_basics() -> None:
    text = CHECKLIST_PATH.read_text(encoding="utf-8")

    assert text.startswith("# Design System Guidance Checklist\n")
    assert "shared components" in text
    assert "default, hover, focus, active, disabled, loading, empty, error, and success states" in text
    assert "keyboard navigation" in text
    assert "ab_test_visuals" in text
