"""Content-addressed object store (CAS).

Every object in k33p is content-addressed by SHA-256 hash.  The store is a
directory of zlib-compressed object files sharded by the first two hex chars
of the hash — exactly like git's .git/objects/ layout.

Each stored object carries a header that records its *kind* (blob, tree,
commit, manifest, secret, artifact, pointer) so the store is self-describing:

    <kind> <content_length>\\0<raw_content>

This header is prepended before zlib compression, matching the git object
format convention.  The content hash is computed over the raw content only
(not the header), so two blobs with the same bytes always produce the same
hash regardless of metadata.

The store lives at ``.k33p/store/`` inside a project root.
"""

from __future__ import annotations

import hashlib
import zlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

# ── object kinds ────────────────────────────────────────────────────────

VALID_KINDS = frozenset({
    "blob",
    "tree",
    "commit",
    "manifest",
    "secret",
    "artifact",
    "pointer",
})

# ── public data types (kept for backward compat) ────────────────────────


@dataclass(frozen=True)
class ObjectStat:
    """Stats about a single object in the store."""

    hash: str
    size: int          # uncompressed content size
    kind: str          # one of VALID_KINDS


@dataclass(frozen=True)
class StoreStats:
    """Aggregate stats about the store."""

    object_count: int
    total_bytes: int   # uncompressed content bytes
    compressed_bytes: int = 0  # bytes on disk (zlib-compressed)
    shard_count: int = 0


# ── helpers ─────────────────────────────────────────────────────────────


def _object_path(store_path: Path, hash_str: str) -> Path:
    """Return the filesystem path for an object given its hex hash.

    Layout: ``<store>/<first-2-chars>/<remaining-chars>``
    """
    if len(hash_str) < 3:
        raise ValueError(f"hash too short: {hash_str!r}")
    return store_path / hash_str[:2] / hash_str[2:]


def _content_hash(data: bytes) -> str:
    """Return the SHA-256 hex digest of *data*."""
    return hashlib.sha256(data).hexdigest()


def _encode_object(data: bytes, kind: str) -> bytes:
    """Build the on-disk representation: zlib(kind + space + size + NUL + data)."""
    header = f"{kind} {len(data)}\0".encode()
    return zlib.compress(header + data)


def _decode_object(raw: bytes) -> tuple[str, bytes]:
    """Decompress and parse the header, returning ``(kind, content)``."""
    decompressed = zlib.decompress(raw)
    null_pos = decompressed.index(b"\0")
    header = decompressed[:null_pos]
    content = decompressed[null_pos + 1 :]
    kind, size_str = header.split(b" ", 1)
    expected_size = int(size_str)
    if len(content) != expected_size:
        raise ValueError(
            f"object size mismatch: header says {expected_size}, "
            f"got {len(content)}"
        )
    return kind.decode(), content


# ── the store ────────────────────────────────────────────────────────────


