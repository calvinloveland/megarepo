"""Tests for transports and the ``k33p clone`` command."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from k33p.store import ContentStore
from k33p.transport import (
    FileTransport,
    Transport,
    TransportError,
    _looks_like_local_path,
    clone,
    sync,
)


# ── helpers ──────────────────────────────────────────────────────────────


@pytest.fixture
def source_project() -> Path:
    """Build a minimal source project with a few objects in its store.

    Uses a ``file://`` transport so that ``k33p clone`` rewrites the
    cloned manifest's channel transports to point at this source dir,
    enabling ``k33p sync`` to find it later.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        # Build the file:// URL for this source
        source_url = f"file://{root}"
        # k33p.yaml
        (root / "k33p.yaml").write_text(f"""\
project: source-proj
type: single
channels:
  src:
    type: source
    transport: {source_url}
    visibility: public
    history: full
views:
  default:
    src: {{ at: "./" }}
roles:
  developer:   {{ view: default }}
""")
        # Store with a few objects
        store_path = root / ".k33p" / "store"
        store = ContentStore(store_path)
        store.ensure()
        h1 = store.put(b"hello from source", kind="blob")
        h2 = store.put(b"{'key': 'value'}", kind="manifest")
        h3 = store.put(b"encrypted-data", kind="secret")
        # Verify
        assert store.has(h1)
        assert store.has(h2)
        assert store.has(h3)
        assert store.stats().object_count == 3
        yield root


@pytest.fixture
def empty_project() -> Path:
    """A project with a manifest but no store objects."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "k33p.yaml").write_text("""\
project: empty
type: single
channels:
  src:
    type: source
    transport: git+https://example.com/empty
    visibility: public
    history: full
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
        # No store
        yield root


# ── transport factory ────────────────────────────────────────────────────


class TestTransportFactory:
    def test_for_source_file_path(self) -> None:
        t = Transport.for_source("/some/path")
        assert isinstance(t, FileTransport)

    def test_for_source_file_url(self) -> None:
        t = Transport.for_source("file:///some/path")
        assert isinstance(t, FileTransport)

    def test_for_source_relative_path(self) -> None:
        t = Transport.for_source("./relative/path")
        assert isinstance(t, FileTransport)

    def test_for_source_unknown_scheme_raises(self) -> None:
        with pytest.raises(TransportError, match="no transport"):
            Transport.for_source("git+https://example.com/repo")


# ── FileTransport ─────────────────────────────────────────────────────────


