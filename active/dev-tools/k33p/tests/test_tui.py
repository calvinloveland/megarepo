"""Smoke tests for the TUI.

These run the TUI in headless mode (no real terminal) and verify that
each panel renders without raising. The Textual test harness can drive
an app and check that the widgets produce text.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from k33p.project import load_project
from k33p.tui.app import DetailPanel, K33pApp, ProjectTree

# Textual's testing utilities
pytest.importorskip("textual")


EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


def _panel_text(panel: DetailPanel) -> str:
    """Extract the rendered text from a DetailPanel."""
    rendered = panel.render()
    return str(rendered) if rendered is not None else ""


@pytest.mark.asyncio
async def test_tui_loads_megarepo() -> None:
    """The TUI should load a megarepo project and render the overview."""
    project = load_project(EXAMPLES / "megarepo")
    app = K33pApp(project)
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        main = app.query_one("#main", DetailPanel)
        text = _panel_text(main)
        assert "megarepo" in text
        assert "Channels" in text or "channels" in text


@pytest.mark.asyncio
async def test_tui_loads_single_project() -> None:
    """The TUI should load a single-project example."""
    project = load_project(EXAMPLES / "coolproject")
    app = K33pApp(project)
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        main = app.query_one("#main", DetailPanel)
        text = _panel_text(main)
        assert "coolproject" in text


@pytest.mark.asyncio
async def test_tui_role_switch() -> None:
    """Switching roles should update the sub_title and main panel."""
    project = load_project(EXAMPLES / "coolproject")
    app = K33pApp(project)
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        await pilot.press("3")
        await pilot.pause()
        assert project.active_role == "maintainer"
        sub = app.sub_title if isinstance(app.sub_title, str) else str(app.sub_title)
        assert "maintainer" in sub


@pytest.mark.asyncio
async def test_tui_panel_navigation() -> None:
    """Pressing 'c' should switch to the channels panel."""
    project = load_project(EXAMPLES / "megarepo")
    app = K33pApp(project)
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        await pilot.press("c")
        await pilot.pause()
        main = app.query_one("#main", DetailPanel)
        text = _panel_text(main)
        assert "src" in text
        assert "private" in text or "live" in text


@pytest.mark.asyncio
async def test_tui_subproject_navigation() -> None:
    """Pressing 'n' should cycle through subprojects (monorepo only)."""
    project = load_project(EXAMPLES / "megarepo")
    app = K33pApp(project)
    async with app.run_test(size=(120, 40)) as pilot:
        await pilot.pause()
        assert project.active_subproject is None
        await pilot.press("n")
        await pilot.pause()
        assert project.active_subproject == "powder_play"


def test_project_tree_builds() -> None:
    """The sidebar tree should be constructable without error."""
    project = load_project(EXAMPLES / "megarepo")
    tree = ProjectTree(project)
    assert tree.root is not None
    labels = [str(node.label) for node in tree.root.children]
    assert any("channels" in label for label in labels)
    assert any("subprojects" in label for label in labels)
    assert any("roles" in label for label in labels)