class ContentStore:
    """The content-addressed object store for a k33p project.

    Stores objects sharded by the first two hex characters of the SHA-256
    hash, with each object file containing the zlib-compressed
    ``kind + size + NUL + content`` payload.

    Usage::

        store = ContentStore(Path(".k33p/store"))
        h = store.put(b"hello world", kind="blob")
        assert store.has(h)
        data = store.get(h)      # b"hello world"
        kind = store.get_kind(h)  # "blob"
    """

    def __init__(self, path: Path | None) -> None:
        self.path = path

    # ── existence ────────────────────────────────────────────────────

    @property
    def exists(self) -> bool:
        return self.path is not None and self.path.exists()

    def ensure(self) -> Path:
        """Create the store directory if it doesn't exist, return the path."""
        if self.path is None:
            raise ValueError("ContentStore has no path set")
        self.path.mkdir(parents=True, exist_ok=True)
        return self.path

    # ── core operations ──────────────────────────────────────────────

    def put(self, data: bytes, kind: str = "blob") -> str:
        """Store *data* under its SHA-256 hash.

        Args:
            data: The raw content bytes (no header).
            kind: Object kind (blob, tree, commit, manifest, secret,
                  artifact, pointer).  Defaults to ``"blob"``.

        Returns:
            The hex SHA-256 hash of *data*.

        Raises:
            ValueError: If *kind* is not one of ``VALID_KINDS``.
        """
        if kind not in VALID_KINDS:
            raise ValueError(
                f"invalid object kind {kind!r}; valid: {', '.join(sorted(VALID_KINDS))}"
            )
        store_path = self.ensure()
        hash_str = _content_hash(data)
        obj_path = _object_path(store_path, hash_str)
        if obj_path.exists():
            return hash_str  # already stored — dedup

        obj_path.parent.mkdir(parents=True, exist_ok=True)
        obj_path.write_bytes(_encode_object(data, kind))
        return hash_str

    def get(self, hash_str: str) -> bytes | None:
        """Retrieve the raw content for a hash.

        Returns ``None`` if the object doesn't exist.
        """
        if self.path is None or not self.path.exists():
            return None
        obj_path = _object_path(self.path, hash_str)
        if not obj_path.exists():
            return None
        try:
            raw = obj_path.read_bytes()
        except OSError:
            return None
        _, content = _decode_object(raw)
        return content

    def get_kind(self, hash_str: str) -> str | None:
        """Retrieve the object kind for a hash without returning the content.

        Returns ``None`` if the object doesn't exist.
        """
        if self.path is None or not self.path.exists():
            return None
        obj_path = _object_path(self.path, hash_str)
        if not obj_path.exists():
            return None
        try:
            raw = obj_path.read_bytes()
        except OSError:
            return None
        kind, _ = _decode_object(raw)
        return kind

    def has(self, hash_str: str) -> bool:
        """Return ``True`` if an object with the given hash exists."""
        if self.path is None or not self.path.exists():
            return False
        obj_path = _object_path(self.path, hash_str)
        return obj_path.exists()

    def delete(self, hash_str: str) -> bool:
        """Remove an object from the store.

        Returns ``True`` if the object was removed, ``False`` if it didn't
        exist or the store isn't initialised.
        """
        if self.path is None or not self.path.exists():
            return False
        obj_path = _object_path(self.path, hash_str)
        if not obj_path.exists():
            return False
        try:
            obj_path.unlink()
            # Clean up empty shards
            shard = obj_path.parent
            if shard.exists() and not any(shard.iterdir()):
                shard.rmdir()
        except OSError:
            return False
        return True

    # ── bulk / aggregate ─────────────────────────────────────────────

    def stats(self) -> StoreStats:
        """Return aggregate stats for the store.

        Returns zeros if the store doesn't exist on disk.
        """
        if not self.exists:
            return StoreStats(object_count=0, total_bytes=0, compressed_bytes=0, shard_count=0)

        assert self.path is not None
        shards = sorted(p for p in self.path.iterdir() if p.is_dir())
        obj_count = 0
        total_uncompressed = 0
        total_compressed = 0
        for shard in shards:
            for obj in sorted(shard.iterdir()):
                if not obj.is_file():
                    continue
                try:
                    compressed = obj.stat().st_size
                    raw = obj.read_bytes()
                    _, content = _decode_object(raw)
                    obj_count += 1
                    total_uncompressed += len(content)
                    total_compressed += compressed
                except (OSError, ValueError, zlib.error):
                    pass
        return StoreStats(
            object_count=obj_count,
            total_bytes=total_uncompressed,
            compressed_bytes=total_compressed,
            shard_count=len(shards),
        )

    def iter_objects(self) -> Iterator[ObjectStat]:
        """Iterate over all objects in the store.

        Yields an ``ObjectStat`` for each valid object.
        """
        if not self.exists:
            return
        assert self.path is not None
        for shard in sorted(self.path.iterdir()):
            if not shard.is_dir():
                continue
            for obj in sorted(shard.iterdir()):
                if not obj.is_file():
                    continue
                try:
                    raw = obj.read_bytes()
                    kind, content = _decode_object(raw)
                    yield ObjectStat(
                        hash=shard.name + obj.name,
                        size=len(content),
                        kind=kind,
                    )
                except (OSError, ValueError, zlib.error):
                    pass