class TestFileTransport:
    def test_supports_local_path(self) -> None:
        assert FileTransport.supports("/home/project")
        assert FileTransport.supports("./relative")
        assert FileTransport.supports("project")

    def test_supports_file_url(self) -> None:
        assert FileTransport.supports("file:///home/project")

    def test_does_not_support_other_schemes(self) -> None:
        assert not FileTransport.supports("https://example.com")
        assert not FileTransport.supports("k33p://host/project")

    def test_resolve_path_bare(self) -> None:
        t = FileTransport("/tmp/my-project")
        assert t._resolve_path() == Path("/tmp/my-project").resolve()

    def test_resolve_path_file_url(self) -> None:
        t = FileTransport("file:///tmp/my-project")
        assert t._resolve_path() == Path("/tmp/my-project").resolve()

    def test_fetch_copies_all_objects(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target_store = ContentStore(Path(tmp))
            target_store.ensure()
            t = FileTransport(str(source_project))
            count = t.fetch(target_store)
            # 3 objects in the source
            assert count == 3
            assert target_store.stats().object_count == 3

    def test_fetch_dedup(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target_store = ContentStore(Path(tmp))
            target_store.ensure()
            t = FileTransport(str(source_project))
            count1 = t.fetch(target_store)
            count2 = t.fetch(target_store)  # second fetch — all already present
            assert count1 == 3
            assert count2 == 0  # nothing new

    def test_fetch_empty_source_raises(self, empty_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target_store = ContentStore(Path(tmp))
            target_store.ensure()
            t = FileTransport(str(empty_project))
            with pytest.raises(TransportError, match="no .k33p/store"):
                t.fetch(target_store)

    def test_fetch_nonexistent_source_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target_store = ContentStore(Path(tmp))
            target_store.ensure()
            t = FileTransport("/nonexistent-project")
            with pytest.raises(TransportError, match="no .k33p/store"):
                t.fetch(target_store)

    def test_fetch_preserves_kinds(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target_store = ContentStore(Path(tmp))
            target_store.ensure()
            t = FileTransport(str(source_project))
            t.fetch(target_store)
            # Check that kinds were preserved
            kinds = {obj.kind for obj in target_store.iter_objects()}
            assert kinds == {"blob", "manifest", "secret"}


# ── clone integration ────────────────────────────────────────────────────


class TestClone:
    def test_clone_creates_target(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            rc = clone(str(source_project), str(target))
            assert rc == 0
            assert target.is_dir()
            assert (target / "k33p.yaml").exists()
            assert (target / ".k33p" / "store").is_dir()

    def test_clone_copies_objects(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            clone(str(source_project), str(target))
            target_store = ContentStore(target / ".k33p" / "store")
            assert target_store.stats().object_count == 3

    def test_clone_copies_content(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            clone(str(source_project), str(target))
            target_store = ContentStore(target / ".k33p" / "store")
            # Find an object and verify its content matches
            for obj in target_store.iter_objects():
                data = target_store.get(obj.hash)
                assert data is not None
                break

    def test_clone_with_default_target(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = Path.cwd()
            import os
            os.chdir(tmp)
            try:
                rc = clone(str(source_project))
                assert rc == 0
                # Should create a directory named after the project
                expected = Path(tmp) / "source-proj"
                assert expected.is_dir()
                assert (expected / "k33p.yaml").exists()
            finally:
                os.chdir(old_cwd)

    def test_clone_with_force_overwrite(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            target.mkdir()
            # Create a dummy manifest
            (target / "k33p.yaml").write_text("old: true")
            # Without force, should fail
            rc = clone(str(source_project), str(target))
            assert rc == 1
            # With force, should succeed
            rc = clone(str(source_project), str(target), force=True)
            assert rc == 0
            yaml_text = (target / "k33p.yaml").read_text()
            assert "source-proj" in yaml_text  # new manifest content

    def test_clone_preserves_lock(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            # Add a lock file to the source
            lock_path = source_project / "k33p.lock"
            lock_path.write_text("""\
generated: 2026-06-22T00:00:00Z
channels:
  src:
    ref: src@deadbeef
signature:
  key: test-key
  sig: test-sig
  algorithm: ed25519
""")
            target = Path(tmp) / "cloned"
            clone(str(source_project), str(target))
            assert (target / "k33p.lock").exists()
            assert "deadbeef" in (target / "k33p.lock").read_text()

    def test_clone_with_file_url(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            url = f"file://{source_project}"
            rc = clone(url, str(target))
            assert rc == 0
            assert (target / "k33p.yaml").exists()
            assert (target / ".k33p" / "store").is_dir()

    def test_clone_nonexistent_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc = clone("/nonexistent", str(Path(tmp) / "cloned"))
            assert rc == 1


# ── sync integration ─────────────────────────────────────────────────────


class TestSync:
    def test_sync_after_clone_finds_nothing_new(self, source_project: Path) -> None:
        """Syncing a freshly-cloned project should find no new objects."""
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            clone(str(source_project), str(target))
            rc = sync(str(target))
            assert rc == 0

    def test_sync_fetches_new_objects(self, source_project: Path) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "cloned"
            clone(str(source_project), str(target))
            # Add a new object to the source
            source_store = ContentStore(source_project / ".k33p" / "store")
            source_store.put(b"new object from upstream", kind="blob")
            assert source_store.stats().object_count == 4
            # Sync should pick it up
            target_store = ContentStore(target / ".k33p" / "store")
            before = target_store.stats().object_count
            rc = sync(str(target))
            assert rc == 0
            after = target_store.stats().object_count
            assert after == before + 1

    def test_sync_on_nonexistent_path(self) -> None:
        rc = sync("/nonexistent")
        assert rc == 1

    def test_sync_on_project_with_no_transport(self) -> None:
        """A project whose channels don't have file:// transports should
        sync gracefully (no-op)."""
        with tempfile.TemporaryDirectory() as tmp:
            # Create a project with non-file transports
            (Path(tmp) / "k33p.yaml").write_text("""\
project: remote-proj
type: single
channels:
  src:
    type: source
    transport: git+https://example.com/repo
    visibility: public
    history: full
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
            ContentStore(Path(tmp) / ".k33p" / "store").ensure()
            rc = sync(str(tmp))
            assert rc == 0  # no-op, not an error

    def test_sync_defaults_to_cwd(self) -> None:
        """``k33p sync`` with no path defaults to the current directory."""
        with tempfile.TemporaryDirectory() as tmp:
            old_cwd = Path.cwd()
            import os
            os.chdir(tmp)
            try:
                # Init a project in the cwd
                from k33p.cli import main as cli_main
                cli_main(["init", "cwd-test"])
                # Now sync should find it
                rc = sync(None)
                assert rc == 0
            finally:
                os.chdir(old_cwd)


# ── helper tests ─────────────────────────────────────────────────────────


class TestHelpers:
    def test_looks_like_local_path_absolute(self) -> None:
        assert _looks_like_local_path("/tmp/project")

    def test_looks_like_local_path_relative(self) -> None:
        assert _looks_like_local_path("./project")
        assert _looks_like_local_path("project")

    def test_looks_like_local_path_url_with_scheme(self) -> None:
        assert not _looks_like_local_path("https://example.com")
        assert not _looks_like_local_path("file:///tmp/project")
        assert not _looks_like_local_path("k33p://host/proj")
