"""Tests for the k33p manifest parser."""

from __future__ import annotations

from pathlib import Path

import pytest

from k33p.channels import ChannelType, HistoryPolicy, ManifestError
from k33p.manifest import (
    Manifest,
    ViewMount,
    discover_manifest,
    parse_manifest,
)

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


# ── single project ─────────────────────────────────────────


def test_parses_coolproject_example() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert manifest.project == "coolproject"
    assert manifest.type == "single"
    assert not manifest.is_monorepo
    assert "src" in manifest.channels
    assert "private" in manifest.channels
    assert "deps" in manifest.channels
    assert "artifacts" in manifest.channels
    assert "live" in manifest.channels
    assert len(manifest.subprojects) == 0


def test_channel_types_parsed() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert manifest.channels["src"].type == ChannelType.SOURCE
    assert manifest.channels["private"].type == ChannelType.SECRETS
    assert manifest.channels["deps"].type == ChannelType.DEPENDENCIES
    assert manifest.channels["artifacts"].type == ChannelType.ARTIFACTS
    assert manifest.channels["live"].type == ChannelType.LIVE


def test_channel_history_parsed() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert manifest.channels["src"].history == HistoryPolicy.FULL
    assert manifest.channels["private"].history == HistoryPolicy.NONE
    assert manifest.channels["deps"].history == HistoryPolicy.LOCKFILE


def test_roles_parsed() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert "developer" in manifest.roles
    assert "maintainer" in manifest.roles
    dev = manifest.roles["developer"]
    assert dev.view == "developer"
    maint = manifest.roles["maintainer"]
    assert "artifacts" in maint.publish


def test_views_parsed_with_extends() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert "default" in manifest.views
    assert "developer" in manifest.views
    assert manifest.views["developer"].extends == "default"
    dev = manifest.views["developer"]
    assert "src" in dev.channels
    assert isinstance(dev.channels["src"], ViewMount)


def test_pointers_parsed_from_live_channel() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert "latest-stable" in manifest.pointers
    p = manifest.pointers["latest-stable"]
    assert p.target.channel == "artifacts"
    assert p.target.value == "v1.2.3"


def test_daemon_parsed() -> None:
    manifest = parse_manifest(EXAMPLES / "coolproject" / "k33p.yaml")
    assert manifest.daemon is not None
    assert manifest.daemon.auto_commit is not None
    ac = manifest.daemon.auto_commit
    assert ac.enabled is True
    assert ac.debounce == "5m"
    assert "src/" in ac.paths


# ── monorepo ───────────────────────────────────────────────


def test_parses_megarepo_example() -> None:
    manifest = parse_manifest(EXAMPLES / "megarepo" / "k33p.yaml")
    assert manifest.project == "megarepo"
    assert manifest.type == "monorepo"
    assert manifest.is_monorepo
    assert len(manifest.subprojects) == 3
    assert "powder_play" in manifest.subprojects
    assert "full_auto_ci" in manifest.subprojects
    assert "docs" in manifest.subprojects


def test_subproject_channels_override_parent() -> None:
    manifest = parse_manifest(EXAMPLES / "megarepo" / "k33p.yaml")
    # private is in the monorepo-wide channels
    assert "private" in manifest.channels
    # but powder_play has its own private with different recipients
    pp = manifest.subprojects["powder_play"]
    assert "private" in pp.channels
    assert pp.channels["private"].recipients == ["games-team@calvinloveland.dev"]


def test_channels_for_subproject_merges_overrides() -> None:
    manifest = parse_manifest(EXAMPLES / "megarepo" / "k33p.yaml")
    # From the monorepo root: src, private, live
    root_channels = manifest.channels_for_subproject(None)
    assert "src" in root_channels
    assert "private" in root_channels
    assert "live" in root_channels
    # No deps/artifacts at the root, but powder_play has them
    assert "deps" not in root_channels

    # From powder_play: parent + scoped overrides
    pp_channels = manifest.channels_for_subproject("powder_play")
    assert "src" in pp_channels  # inherited
    assert "private" in pp_channels  # overridden
    assert "deps" in pp_channels  # new
    assert "artifacts" in pp_channels  # new
    # The overridden private has the subproject's recipients
    assert pp_channels["private"].recipients == ["games-team@calvinloveland.dev"]


def test_per_subproject_daemon() -> None:
    manifest = parse_manifest(EXAMPLES / "megarepo" / "k33p.yaml")
    pp_daemon = manifest.effective_daemon("powder_play")
    assert pp_daemon is not None
    assert pp_daemon.auto_commit is not None
    assert pp_daemon.auto_commit.debounce == "2m"  # subproject override
    # full_auto_ci doesn't override the daemon, so it inherits the parent's
    fac_daemon = manifest.effective_daemon("full_auto_ci")
    assert fac_daemon is not None


# ── error cases ────────────────────────────────────────────


def test_missing_project_field_raises() -> None:
    with pytest.raises(ManifestError, match="project"):
        parse_manifest_text("name: foo\n")


def test_unknown_channel_type_raises() -> None:
    with pytest.raises(ManifestError, match="unknown type"):
        parse_manifest_text(
            "project: foo\n"
            "channels:\n"
            "  src:\n"
            "    type: bogus\n"
            "    transport: x\n"
        )


def test_missing_transport_raises() -> None:
    with pytest.raises(ManifestError, match="transport"):
        parse_manifest_text(
            "project: foo\n"
            "channels:\n"
            "  src:\n"
            "    type: source\n"
        )


def test_subproject_without_path_raises() -> None:
    with pytest.raises(ManifestError, match="path"):
        parse_manifest_text(
            "project: foo\n"
            "type: monorepo\n"
            "subprojects:\n"
            "  bar:\n"
            "    description: no path\n"
        )


# ── helpers ────────────────────────────────────────────────


def parse_manifest_text(yaml_text: str) -> Manifest:
    """Parse a manifest from a YAML string (for error-case tests)."""
    import tempfile

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yaml", delete=False, encoding="utf-8"
    ) as f:
        f.write(yaml_text)
        path = f.name
    try:
        return parse_manifest(path)
    finally:
        Path(path).unlink(missing_ok=True)


def test_discover_manifest_finds_k33p_yaml() -> None:
    """discover_manifest should find k33p.yaml in a project directory."""
    # Test using the megarepo example
    manifest = discover_manifest(EXAMPLES / "megarepo")
    assert manifest.project == "megarepo"


def test_discover_manifest_walks_up() -> None:
    """discover_manifest should find k33p.yaml in a parent directory."""
    # Create a nested path that doesn't exist but whose parent does
    nested = EXAMPLES / "megarepo" / "deeply" / "nested" / "path"
    nested.mkdir(parents=True, exist_ok=True)
    try:
        manifest = discover_manifest(nested)
        assert manifest.project == "megarepo"
    finally:
        # Clean up
        import shutil
        shutil.rmtree(EXAMPLES / "megarepo" / "deeply", ignore_errors=True)
