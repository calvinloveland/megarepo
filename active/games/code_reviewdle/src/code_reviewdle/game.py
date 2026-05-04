"""Core game rules for Code Reviewdle."""

from __future__ import annotations

import math
from typing import Any

from .content import Puzzle

MAX_GUESSES = 6
NEAR_LINE_DISTANCE = 1
LINE_POOL_FRACTIONS = (1.0, 0.6, 0.4, 0.25, 0.16, 0.08, 0.04)
ISSUE_POOL_FRACTIONS = (1.0, 0.6, 0.4, 0.25, 0.16, 0.08, 0.04)
LINE_STATUS_EMOJI = {
    "correct": "🟩",
    "near": "🟨",
    "wrong": "⬛",
}
ISSUE_STATUS_EMOJI = {
    "correct": "🟩",
    "wrong": "⬛",
}


def build_empty_progress() -> dict[str, Any]:
    return {
        "guesses": [],
        "solved": False,
        "wrong_guesses": 0,
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


def apply_guess(
    progress: dict[str, Any],
    puzzle: Puzzle,
    line_number: int,
    issue_type: str,
) -> dict[str, Any]:
    updated_progress = {
        "guesses": list(progress.get("guesses", [])),
        "solved": bool(progress.get("solved")),
        "wrong_guesses": int(progress.get("wrong_guesses", 0)),
    }
    guess_feedback = feedback_for_guess(puzzle, line_number, issue_type)
    updated_progress["guesses"].append(guess_feedback)

    if guess_feedback["solved"]:
        updated_progress["solved"] = True
    else:
        updated_progress["wrong_guesses"] += 1

    return updated_progress


def guesses_remaining(progress: dict[str, Any]) -> int:
    return max(0, MAX_GUESSES - len(progress.get("guesses", [])))


def selectable_line_numbers(puzzle: Puzzle, progress: dict[str, Any]) -> tuple[int, ...]:
    if is_over(progress):
        return tuple(range(1, puzzle.code_line_count + 1))

    target_count = _target_pool_size(
        puzzle.code_line_count,
        int(progress.get("wrong_guesses", 0)),
        LINE_POOL_FRACTIONS,
    )
    return _centered_numeric_window(
        total_count=puzzle.code_line_count,
        answer_index=puzzle.answer_line - 1,
        target_count=target_count,
    )


def selectable_issue_types(
    puzzle: Puzzle,
    issue_types: tuple[str, ...],
    progress: dict[str, Any],
) -> tuple[str, ...]:
    if is_over(progress):
        return issue_types

    target_count = _target_pool_size(
        len(issue_types),
        int(progress.get("wrong_guesses", 0)),
        ISSUE_POOL_FRACTIONS,
    )
    answer_index = issue_types.index(puzzle.issue_type)
    start_index, end_index = _centered_window_bounds(
        total_count=len(issue_types),
        answer_index=answer_index,
        target_count=target_count,
    )
    return issue_types[start_index:end_index]


def build_share_text(
    play_date: str,
    progress: dict[str, Any],
    puzzle_url: str,
) -> str:
    result_token = str(len(progress.get("guesses", []))) if progress.get("solved") else "X"
    rows = [
        f"{LINE_STATUS_EMOJI[guess['line_status']]}{ISSUE_STATUS_EMOJI[guess['issue_status']]}"
        for guess in progress.get("guesses", [])
    ]
    share_lines = [f"Code Reviewdle {play_date} {result_token}/{MAX_GUESSES}"]
    share_lines.extend(rows)
    share_lines.extend(["", f"Try it: {puzzle_url}"])
    return "\n".join(share_lines)


def _target_pool_size(
    total_count: int,
    wrong_guesses: int,
    fractions: tuple[float, ...],
) -> int:
    fraction = fractions[min(wrong_guesses, len(fractions) - 1)]
    return max(1, min(total_count, math.ceil(total_count * fraction)))


def _centered_numeric_window(
    *,
    total_count: int,
    answer_index: int,
    target_count: int,
) -> tuple[int, ...]:
    start_index, end_index = _centered_window_bounds(
        total_count=total_count,
        answer_index=answer_index,
        target_count=target_count,
    )
    return tuple(range(start_index + 1, end_index + 1))


def _centered_window_bounds(
    *,
    total_count: int,
    answer_index: int,
    target_count: int,
) -> tuple[int, int]:
    if target_count >= total_count:
        return 0, total_count

    start_index = max(0, answer_index - (target_count // 2))
    end_index = start_index + target_count
    if end_index > total_count:
        end_index = total_count
        start_index = end_index - target_count
    return start_index, end_index
