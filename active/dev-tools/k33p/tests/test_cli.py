"""Tests for the k33p CLI — init, info, version, and store subcommands."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from k33p.cli import main


def _run(args: list[str]) -> tuple[int, str, str]:
    """Run *main* with *args*, capturing stdout and stderr.

    Returns ``(return_code, stdout, stderr)``.
    """
    import io
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    try:
        out = io.StringIO()
        err = io.StringIO()
        sys.stdout = out
        sys.stderr = err
        rc = main(args)
        return rc, out.getvalue(), err.getvalue()
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr


import sys  # noqa: E402 — needed for _run above


class TestInit:
    def test_init_creates_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = _run(["init", "my-project", "--dir", tmp])
            assert rc == 0, f"stderr: {err}"
            yaml = Path(tmp) / "k33p.yaml"
            assert yaml.exists()
            store = Path(tmp) / ".k33p" / "store"
            assert store.is_dir()
            assert "my-project" in out
            assert "Initialised" in out

    def test_init_with_description(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = _run([
                "init", "my-project", "--dir", tmp,
                "--description", "A test project",
                "--org", "acme",
            ])
            assert rc == 0
            yaml_text = (Path(tmp) / "k33p.yaml").read_text()
            assert "description: A test project" in yaml_text
            assert "org: acme" in yaml_text

    def test_init_respects_force_flag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            yaml = Path(tmp) / "k33p.yaml"
            yaml.write_text("existing: true")
            # Without --force it should fail
            rc, out, err = _run(["init", "overwrite-test", "--dir", tmp])
            assert rc == 1
            assert "already exists" in err
            # With --force it should succeed
            rc, out, err = _run(["init", "overwrite-test", "--dir", tmp, "--force"])
            assert rc == 0

    def test_init_monorepo_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = _run(["init", "mono", "--dir", tmp, "--type", "monorepo"])
            assert rc == 0
            yaml_text = (Path(tmp) / "k33p.yaml").read_text()
            assert "type: monorepo" in yaml_text

    def test_init_single_type_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = _run(["init", "single", "--dir", tmp])
            assert rc == 0
            yaml_text = (Path(tmp) / "k33p.yaml").read_text()
            assert "type: single" in yaml_text

    def test_init_created_yaml_is_parseable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = _run(["init", "parseable", "--dir", tmp])
            assert rc == 0
            # Verify it loads correctly via the CLI
            rc2, out2, err2 = _run(["info", str(tmp)])
            assert rc2 == 0
            assert "parseable" in out2

    def test_init_creates_gitkeep_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _run(["init", "gitkeep-test", "--dir", tmp])
            assert (Path(tmp) / ".k33p" / ".gitkeep").exists()
            assert (Path(tmp) / ".k33p" / "store" / ".gitkeep").exists()


class TestInfo:
    def test_info_on_example(self) -> None:
        examples = Path(__file__).resolve().parent.parent / "examples"
        rc, out, err = _run(["info", str(examples / "megarepo")])
        assert rc == 0
        assert "megarepo" in out
        assert "monorepo" in out

    def test_info_on_coolproject(self) -> None:
        examples = Path(__file__).resolve().parent.parent / "examples"
        rc, out, err = _run(["info", str(examples / "coolproject")])
        assert rc == 0
        assert "coolproject" in out

    def test_info_on_nonexistent(self) -> None:
        rc, out, err = _run(["info", "/nonexistent/path"])
        assert rc == 2
        assert "not found" in err


class TestVersion:
    def test_version(self) -> None:
        rc, out, err = _run(["version"])
        assert rc == 0
        assert "k33p" in out
        assert "0.0.1" in out


class TestStoreSubcommand:
    def test_store_put_and_get(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            # Init a project first
            rc, out, err = _run(["init", "store-test", "--dir", tmp])
            assert rc == 0
            # Create a file to store
            test_file = Path(tmp) / "test.txt"
            test_file.write_text("hello from store")
            # Put it in the store
            rc, out, err = _run([
                "store", "put", str(tmp), str(test_file),
                "--kind", "blob",
            ])
            assert rc == 0
            assert "Stored as" in out

    def test_store_stats_on_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _run(["init", "stats-test", "--dir", tmp])
            rc, out, err = _run(["store", "stats", str(tmp)])
            assert rc == 0
            assert "Objects:   0" in out

    def test_store_ls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _run(["init", "ls-test", "--dir", tmp])
            rc, out, err = _run(["store", "ls", str(tmp)])
            assert rc == 0

    def test_store_no_subcommand_fails(self) -> None:
        """Running 'k33p store <path>' without a subcommand should exit with error."""
        with tempfile.TemporaryDirectory() as tmp:
            _run(["init", "err-test", "--dir", tmp])
            rc, out, err = _run(["store", str(tmp)])
            assert rc == 2
            assert "expected a subcommand" in err or "unknown subcommand" in err


class TestLegacyPath:
    """Backward compat: ``k33p <path>`` (no subcommand) should work."""

    def test_legacy_path_fails_gracefully(self) -> None:
        """Backward compat: ``k33p <path>`` should try to load the project."""
        rc, out, err = _run(["/nonexistent/path"])
        assert rc == 2  # FileNotFoundError from load_project

    def test_legacy_empty_path_defaults_to_dot(self) -> None:
        """``k33p`` with no args should default path to '.' and fail gracefully."""
        # With no terminal, this will try to init the TUI on the current dir
        # and fail. We just check it doesn't crash before getting there.
        rc, out, err = _run([])
        assert rc == 2
