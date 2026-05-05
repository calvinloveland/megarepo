"""Core game rules for Code Reviewdle."""

from __future__ import annotations

import math
from typing import Any

from .content import Puzzle, issue_catalog, issue_categories, issue_type_to_category

MAX_GUESSES = 6
NEAR_LINE_DISTANCE = 1
LINE_POOL_FRACTIONS = (1.0, 0.72, 0.56, 0.42, 0.3, 0.18, 0.08)
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
        "eliminated_issue_categories": [],
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
        "eliminated_issue_categories": list(progress.get("eliminated_issue_categories", [])),
    }
    guess_feedback = feedback_for_guess(puzzle, line_number, issue_type)
    updated_progress["guesses"].append(guess_feedback)

    if guess_feedback["solved"]:
        updated_progress["solved"] = True
    else:
        updated_progress["wrong_guesses"] += 1
        updated_progress["eliminated_issue_categories"] = _updated_eliminated_categories(
            puzzle,
            issue_type,
            updated_progress["eliminated_issue_categories"],
        )

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


def selectable_issue_categories(puzzle: Puzzle, progress: dict[str, Any]) -> tuple[str, ...]:
    if is_over(progress):
        return issue_categories()

    eliminated_categories = set(progress.get("eliminated_issue_categories", []))
    return tuple(
        category_name
        for category_name in issue_categories()
        if category_name not in eliminated_categories
    )


def selectable_issue_types(
    puzzle: Puzzle,
    issue_types: tuple[str, ...],
    progress: dict[str, Any],
) -> tuple[str, ...]:
    if is_over(progress):
        return issue_types

    allowed_categories = set(selectable_issue_categories(puzzle, progress))
    type_to_category = issue_type_to_category()
    return tuple(
        issue_type for issue_type in issue_types if type_to_category[issue_type] in allowed_categories
    )


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


def _updated_eliminated_categories(
    puzzle: Puzzle,
    guessed_issue_type: str,
    existing_eliminated_categories: list[str],
) -> list[str]:
    eliminated_categories = list(existing_eliminated_categories)
    allowed_categories = [
        category_name
        for category_name in issue_categories()
        if category_name != puzzle.issue_category and category_name not in eliminated_categories
    ]
    if not allowed_categories:
        return eliminated_categories

    guessed_category = issue_type_to_category()[guessed_issue_type]
    if guessed_category != puzzle.issue_category and guessed_category not in eliminated_categories:
        eliminated_categories.append(guessed_category)
        return eliminated_categories

    fallback_category = allowed_categories[0]
    if fallback_category not in eliminated_categories:
        eliminated_categories.append(fallback_category)
    return eliminated_categories


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
