"""Tests for the project model and view resolution."""

from __future__ import annotations

from pathlib import Path

from k33p.project import load_project

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


def test_load_megarepo() -> None:
    project = load_project(EXAMPLES / "megarepo")
    assert project.name == "megarepo"
    assert project.is_monorepo
    assert project.subproject_names == ["powder_play", "full_auto_ci", "docs"]
    assert project.active_role == "developer"


def test_load_coolproject() -> None:
    project = load_project(EXAMPLES / "coolproject")
    assert project.name == "coolproject"
    assert not project.is_monorepo
    assert project.active_role == "developer"


def test_resolve_view_for_role() -> None:
    project = load_project(EXAMPLES / "coolproject")
    project.set_role("developer")
    view = project.resolve_view()
    assert view.role == "developer"
    assert view.active_view == "developer"
    # src channel should be in the view
    assert "src" in view.channels
    # private should not be in the developer view (not subscribed)
    assert "private" not in view.channels or view.channels.get("private") is not None


def test_resolve_view_with_extends() -> None:
    project = load_project(EXAMPLES / "megarepo")
    project.set_role("developer")
    view = project.resolve_view(subproject="powder_play")
    # deps should be there (developer view includes deps)
    assert "deps" in view.channels
    # private should be there too (powder_play has it)
    assert "private" in view.channels
    # The src mount should reflect the developer view
    assert view.channels["src"].mount == "./"


def test_set_role_unknown_is_ignored() -> None:
    project = load_project(EXAMPLES / "coolproject")
    project.set_role("nonexistent")
    # The role shouldn't change for unknown values
    assert project.active_role == "developer"


def test_set_subproject_unknown_is_ignored() -> None:
    project = load_project(EXAMPLES / "megarepo")
    original = project.active_subproject
    project.set_subproject("nonexistent")
    assert project.active_subproject == original


def test_lock_loaded() -> None:
    project = load_project(EXAMPLES / "megarepo")
    assert project.root_lock is not None
    assert project.root_lock.toolchain is not None
    assert project.root_lock.toolchain.compiler == "rustc 1.79.0"
    assert "src" in project.root_lock.channels
    assert project.root_lock.channels["src"].ref.value == "deadbeef1234567890abcdef"


def test_lock_for_subproject_falls_back_to_root() -> None:
    project = load_project(EXAMPLES / "megarepo")
    # No subproject-specific lock file exists in the example
    # so it should fall back to the root lock
    lock = project.lock_for("powder_play")
    assert lock is not None
    assert lock.toolchain is not None


def test_no_lock_returns_none() -> None:
    project = load_project(EXAMPLES / "coolproject")
    # coolproject example doesn't have a k33p.lock
    assert project.root_lock is None
    assert project.lock_for(None) is None


def test_resolved_channel_view_has_pinned_ref() -> None:
    project = load_project(EXAMPLES / "megarepo")
    view = project.resolve_view()
    # src has a pinned ref in the lock
    assert view.channels["src"].pinned_ref == "deadbeef1234567890abcdef"


def test_set_subproject_for_single_project() -> None:
    project = load_project(EXAMPLES / "coolproject")
    # For single projects, passing the project name is accepted (resets to None)
    project.set_subproject("coolproject")
    # The active subproject stays None for single projects
    assert project.active_subproject is None
