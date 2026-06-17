"""Tests for the disk-backed storage layer."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

import drop.storage as storage
from drop.storage import (
    StorageFullError,
    add_file,
    delete_file,
    get_file,
    list_files,
    read_file_bytes,
    total_bytes,
)


# ---------------------------------------------------------------------------
# Basics
# ---------------------------------------------------------------------------


class TestAddAndList:
    def test_add_returns_metadata(self, tmp_data_dir):
        f = add_file(name="hello.txt", content_type="text/plain", data=b"hi there")
        assert f.id
        assert f.name == "hello.txt"
        assert f.size == 8
        assert f.content_type == "text/plain"
        assert f.sha256
        assert f.size_human.endswith("B")

    def test_add_persists_bytes(self, tmp_data_dir):
        f = add_file(name="a.bin", content_type="application/octet-stream", data=b"abcd")
        out = read_file_bytes(f.id)
        assert out == b"abcd"

    def test_list_newest_first(self, tmp_data_dir):
        f1 = add_file(name="first.txt", content_type="text/plain", data=b"1")
        time.sleep(0.01)
        f2 = add_file(name="second.txt", content_type="text/plain", data=b"22")
        time.sleep(0.01)
        f3 = add_file(name="third.txt", content_type="text/plain", data=b"333")
        listed = list_files()
        assert [f.id for f in listed] == [f3.id, f2.id, f1.id]

    def test_total_bytes(self, tmp_data_dir):
        add_file(name="a", content_type="text/plain", data=b"12345")
        add_file(name="b", content_type="text/plain", data=b"678")
        assert total_bytes() == 8

    def test_get_file(self, tmp_data_dir):
        f = add_file(name="x", content_type="text/plain", data=b"y")
        assert get_file(f.id) is not None
        assert get_file("nonexistent") is None

    def test_id_is_uuid_hex(self, tmp_data_dir):
        f = add_file(name="x", content_type="text/plain", data=b"y")
        # 32-char hex per the storage layer's uuid.uuid4().hex
        assert len(f.id) == 32
        assert all(c in "0123456789abcdef" for c in f.id)

    def test_atomic_index_write(self, tmp_data_dir):
        """A corrupt index file should not crash the API — the data is still on disk."""
        f1 = add_file(name="keep.txt", content_type="text/plain", data=b"keep me")
        # Corrupt the index file. get_file should return None rather than crash.
        from drop import INDEX_FILE
        INDEX_FILE.write_text("{ this is not valid JSON")
        assert get_file(f1.id) is None
        # The bytes should still be on disk, retrievable directly.
        assert read_file_bytes(f1.id) == b"keep me"


# ---------------------------------------------------------------------------
# Deletion
# ---------------------------------------------------------------------------


class TestDelete:
    def test_delete_removes_bytes_and_index(self, tmp_data_dir):
        f = add_file(name="bye.txt", content_type="text/plain", data=b"bye")
        assert delete_file(f.id) is True
        assert read_file_bytes(f.id) is None
        assert get_file(f.id) is None
        assert delete_file(f.id) is False

    def test_delete_preserves_other_files(self, tmp_data_dir):
        a = add_file(name="a", content_type="text/plain", data=b"a")
        b = add_file(name="b", content_type="text/plain", data=b"b")
        delete_file(a.id)
        listed = {f.id for f in list_files()}
        assert listed == {b.id}


# ---------------------------------------------------------------------------
# Storage cap
# ---------------------------------------------------------------------------


class TestStorageCap:
    def test_cap_enforced(self, tmp_data_dir, monkeypatch):
        # Lower the cap so we can test without uploading megabytes.
        # Patch on the storage module (where add_file reads it) AND on
        # the drop package (where the constant is canonically defined).
        monkeypatch.setattr(storage, "MAX_TOTAL_STORAGE_MB", 0)  # 0 MB
        monkeypatch.setattr("drop.MAX_TOTAL_STORAGE_MB", 0, raising=False)
        with pytest.raises(StorageFullError):
            add_file(name="x", content_type="text/plain", data=b"hello")

    def test_cap_allows_when_room(self, tmp_data_dir, monkeypatch):
        monkeypatch.setattr(storage, "MAX_TOTAL_STORAGE_MB", 1)
        monkeypatch.setattr("drop.MAX_TOTAL_STORAGE_MB", 1, raising=False)
        f = add_file(name="ok", content_type="text/plain", data=b"hello")
        assert f.id


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


class TestConcurrency:
    def test_concurrent_adds(self, tmp_data_dir):
        results: list = []
        errors: list = []

        def worker(i: int) -> None:
            try:
                results.append(add_file(name=f"f{i}", content_type="text/plain", data=str(i).encode()))
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for t in threads: t.start()
        for t in threads: t.join()
        assert not errors
        assert len(results) == 10
        assert len({f.id for f in list_files()}) == 10


# ---------------------------------------------------------------------------
# Path traversal guard
# ---------------------------------------------------------------------------


class TestPathTraversal:
    def test_read_file_bytes_rejects_bad_id(self, tmp_data_dir):
        assert read_file_bytes("../../../etc/passwd") is None
        assert read_file_bytes("not-hex-at-all") is None
        assert read_file_bytes("a" * 31) is None  # wrong length
        assert read_file_bytes("g" * 32) is None  # not hex chars
