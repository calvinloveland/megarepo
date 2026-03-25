"""Tests for the Full Auto CI dashboard."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from base64 import b64encode
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import src.dashboard as dashboard_module
from src.dashboard import __main__ as dashboard_main
from src.dashboard import create_app
from src.db import DataAccess


def _run_git(repo_dir: str, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_dir,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _create_test_repository(tmp_dir: str) -> tuple[str, str, str]:
    repo_dir = os.path.join(tmp_dir, "tracked-repo")
    os.makedirs(repo_dir, exist_ok=True)
    _run_git(repo_dir, "init")
    _run_git(repo_dir, "config", "user.name", "Dev Bot")
    _run_git(repo_dir, "config", "user.email", "dev@example.com")
    _run_git(repo_dir, "checkout", "-b", "main")

    app_file = Path(repo_dir) / "app.py"
    app_file.write_text(
        "def greet(name):\n"
        "    return f'hello {name}'\n",
        encoding="utf-8",
    )
    _run_git(repo_dir, "add", "app.py")
    _run_git(repo_dir, "commit", "-m", "Initial commit")
    first_hash = _run_git(repo_dir, "rev-parse", "HEAD")

    app_file.write_text(
        "def greet(name):\n"
        "    if not name:\n"
        "        return 'hello stranger'\n"
        "    return f'hello {name}'\n"
        "\n"
        "\n"
        "def farewell(name):\n"
        "    return f'bye {name}'\n",
        encoding="utf-8",
    )
    _run_git(repo_dir, "add", "app.py")
    _run_git(repo_dir, "commit", "-m", "Currently scanning")
    second_hash = _run_git(repo_dir, "rev-parse", "HEAD")
    return repo_dir, first_hash, second_hash


def _auth_headers(username: str, password: str) -> dict[str, str]:
    token = b64encode(f"{username}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


@pytest.fixture(name="dashboard_app")
def _dashboard_app_fixture(monkeypatch):
    """Build a seeded dashboard app backed by a temporary sqlite database."""
    monkeypatch.setenv("FULL_AUTO_CI_DOGFOOD", "0")
    monkeypatch.setenv("FEEDBACK_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("FEEDBACK_ADMIN_PASSWORD", "secret")
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = os.path.join(tmp_dir, "test.sqlite")
        feedback_dir = Path(tmp_dir) / "data" / "feedback"
        addressed_dir = feedback_dir / "addressed"
        data = DataAccess(db_path)
        data.initialize_schema()
        repo_dir, first_hash, second_hash = _create_test_repository(tmp_dir)

        repo_id = data.create_repository("Demo", "https://example.com/demo.git", "main")
        timestamp = int(time.time())
        run_id = data.create_test_run(repo_id, first_hash, "completed", timestamp)
        data.update_test_run(run_id, status="completed", completed_at=timestamp)

        commit_id = data.create_commit(
            repo_id,
            first_hash,
            author="Dev Bot",
            message="Initial commit",
            timestamp=timestamp,
        )
        data.insert_result(
            commit_id,
            tool="pylint",
            status="success",
            output="{}",
            duration=1.2,
        )
        data.insert_result(
            commit_id,
            tool="pytest",
            status="success",
            output=json.dumps(
                {
                    "status": "success",
                    "summary": "2 passed in 0.04s",
                    "counts": [
                        {"label": "passed", "count": 2},
                    ],
                    "collected": 2,
                    "duration": 0.04,
                    "raw_output": "collected 2 items\n\n== 2 passed in 0.04s ==",
                }
            ),
            duration=0.04,
        )
        data.insert_result(
            commit_id,
            tool="coverage",
            status="error",
            output=json.dumps(
                {
                    "status": "error",
                    "error": "coverage failed before report generation",
                    "raw_output": "coverage: command not found",
                    "duration": 0.12,
                }
            ),
            duration=0.12,
        )

        running_timestamp = timestamp + 30
        running_run_id = data.create_test_run(
            repo_id, second_hash, "running", running_timestamp
        )
        data.update_test_run(
            running_run_id,
            status="running",
            started_at=running_timestamp,
        )
        running_commit_id = data.create_commit(
            repo_id,
            second_hash,
            author="Build Bot",
            message="Currently scanning",
            timestamp=running_timestamp,
        )
        data.insert_result(
            running_commit_id,
            tool="pylint",
            status="success",
            output=json.dumps({"status": "success", "score": 9.8, "duration": 1.6}),
            duration=1.6,
        )

        app = create_app(
            db_path=db_path,
            feedback_dir=feedback_dir,
            addressed_dir=addressed_dir,
        )
        app.config.update(TESTING=True)
        app.config["CI_SERVICE"].git_tracker.repos[repo_id] = SimpleNamespace(
            repo_path=repo_dir
        )
        yield app


@pytest.fixture(name="client")
def _client_fixture(dashboard_app):
    """Return a Flask test client for dashboard route assertions."""
    return dashboard_app.test_client()


def test_index_lists_repositories(client):
    """Index route should render repository cards and heading text."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"Demo" in response.data
    assert b"Repositories" in response.data
    assert b'id="feedback-tool"' in response.data


