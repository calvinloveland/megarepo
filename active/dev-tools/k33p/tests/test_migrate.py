"""Tests for migration tools — split and convert."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from k33p.migrate import cmd_split


@pytest.fixture
def monorepo() -> Path:
    """Create a monorepo with a couple of subprojects."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "k33p.yaml").write_text("""\
project: test-mono
type: monorepo
channels:
  src:
    type: source
    transport: git+https://example.com/mono
    visibility: public
    history: full
  private:
    type: secrets
    transport: file:///tmp/nonexistent
    scope: monorepo
subprojects:
  sub-a:
    path: packages/a/
    description: Package A
    channels:
      deps:
        type: dependencies
        scope: packages/a/
        transport: file:///tmp/nonexistent-deps
  sub-b:
    path: packages/b/
    description: Package B
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
        # Create subproject directories with some content
        (root / "packages" / "a").mkdir(parents=True)
        (root / "packages" / "a" / "src").mkdir(parents=True)
        (root / "packages" / "a" / "src" / "main.py").write_text("# package a")
        (root / "packages" / "b").mkdir(parents=True)
        (root / "packages" / "b" / "README.md").write_text("# package b")

        # Initialize the store
        (root / ".k33p" / "store").mkdir(parents=True)
        yield root


class TestSplit:
    def test_split_creates_project(self, monorepo: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "split-a"
            rc = cmd_split(str(monorepo), "sub-a", str(target))
            assert rc == 0
            assert target.is_dir()
            assert (target / "k33p.yaml").exists()
            assert (target / ".k33p" / "store").is_dir()

    def test_split_manifest_has_correct_name(self, monorepo: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "split-a"
            cmd_split(str(monorepo), "sub-a", str(target))
            yaml_text = (target / "k33p.yaml").read_text()
            assert "project: sub-a" in yaml_text
            assert "type: single" in yaml_text

    def test_split_inherits_channels(self, monorepo: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "split-a"
            cmd_split(str(monorepo), "sub-a", str(target))
            yaml_text = (target / "k33p.yaml").read_text()
            # Should have src (inherited) and deps (from subproject)
            assert "type: source" in yaml_text
            assert "type: dependencies" in yaml_text

    def test_split_non_monorepo_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "k33p.yaml").write_text("""\
project: single
type: single
channels:
  src:
    type: source
    transport: file:///tmp/nonexistent
    visibility: public
    history: full
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
            rc = cmd_split(str(root), "nonexistent")
            assert rc == 1  # not a monorepo

    def test_split_nonexistent_subproject(self, monorepo: Path) -> None:
        rc = cmd_split(str(monorepo), "nonexistent")
        assert rc == 1

    def test_split_with_default_target(self, monorepo: Path) -> None:
        import os
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = os.getcwd()
            os.chdir(tmp)
            try:
                rc = cmd_split(str(monorepo), "sub-a")
                assert rc == 0
                expected = Path(tmp) / "sub-a"
                assert expected.is_dir()
            finally:
                os.chdir(old_cwd)

    def test_split_force_overwrite(self, monorepo: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "split-a"
            target.mkdir()
            (target / "k33p.yaml").write_text("old: true")
            # Without force, should fail
            rc = cmd_split(str(monorepo), "sub-a", str(target))
            assert rc == 1
            # With force, should succeed
            rc = cmd_split(str(monorepo), "sub-a", str(target), force=True)
            assert rc == 0
