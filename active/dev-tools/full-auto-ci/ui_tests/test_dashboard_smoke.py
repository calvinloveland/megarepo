"""Playwright-powered smoke tests for the Full Auto CI dashboard."""

from __future__ import annotations

import json
import time

import pytest
from playwright.sync_api import expect


@pytest.mark.only_browser("chromium")
def test_dashboard_shows_empty_state(page, dashboard_server):
    """Verify the empty repositories state renders without errors."""

    page.goto(dashboard_server["base_url"], wait_until="networkidle")
    expect(page.locator("header.app-header h1 a")).to_have_text(
        "Full Auto CI Dashboard"
    )
    page.wait_for_selector("div.empty-state")
    expect(page.locator("div.empty-state")).to_contain_text(
        "No repositories have been added yet"
    )


@pytest.mark.only_browser("chromium")
def test_dashboard_renders_repository_card(
    page, dashboard_server, dashboard_data_access
):
    """Ensure repositories with recent runs surface in the overview."""

    repo_id = dashboard_data_access.create_repository(
        "Example Repo", "https://example.com/repo.git", "main"
    )
    dashboard_data_access.create_test_run(
        repo_id=repo_id,
        commit_hash="abcdef1",
        status="completed",
        created_at=int(time.time()),
    )

    page.goto(dashboard_server["base_url"], wait_until="networkidle")
    card_locator = page.locator(f"article.card[data-repo-id='{repo_id}']")
    card_locator.wait_for()
    expect(card_locator.locator("h3 a")).to_have_text("Example Repo")
    expect(card_locator.locator(".status-pill")).to_contain_text("completed")


@pytest.mark.only_browser("chromium")
def test_repository_detail_handles_coverage_error_without_percentage(
    page, dashboard_server, dashboard_data_access
):
    """Repository detail should render coverage errors that omit percentage."""

    repo_id = dashboard_data_access.create_repository(
        "Example Repo", "https://example.com/repo.git", "main"
    )
    timestamp = int(time.time())
    dashboard_data_access.create_test_run(
        repo_id=repo_id,
        commit_hash="abcdef1",
        status="completed",
        created_at=timestamp,
    )
    commit_id = dashboard_data_access.create_commit(
        repo_id=repo_id,
        commit_hash="abcdef1",
        author="Dev Bot",
        message="Exercise coverage error rendering",
        timestamp=timestamp,
    )
    dashboard_data_access.insert_result(
        commit_id=commit_id,
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

    page.goto(f"{dashboard_server['base_url']}/repo/{repo_id}", wait_until="networkidle")
    expect(page.locator("main")).to_contain_text("Example Repo")
    expect(page.locator("main")).to_contain_text(
        "coverage failed before report generation"
    )
    expect(page.locator("body")).not_to_contain_text("Internal Server Error")
