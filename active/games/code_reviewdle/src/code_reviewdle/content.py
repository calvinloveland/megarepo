"""Puzzle loading and issue catalog helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUZZLE_BANK_PATH = PROJECT_ROOT / "data" / "puzzles.json"
MINIMUM_CODE_LINES = 25
ISSUE_CATALOG: dict[str, tuple[str, ...]] = {
    "Security and trust": (
        "Security check bypass",
        "Authorization bypass",
        "Trust boundary violation",
        "Insecure default",
    ),
    "State and ordering": (
        "Reentrancy",
        "Shared mutable state",
        "Initialization order bug",
        "Stale state update",
    ),
    "Numeric correctness": (
        "Numeric overflow / underflow",
        "Precision loss",
        "Off-by-one",
        "Unit conversion bug",
    ),
    "Control flow": (
        "Wrong conditional logic",
        "Premature exit",
        "Unreachable recovery path",
        "Incorrect loop boundary",
    ),
    "API and validation": (
        "Unchecked return value",
        "Incorrect API usage",
        "Missing null handling",
        "Missing bounds validation",
    ),
    "Resources and lifetime": (
        "Resource leak",
        "Double free / double close",
        "Use after free",
        "Dangling reference",
    ),
}


@dataclass(frozen=True)
class Puzzle:
    """Curated puzzle content for a single daily challenge."""

    id: str
    title: str
    language: str
    source_note: str
    summary: str
    code: tuple[str, ...]
    answer_line: int
    issue_category: str
    issue_type: str
    explanation: str
    hints: tuple[str, ...]

    @property
    def code_line_count(self) -> int:
        return len(self.code)


@lru_cache(maxsize=1)
def load_puzzles() -> tuple[Puzzle, ...]:
    raw_items = json.loads(PUZZLE_BANK_PATH.read_text(encoding="utf-8"))
    puzzles = tuple(_build_puzzle(raw_item) for raw_item in raw_items)
    _validate_puzzles(puzzles)
    return puzzles


def _build_puzzle(raw_item: dict[str, object]) -> Puzzle:
    return Puzzle(
        id=str(raw_item["id"]),
        title=str(raw_item["title"]),
        language=str(raw_item["language"]),
        source_note=str(raw_item["source_note"]),
        summary=str(raw_item["summary"]),
        code=tuple(str(line) for line in raw_item["code"]),
        answer_line=int(raw_item["answer_line"]),
        issue_category=str(raw_item["issue_category"]),
        issue_type=str(raw_item["issue_type"]),
        explanation=str(raw_item["explanation"]),
        hints=tuple(str(hint) for hint in raw_item["hints"]),
    )


def _validate_puzzles(puzzles: tuple[Puzzle, ...]) -> None:
    if not puzzles:
        raise ValueError("Puzzle bank must contain at least one puzzle.")

    seen_ids: set[str] = set()
    for puzzle in puzzles:
        if puzzle.id in seen_ids:
            raise ValueError(f"Duplicate puzzle id: {puzzle.id}")
        seen_ids.add(puzzle.id)

        if puzzle.code_line_count < MINIMUM_CODE_LINES:
            raise ValueError(
                f"Puzzle {puzzle.id} must have at least {MINIMUM_CODE_LINES} lines."
            )
        if puzzle.answer_line < 1 or puzzle.answer_line > puzzle.code_line_count:
            raise ValueError(
                f"Puzzle {puzzle.id} answer line {puzzle.answer_line} is out of range."
            )
        if puzzle.issue_category not in ISSUE_CATALOG:
            raise ValueError(
                f"Puzzle {puzzle.id} category {puzzle.issue_category!r} is not in the issue catalog."
            )
        if puzzle.issue_type not in ISSUE_CATALOG[puzzle.issue_category]:
            raise ValueError(
                f"Puzzle {puzzle.id} issue type {puzzle.issue_type!r} is not in category {puzzle.issue_category!r}."
            )
        if not puzzle.issue_type.strip():
            raise ValueError(f"Puzzle {puzzle.id} must declare an issue type.")
        if not puzzle.hints:
            raise ValueError(f"Puzzle {puzzle.id} must include at least one hint.")


def issue_catalog() -> dict[str, tuple[str, ...]]:
    return ISSUE_CATALOG


def issue_categories() -> tuple[str, ...]:
    return tuple(ISSUE_CATALOG.keys())


def issue_type_to_category() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for category_name, issue_types in ISSUE_CATALOG.items():
        for issue_type in issue_types:
            mapping[issue_type] = category_name
    return mapping


def available_issue_types() -> tuple[str, ...]:
    issue_types = [
        issue_type
        for category_name in issue_categories()
        for issue_type in ISSUE_CATALOG[category_name]
    ]
    return tuple(issue_types)


def puzzle_for_day(play_date: date) -> Puzzle:
    puzzles = load_puzzles()
    index = play_date.toordinal() % len(puzzles)
    return puzzles[index]
