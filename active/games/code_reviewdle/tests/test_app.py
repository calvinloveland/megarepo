from __future__ import annotations

import json
from base64 import b64encode
from datetime import date
from html import unescape

import pytest

from code_reviewdle.app import ADDRESSED_DIR, FEEDBACK_DIR, create_app
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


def _auth_headers(username: str, password: str) -> dict[str, str]:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def test_index_renders_selected_daily_puzzle(client, play_date: date) -> None:
    response = client.get(f"/?day={play_date.isoformat()}")

    puzzle = puzzle_for_day(play_date)
    page = response.get_data(as_text=True)

    assert response.status_code == 200
    assert "Code Reviewdle" in page
    assert puzzle.title in page
    assert puzzle.language in page
    assert "Send Feedback" in page


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
