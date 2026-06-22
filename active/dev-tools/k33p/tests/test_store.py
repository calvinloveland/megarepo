"""Tests for the content-addressed store.

Tests are isolated: each test creates and tears down its own store
directory so no state leaks between tests.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path

import pytest

from k33p.store import (
    VALID_KINDS,
    ContentStore,
    ObjectStat,
    StoreStats,
    _content_hash,
    _decode_object,
    _encode_object,
    _object_path,
)


# ── helpers ─────────────────────────────────────────────────────────────


@pytest.fixture
def store_path() -> Path:
    """Yield a temporary directory that is cleaned up after the test."""
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp) / ".k33p" / "store"


@pytest.fixture
def store(store_path: Path) -> ContentStore:
    """Yield a ContentStore backed by a temporary directory."""
    store_path.mkdir(parents=True, exist_ok=True)
    return ContentStore(store_path)


# ── hash / encoding helpers ─────────────────────────────────────────────


class TestHelpers:
    def test_content_hash_sha256(self) -> None:
        h = _content_hash(b"hello")
        assert len(h) == 64  # SHA-256 hex
        expected = hashlib.sha256(b"hello").hexdigest()
        assert h == expected

    def test_content_hash_deterministic(self) -> None:
        assert _content_hash(b"data") == _content_hash(b"data")

    def test_content_hash_differs_for_diff_data(self) -> None:
        assert _content_hash(b"abc") != _content_hash(b"xyz")

    def test_encode_decode_blob(self) -> None:
        data = b"hello world"
        encoded = _encode_object(data, "blob")
        kind, decoded = _decode_object(encoded)
        assert kind == "blob"
        assert decoded == data

    def test_encode_decode_all_kinds(self) -> None:
        for kind in VALID_KINDS:
            data = f"test-{kind}".encode()
            encoded = _encode_object(data, kind)
            decoded_kind, decoded = _decode_object(encoded)
            assert decoded_kind == kind
            assert decoded == data

    def test_decode_size_mismatch_raises(self) -> None:
        # Manually craft a malformed object
        header = b"blob 5\0"
        payload = b"hello!!!"  # 8 bytes, not 5
        encoded = __import__("zlib").compress(header + payload)
        with pytest.raises(ValueError, match="size mismatch"):
            _decode_object(encoded)

    def test_encode_empty_data(self) -> None:
        encoded = _encode_object(b"", "blob")
        kind, decoded = _decode_object(encoded)
        assert kind == "blob"
        assert decoded == b""

    def test_object_path_format(self) -> None:
        path = _object_path(Path("/store"), "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890")
        assert path == Path("/store/ab/cdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890")

    def test_object_path_short_hash_raises(self) -> None:
        with pytest.raises(ValueError, match="hash too short"):
            _object_path(Path("/store"), "ab")


# ── ContentStore ────────────────────────────────────────────────────────


class TestContentStoreInit:
    def test_init_with_none_path(self) -> None:
        store = ContentStore(None)
        assert not store.exists
        assert store.stats() == StoreStats(0, 0, 0, 0)

    def test_init_with_missing_path(self) -> None:
        store = ContentStore(Path("/nonexistent/store"))
        assert not store.exists

    def test_init_with_valid_path(self, store_path: Path) -> None:
        store_path.mkdir(parents=True, exist_ok=True)
        store = ContentStore(store_path)
        assert store.exists

    def test_ensure_creates_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store_dir = Path(tmp) / "new_store"
            store = ContentStore(store_dir)
            assert not store.exists
            store.ensure()
            assert store.exists
            assert store_dir.is_dir()

    def test_ensure_no_path_raises(self) -> None:
        store = ContentStore(None)
        with pytest.raises(ValueError, match="no path"):
            store.ensure()


class TestContentStorePutAndGet:
    def test_put_returns_hash(self, store: ContentStore) -> None:
        h = store.put(b"data")
        assert len(h) == 64
        assert isinstance(h, str)

    def test_put_and_get_roundtrip(self, store: ContentStore) -> None:
        data = b"hello world"
        h = store.put(data)
        retrieved = store.get(h)
        assert retrieved == data

    def test_put_and_get_default_kind(self, store: ContentStore) -> None:
        data = b"default kind"
        h = store.put(data)
        assert store.get_kind(h) == "blob"

    def test_put_with_explicit_kind(self, store: ContentStore) -> None:
        data = b"secret stuff"
        h = store.put(data, kind="secret")
        assert store.get_kind(h) == "secret"

    def test_put_all_valid_kinds(self, store: ContentStore) -> None:
        for kind in VALID_KINDS:
            data = f"test {kind}".encode()
            h = store.put(data, kind=kind)
            retrieved = store.get(h)
            assert retrieved == data
            assert store.get_kind(h) == kind

    def test_put_invalid_kind_raises(self, store: ContentStore) -> None:
        with pytest.raises(ValueError, match="invalid object kind"):
            store.put(b"data", kind="invalid")

    def test_get_nonexistent_returns_none(self, store: ContentStore) -> None:
        assert store.get("ab" + "c" * 62) is None

    def test_get_kind_nonexistent_returns_none(self, store: ContentStore) -> None:
        assert store.get_kind("ab" + "c" * 62) is None

    def test_put_dedup_same_data(self, store: ContentStore) -> None:
        data = b"dedup me"
        h1 = store.put(data)
        h2 = store.put(data)
        assert h1 == h2

    def test_put_different_data_different_hashes(self, store: ContentStore) -> None:
        h1 = store.put(b"alpha")
        h2 = store.put(b"beta")
        assert h1 != h2

    def test_get_empty_data(self, store: ContentStore) -> None:
        h = store.put(b"")
        assert store.get(h) == b""

    def test_get_large_data(self, store: ContentStore) -> None:
        data = b"x" * 100_000
        h = store.put(data)
        retrieved = store.get(h)
        assert retrieved == data
        assert len(retrieved) == 100_000

    def test_store_path_not_exists_returns_none(self) -> None:
        store = ContentStore(Path("/nonexistent"))
        assert store.get("abc") is None
        assert store.get_kind("abc") is None
        assert not store.has("abc")

    def test_file_system_permissions(self, store_path: Path) -> None:
        """Put should work and the file should exist on disk."""
        store = ContentStore(store_path)
        h = store.put(b"test data")
        obj_path = store_path / h[:2] / h[2:]
        assert obj_path.exists()
        assert obj_path.stat().st_size > 0


class TestContentStoreHas:
    def test_has_existing(self, store: ContentStore) -> None:
        h = store.put(b"data")
        assert store.has(h)

    def test_has_nonexistent(self, store: ContentStore) -> None:
        assert not store.has("ab" + "c" * 62)

    def test_has_after_delete(self, store: ContentStore) -> None:
        h = store.put(b"data")
        assert store.has(h)
        store.delete(h)
        assert not store.has(h)


class TestContentStoreDelete:
    def test_delete_removes_object(self, store: ContentStore) -> None:
        h = store.put(b"data")
        store.delete(h)
        assert store.get(h) is None

    def test_delete_returns_true_on_success(self, store: ContentStore) -> None:
        h = store.put(b"data")
        assert store.delete(h) is True

    def test_delete_nonexistent_returns_false(self, store: ContentStore) -> None:
        assert store.delete("ab" + "c" * 62) is False

    def test_delete_no_store_returns_false(self) -> None:
        store = ContentStore(None)
        assert store.delete("abc") is False

    def test_delete_removes_empty_shard(self, store_path: Path) -> None:
        store = ContentStore(store_path)
        h = store.put(b"data")
        shard = store_path / h[:2]
        assert shard.exists()
        store.delete(h)
        # The shard should be removed when empty
        assert not shard.exists()


class TestContentStoreStats:
    def test_stats_empty(self, store: ContentStore) -> None:
        stats = store.stats()
        assert stats.object_count == 0
        assert stats.total_bytes == 0
        assert stats.compressed_bytes == 0
        assert stats.shard_count == 0

    def test_stats_after_single_put(self, store: ContentStore) -> None:
        store.put(b"hello", kind="blob")
        stats = store.stats()
        assert stats.object_count == 1
        assert stats.total_bytes == 5
        assert stats.shard_count == 1

    def test_stats_after_multiple_puts(self, store: ContentStore) -> None:
        store.put(b"one", kind="blob")
        store.put(b"two", kind="blob")
        store.put(b"three", kind="blob")
        stats = store.stats()
        assert stats.object_count == 3
        # shard_count depends on hash distribution, at least 1

    def test_stats_after_put_and_delete(self, store: ContentStore) -> None:
        h = store.put(b"data")
        store.delete(h)
        stats = store.stats()
        assert stats.object_count == 0

    def test_stats_compressed_less_than_uncompressed(self, store: ContentStore) -> None:
        """Repeated data compresses well."""
        store.put(b"a" * 1000)
        stats = store.stats()
        assert stats.compressed_bytes < stats.total_bytes

    def test_stats_no_store(self) -> None:
        store = ContentStore(None)
        stats = store.stats()
        assert stats == StoreStats(0, 0, 0, 0)

    def test_stats_with_multiple_shards(self, store: ContentStore) -> None:
        """Put many objects to exercise sharding."""
        for i in range(50):
            store.put(f"data-{i}".encode())
        stats = store.stats()
        assert stats.object_count == 50
        assert stats.shard_count >= 1


class TestContentStoreIterObjects:
    def test_iter_empty(self, store: ContentStore) -> None:
        objects = list(store.iter_objects())
        assert objects == []

    def test_iter_after_put(self, store: ContentStore) -> None:
        h = store.put(b"test", kind="manifest")
        objs = list(store.iter_objects())
        assert len(objs) == 1
        obj = objs[0]
        assert obj.hash == h
        assert obj.size == 4
        assert obj.kind == "manifest"

    def test_iter_multiple_objects(self, store: ContentStore) -> None:
        h1 = store.put(b"a", kind="blob")
        h2 = store.put(b"bc", kind="tree")
        objs = {obj.hash: obj for obj in store.iter_objects()}
        assert len(objs) == 2
        assert objs[h1].size == 1
        assert objs[h1].kind == "blob"
        assert objs[h2].size == 2
        assert objs[h2].kind == "tree"

    def test_iter_returns_object_stat_type(self, store: ContentStore) -> None:
        store.put(b"data")
        for obj in store.iter_objects():
            assert isinstance(obj, ObjectStat)
            assert isinstance(obj.hash, str)
            assert isinstance(obj.size, int)
            assert isinstance(obj.kind, str)

    def test_iter_no_store(self) -> None:
        store = ContentStore(None)
        assert list(store.iter_objects()) == []


class TestContentStoreEdgeCases:
    def test_put_binary_data(self, store: ContentStore) -> None:
        data = bytes(range(256))
        h = store.put(data)
        assert store.get(h) == data

    def test_put_zero_bytes(self, store: ContentStore) -> None:
        h = store.put(b"")
        assert store.get(h) == b""
        assert store.get_kind(h) == "blob"

    def test_get_kind_for_nonexistent_shard(self, store: ContentStore) -> None:
        # A hash where the shard directory doesn't exist
        assert store.get_kind("ff" + "c" * 62) is None

    def test_hash_collision_not_possible(self, store: ContentStore) -> None:
        """Two different contents must produce different hashes."""
        h1 = store.put(b"content-a")
        h2 = store.put(b"content-b")
        assert h1 != h2

    def test_put_updates_correctly(self, store: ContentStore) -> None:
        """Re-putting same data returns same hash (dedup)."""
        data = b"immutable"
        h1 = store.put(data)
        h2 = store.put(data)
        assert h1 == h2
        # Both should be retrievable
        assert store.get(h1) == data
        assert store.get(h2) == data

    def test_store_initialised_flag(self, store_path: Path) -> None:
        """A newly-created store should be ready for use."""
        store_path.mkdir(parents=True, exist_ok=True)
        store = ContentStore(store_path)
        assert store.exists
        h = store.put(b"init test")
        assert store.has(h)
