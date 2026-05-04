from __future__ import annotations

import json
from base64 import b64encode
from datetime import date
from html import unescape

import pytest

from code_reviewdle.app import ADDRESSED_DIR, FEEDBACK_DIR, create_app
from code_reviewdle.content import available_issue_types, puzzle_for_day
from code_reviewdle.game import (
    apply_guess,
    build_empty_progress,
    build_share_text,
    selectable_issue_types,
    selectable_line_numbers,
)


@pytest.fixture()
def client():
    app = create_app()
    app.config.update(TESTING=True, SECRET_KEY="test-secret")

    with app.test_client() as test_client:
        yield test_client


@pytest.fixture()
def play_date() -> date:
    return date(2026, 5, 4)


def _auth_headers(username: str, password: str) -> dict[str, str]:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def _wrong_issue_type(correct_issue_type: str) -> str:
    return next(
        issue
        for issue in ["Security check bypass", "Reentrancy", "Numeric overflow / underflow"]
        if issue != correct_issue_type
    )


def test_index_renders_selected_daily_puzzle(client, play_date: date) -> None:
    response = client.get(f"/?day={play_date.isoformat()}")

    puzzle = puzzle_for_day(play_date)
    page = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Code Reviewdle" in page
    assert puzzle.title in page
    assert puzzle.language in page
    assert "Send Feedback" in page
    assert "Selectable lines:" in page


def test_wrong_guess_narrows_selectable_lines_and_issue_types(play_date: date) -> None:
    puzzle = puzzle_for_day(play_date)
    issue_types = available_issue_types()
    initial_progress = build_empty_progress()

    progress_after_wrong_guess = apply_guess(
        initial_progress,
        puzzle,
        line_number=1,
        issue_type=_wrong_issue_type(puzzle.issue_type),
    )

    assert len(selectable_line_numbers(puzzle, progress_after_wrong_guess)) < len(
        selectable_line_numbers(puzzle, initial_progress)
    )
    assert len(selectable_issue_types(puzzle, issue_types, progress_after_wrong_guess)) < len(
        selectable_issue_types(puzzle, issue_types, initial_progress)
    )


def test_correct_guess_solves_round_and_reveals_explanation_and_share_text(
    client, play_date: date
) -> None:
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
    assert "Share your result" in page
    assert f"Code Reviewdle {play_date.isoformat()} 1/6" in page
    assert f"Try it: http://localhost/?day={play_date.isoformat()}" in page


def test_round_ends_after_six_wrong_guesses(client, play_date: date) -> None:
    puzzle = puzzle_for_day(play_date)

    response = None
    simulated_progress = build_empty_progress()
    for _ in range(6):
        wrong_line = next(
            line_number
            for line_number in selectable_line_numbers(puzzle, simulated_progress)
            if line_number != puzzle.answer_line
        )
        guessed_issue_type = next(
            (
                issue_type
                for issue_type in selectable_issue_types(
                    puzzle,
                    available_issue_types(),
                    simulated_progress,
                )
                if issue_type != puzzle.issue_type
            ),
            puzzle.issue_type,
        )
        response = client.post(
            "/guess",
            data={
                "day": play_date.isoformat(),
                "line_number": str(wrong_line),
                "issue_type": guessed_issue_type,
            },
        )
        simulated_progress = apply_guess(
            simulated_progress,
            puzzle,
            wrong_line,
            guessed_issue_type,
        )

    assert response is not None
    page = unescape(response.get_data(as_text=True))

    assert "Round over." in page
    assert puzzle.explanation in page
    assert puzzle.issue_type in page
    assert f"Code Reviewdle {play_date.isoformat()} X/6" in page


def test_build_share_text_formats_guess_rows(play_date: date) -> None:
    puzzle = puzzle_for_day(play_date)
    progress = build_empty_progress()
    progress = apply_guess(progress, puzzle, 1, _wrong_issue_type(puzzle.issue_type))
    progress = apply_guess(progress, puzzle, puzzle.answer_line, puzzle.issue_type)

    share_text = build_share_text(
        play_date.isoformat(),
        progress,
        f"https://codereviewdle.shsw.dev/?day={play_date.isoformat()}",
    )

    assert share_text.startswith(f"Code Reviewdle {play_date.isoformat()} 2/6")
    assert "⬛⬛" in share_text
    assert "🟩🟩" in share_text
    assert share_text.endswith(f"https://codereviewdle.shsw.dev/?day={play_date.isoformat()}")


def test_feedback_submission_creates_file(client) -> None:
    response = client.post(
        "/feedback",
        json={
            "feedback_text": "The line picker feels good.",
            "design": "code-reviewdle",
            "page_path": "/",
            "page_title": "Code Reviewdle",
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload is not None
    feedback_id = payload["id"]
    path = FEEDBACK_DIR / f"feedback_{feedback_id}.json"
    assert path.exists()

    with open(path, encoding="utf-8") as file_handle:
        data = json.load(file_handle)

    assert data["feedback_text"] == "The line picker feels good."
    assert data["app"] == "Code Reviewdle"
    path.unlink(missing_ok=True)


def test_feedback_list_requires_admin_auth(client, monkeypatch) -> None:
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    response = client.post(
        "/feedback",
        json={"feedback_text": "Needs a practice mode."},
        content_type="application/json",
    )
    feedback_id = response.get_json()["id"]

    unauthorized = client.get("/feedback")
    assert unauthorized.status_code == 401

    authorized = client.get("/feedback", headers=_auth_headers("admin", "secret"))
    assert authorized.status_code == 200
    payload = authorized.get_json()
    assert payload is not None
    open_ids = {entry["id"] for entry in payload["open"]}
    assert feedback_id in open_ids

    (FEEDBACK_DIR / f"feedback_{feedback_id}.json").unlink(missing_ok=True)
    (ADDRESSED_DIR / f"feedback_{feedback_id}.json").unlink(missing_ok=True)