def test_repository_detail(client):
    """Repository detail page should include progress bars and an SVG chart."""
    # repository id is 1 because DataAccess autoincrements starting at 1
    response = client.get("/repo/1")
    assert response.status_code == 200
    body = response.data.decode()
    assert "Demo" in body
    assert "Initial commit" in body
    assert "Currently scanning" in body
    assert "pylint" in body
    assert "pytest" in body
    assert "2 passed" in body
    assert "coverage failed before report generation" in body
    assert "1 of 4 tools complete" in body
    assert "Estimated total" in body
    assert 'class="trend-chart"' in body
    assert 'class="loc-chart"' in body
    assert "LOC Change Over Time" in body
    assert "chart.umd.min.js" not in body


def test_repositories_partial(client):
    """Repository partial should return the overview cards markup."""
    response = client.get("/partials/repositories")
    assert response.status_code == 200
    body = response.data.decode()
    assert "Demo" in body
    assert "status-card" in body


def test_repository_insights_partial(client):
    """Insights partial should render progress bars and the SVG trend chart."""
    response = client.get("/repo/1/insights")
    assert response.status_code == 200
    body = response.data.decode()
    assert "Recent Test Runs" in body
    assert "Initial commit" in body
    assert "Currently scanning" in body
    assert "2 passed" in body
    assert "coverage failed before report generation" in body
    assert "Historical Trend" in body
    assert "LOC Change Over Time" in body
    assert "Commit Comparison" in body
    assert "1 of 4 tools complete" in body
    assert 'class="trend-chart"' in body
    assert 'class="loc-chart"' in body


def test_feedback_submission_and_listing(dashboard_app, client):
    """Dashboard should save feedback through the shared feedback tool."""
    feedback_dir = dashboard_app.config["FEEDBACK_DIR"]
    response = client.post(
        "/feedback",
        json={
            "feedback_text": "Please make queue visibility clearer.",
            "selected_element": "main > section.section",
            "page_path": "/repo/1",
            "page_title": "Full Auto CI",
            "design": "full-auto-ci-dashboard",
            "timestamp": "2026-03-25T23:00:00.000Z",
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "success"

    feedback_file = feedback_dir / f"feedback_{payload['id']}.json"
    assert feedback_file.exists()
    with open(feedback_file, encoding="utf-8") as handle:
        saved_feedback = json.load(handle)
    assert saved_feedback["app"] == "Full Auto CI Dashboard"
    assert saved_feedback["page_path"] == "/repo/1"
    assert saved_feedback["selected_element"] == "main > section.section"

    list_response = client.get("/feedback", headers=_auth_headers("admin", "secret"))
    assert list_response.status_code == 200
    listed = list_response.get_json()
    assert any(entry["id"] == payload["id"] for entry in listed["open"])


def test_build_loc_change_chart_uses_git_numstat(tmp_path):
    """LOC chart data should reflect git numstat output from the tracked repo."""
    repo_dir, first_hash, second_hash = _create_test_repository(str(tmp_path))
    runs = [
        {
            "id": 1,
            "commit_hash": first_hash,
            "commit": {"hash": first_hash},
            "created_at": 1,
            "status": "completed",
        },
        {
            "id": 2,
            "commit_hash": second_hash,
            "commit": {"hash": second_hash},
            "created_at": 2,
            "status": "running",
        },
    ]

    points = dashboard_module._build_loc_change_points(repo_dir, runs)
    assert [point["label"] for point in points] == [first_hash[:7], second_hash[:7]]
    assert points[0]["added"] == 2
    assert points[0]["deleted"] == 0
    assert points[0]["net"] == 2
    assert points[1]["added"] == 6
    assert points[1]["deleted"] == 0
    assert points[1]["net"] == 6


def test_dashboard_main_runs(monkeypatch):
    """Dashboard module main() should start Flask with configured values."""
    monkeypatch.setenv("FULL_AUTO_CI_DOGFOOD", "0")

    mock_app = MagicMock()
    mock_service = MagicMock()
    mock_service.config.get.return_value = {
        "host": "0.0.0.0",
        "port": 9100,
        "debug": True,
    }
    mock_app.config = {"CI_SERVICE": mock_service}

    monkeypatch.setattr(dashboard_main, "create_app", lambda: mock_app)

    dashboard_main.main()

    mock_app.run.assert_called_once_with(host="0.0.0.0", port=9100, debug=True)
