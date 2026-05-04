from __future__ import annotations

from datetime import date
from html import unescape

import pytest

from code_reviewdle.app import create_app
from code_reviewdle.content import puzzle_for_day


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(TESTING=True, SECRET_KEY="test-secret")

    with app.test_client() as test_client:
        yield test_client


@pytest.fixture()
def play_date() -> date:
    return date(2026, 5, 4)


def test_index_renders_selected_daily_puzzle(client, play_date: date) -> None:
    response = client.get(f"/?day={play_date.isoformat()}")

    puzzle = puzzle_for_day(play_date)
    page = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Code Reviewdle" in page
    assert puzzle.title in page
    assert puzzle.language in page


def test_wrong_guess_unlocks_first_hint(client, play_date: date) -> None:
    puzzle = puzzle_for_day(play_date)
    response = client.post(
        "/guess",
        data={
            "day": play_date.isoformat(),
            "line_number": "1",
            "issue_type": next(issue for issue in ["Security check bypass", "Reentrancy", "Numeric overflow / underflow"] if issue != puzzle.issue_type),
        },
    )

    page = response.get_data(as_text=True)

    assert response.status_code == 200
    assert puzzle.hints[0] in page
    assert "status-wrong" in page


def test_correct_guess_solves_round_and_reveals_explanation(client, play_date: date) -> None:
    puzzle = puzzle_for_day(play_date)
    response = client.post(
        "/guess",
        data={
            "day": play_date.isoformat(),
            "line_number": str(puzzle.answer_line),
            "issue_type": puzzle.issue_type,
        },
    )

    page = unescape(response.get_data(as_text=True))

    assert response.status_code == 200
    assert "Solved." in page
    assert puzzle.explanation in page
    assert f"Correct line:</strong> {puzzle.answer_line}" in page


def test_round_ends_after_six_wrong_guesses(client, play_date: date) -> None:
    puzzle = puzzle_for_day(play_date)
    wrong_issue = next(
        issue
        for issue in ["Security check bypass", "Reentrancy", "Numeric overflow / underflow"]
        if issue != puzzle.issue_type
    )

    response = None
    for _ in range(6):
        response = client.post(
            "/guess",
            data={
                "day": play_date.isoformat(),
                "line_number": "1",
                "issue_type": wrong_issue,
            },
        )

    assert response is not None
    page = unescape(response.get_data(as_text=True))

    assert "Round over." in page
    assert puzzle.explanation in page
    assert puzzle.issue_type in page
