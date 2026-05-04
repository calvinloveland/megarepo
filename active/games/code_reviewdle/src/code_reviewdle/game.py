"""Core game rules for Code Reviewdle."""

from __future__ import annotations

from typing import Any

from .content import Puzzle

MAX_GUESSES = 6
NEAR_LINE_DISTANCE = 1


def build_empty_progress() -> dict[str, Any]:
    return {
        "guesses": [],
        "solved": False,
        "wrong_guesses": 0,
        "unlocked_hints": 0,
    }


def is_over(progress: dict[str, Any]) -> bool:
    return bool(progress.get("solved")) or len(progress.get("guesses", [])) >= MAX_GUESSES


def feedback_for_guess(puzzle: Puzzle, line_number: int, issue_type: str) -> dict[str, Any]:
    line_distance = abs(line_number - puzzle.answer_line)
    if line_distance == 0:
        line_status = "correct"
    elif line_distance <= NEAR_LINE_DISTANCE:
        line_status = "near"
    else:
        line_status = "wrong"

    issue_status = "correct" if issue_type == puzzle.issue_type else "wrong"
    solved = line_status == "correct" and issue_status == "correct"

    return {
        "line_number": line_number,
        "issue_type": issue_type,
        "line_status": line_status,
        "issue_status": issue_status,
        "solved": solved,
    }


def apply_guess(progress: dict[str, Any], puzzle: Puzzle, line_number: int, issue_type: str) -> dict[str, Any]:
    updated_progress = {
        "guesses": list(progress.get("guesses", [])),
        "solved": bool(progress.get("solved")),
        "wrong_guesses": int(progress.get("wrong_guesses", 0)),
        "unlocked_hints": int(progress.get("unlocked_hints", 0)),
    }
    guess_feedback = feedback_for_guess(puzzle, line_number, issue_type)
    updated_progress["guesses"].append(guess_feedback)

    if guess_feedback["solved"]:
        updated_progress["solved"] = True
    else:
        updated_progress["wrong_guesses"] += 1
        updated_progress["unlocked_hints"] = min(
            updated_progress["wrong_guesses"],
            len(puzzle.hints),
        )

    return updated_progress


def guesses_remaining(progress: dict[str, Any]) -> int:
    return max(0, MAX_GUESSES - len(progress.get("guesses", [])))
