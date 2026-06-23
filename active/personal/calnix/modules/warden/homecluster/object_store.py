"""
Content-addressed object store for HomeCluster.

Objects are stored by SHA-256 digest, providing:
- Built-in deduplication (same content = same ID)
- Integrity verification (any retrieval checks the hash)
- Easy replication (just copy the file by content hash)

Structure:
    <store_root>/
      objects/
        ab/
          abcdef...          # Object file named by its SHA-256 hash
        cd/
          cdef01...          # Another object
      metadata/
        <object_hash>.json   # Optional metadata per object
      staging/               # Temporary upload area

Usage:
    store = ObjectStore("/var/lib/homecluster/objects")
    oid = store.put(b"hello world")
    data = store.get(oid)          # bytes
    verified = store.verify(oid)   # bool
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO


class ObjectStoreError(RuntimeError):
    """Raised on object store operation failures."""


@dataclass
class ObjectMetadata:
    """Metadata associated with a stored object."""

    oid: str
    size_bytes: int
    created_at: str
    content_type: str = "application/octet-stream"
    logical_path: str | None = None  # Optional logical path for directory mapping
    labels: dict[str, str] = field(default_factory=dict)
    checksum: str = "sha256"  # Hash algorithm used

    def to_dict(self) -> dict[str, Any]:
        return {
            "oid": self.oid,
            "size_bytes": self.size_bytes,
            "created_at": self.created_at,
            "content_type": self.content_type,
            "logical_path": self.logical_path,
            "labels": self.labels,
            "checksum": self.checksum,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ObjectMetadata:
        return cls(
            oid=data["oid"],
            size_bytes=data["size_bytes"],
            created_at=data["created_at"],
            content_type=data.get("content_type", "application/octet-stream"),
            logical_path=data.get("logical_path"),
            labels=data.get("labels", {}),
            checksum=data.get("checksum", "sha256"),
        )


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _object_path(store_root: Path, oid: str) -> Path:
    """Get the filesystem path for an object given its hash.

    Uses two-level directory structure: first 2 chars as directory,
    rest as filename. This prevents too many files in one directory.
    """
    if len(oid) < 4:
        raise ObjectStoreError(f"Object ID too short: {oid}")
    return store_root / "objects" / oid[:2] / oid[2:]


def _metadata_path(store_root: Path, oid: str) -> Path:
    """Get the metadata file path for an object."""
    return store_root / "metadata" / f"{oid}.json"


def _staging_path(store_root: Path) -> Path:
    """Get the staging directory for incomplete uploads."""
    return store_root / "staging"


class ObjectStore:
    """Content-addressed, immutable object store.

    Thread-safe for concurrent reads. Writes use atomic rename.
    """

    def __init__(self, store_root: str | os.PathLike[str]) -> None:
        self.root = Path(store_root).resolve()
        self.objects_dir = self.root / "objects"
        self.metadata_dir = self.root / "metadata"
        self.staging_dir = self.root / "staging"

        # Create directories on init
        self.objects_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        self.staging_dir.mkdir(parents=True, exist_ok=True)

    # ── Core operations ──────────────────────────────────────────

    def put(
        self,
        data: bytes,
        *,
        content_type: str = "application/octet-stream",
        logical_path: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> str:
        """Store a blob of bytes (content-addressed by SHA-256).

        Returns the object ID (SHA-256 hex digest).
        If the object already exists, returns the existing OID.
        """
        oid = _sha256(data)
        obj_path = _object_path(self.root, oid)

        if obj_path.exists():
            return oid  # Already stored — deduplication

        # Write to staging, then atomically rename to final location
        obj_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _staging_path(self.root) / f".{oid}.tmp"

        try:
            tmp_path.write_bytes(data)
            os.rename(tmp_path, obj_path)
        except OSError as e:
            # Clean up staging on failure
            tmp_path.unlink(missing_ok=True)
            raise ObjectStoreError(f"Failed to store object {oid}: {e}") from e

        # Write metadata
        meta = ObjectMetadata(
            oid=oid,
            size_bytes=len(data),
            created_at=_utcnow(),
            content_type=content_type,
            logical_path=logical_path,
            labels=labels or {},
        )
        self._save_metadata(meta)

        return oid

    def put_file(
        self,
        source_path: str | os.PathLike[str],
        *,
        content_type: str = "application/octet-stream",
        logical_path: str | None = None,
        labels: dict[str, str] | None = None,
    ) -> str:
        """Store a file by path. Returns the object ID.

        More efficient than read+put for large files.
        """
        source = Path(source_path)
        if not source.exists():
            raise ObjectStoreError(f"Source file not found: {source}")

        # Hash the file
        oid = self._hash_file(source)
        obj_path = _object_path(self.root, oid)

        if obj_path.exists():
            return oid

        # Atomic copy from source
        obj_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = _staging_path(self.root) / f".{oid}.tmp"

        try:
            shutil.copy2(source, tmp_path)
            os.rename(tmp_path, obj_path)
        except OSError as e:
            tmp_path.unlink(missing_ok=True)
            raise ObjectStoreError(f"Failed to store file as {oid}: {e}") from e

        # Save metadata
        meta = ObjectMetadata(
            oid=oid,
            size_bytes=source.stat().st_size,
            created_at=_utcnow(),
            content_type=content_type,
            logical_path=logical_path,
            labels=labels or {},
        )
        self._save_metadata(meta)

        return oid

    def get(self, oid: str) -> bytes:
        """Retrieve an object by its content hash.

        Raises ObjectStoreError if not found or hash mismatch.
        """
        if not self.exists(oid):
            raise ObjectStoreError(f"Object not found: {oid}")

        obj_path = _object_path(self.root, oid)
        try:
            data = obj_path.read_bytes()
        except OSError as e:
            raise ObjectStoreError(f"Failed to read object {oid}: {e}") from e

        # Integrity check
        if _sha256(data) != oid:
            raise ObjectStoreError(
                f"Object {oid} is corrupted: content hash mismatch"
            )

        return data

    def get_file(self, oid: str, dest_path: str | os.PathLike[str]) -> Path:
        """Copy an object to a destination file. Returns the destination path."""
        dest = Path(dest_path)
        data = self.get(oid)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return dest

    def delete(self, oid: str) -> bool:
        """Delete an object and its metadata. Returns True if deleted."""
        obj_path = _object_path(self.root, oid)
        meta_path = _metadata_path(self.root, oid)

        deleted = False
        if obj_path.exists():
            obj_path.unlink()
            deleted = True

        if meta_path.exists():
            meta_path.unlink()

        return deleted

    def exists(self, oid: str) -> bool:
        """Check if an object exists in the store."""
        obj_path = _object_path(self.root, oid)
        return obj_path.exists()

    def verify(self, oid: str) -> bool:
        """Verify object integrity by recomputing its hash.

        Returns True if the object exists and its content matches the hash.
        """
        if not self.exists(oid):
            return False
        obj_path = _object_path(self.root, oid)
        try:
            actual_hash = self._hash_file(obj_path)
            return actual_hash == oid
        except OSError:
            return False

    def get_metadata(self, oid: str) -> ObjectMetadata | None:
        """Retrieve metadata for an object, if it exists."""
        meta_path = _metadata_path(self.root, oid)
        if not meta_path.exists():
            return None
        try:
            data = json.loads(meta_path.read_text())
            return ObjectMetadata.from_dict(data)
        except (OSError, json.JSONDecodeError, KeyError):
            return None

    def list_objects(self) -> list[str]:
        """List all object IDs in the store."""
        oids: list[str] = []
        for prefix_dir in self.objects_dir.iterdir():
            if not prefix_dir.is_dir() or len(prefix_dir.name) != 2:
                continue
            for obj_file in prefix_dir.iterdir():
                if obj_file.is_file() and len(obj_file.name) > 2:
                    oids.append(f"{prefix_dir.name}{obj_file.name}")
        return sorted(oids)

    def total_size(self) -> int:
        """Compute total size of all stored objects (not metadata)."""
        total = 0
        for oid in self.list_objects():
            obj_path = _object_path(self.root, oid)
            try:
                total += obj_path.stat().st_size
            except OSError:
                pass
        return total

    def object_count(self) -> int:
        """Count total objects in the store."""
        return len(self.list_objects())

    # ── Internal helpers ─────────────────────────────────────────

    def _hash_file(self, path: Path) -> str:
        """Compute SHA-256 of a file efficiently."""
        h = hashlib.sha256()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(8192 * 1024)  # 8 MB buffer
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()

    def _save_metadata(self, meta: ObjectMetadata) -> None:
        """Persist object metadata to disk."""
        meta_path = _metadata_path(self.root, meta.oid)
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", dir=meta_path.parent, delete=False, encoding="utf-8"
        ) as f:
            json.dump(meta.to_dict(), f, indent=2, sort_keys=True)
            tmp_name = f.name
        os.replace(tmp_name, meta_path)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
