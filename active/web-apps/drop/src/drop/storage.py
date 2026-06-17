"""Disk-backed file storage with a JSON metadata index.

The data model is intentionally simple:

  data/
    index.json            ← list of {id, name, size, content_type, added_at, sha256}
    uploads/
      <id>                ← raw file bytes (the on-disk name is the ID, no extension)

We keep the original filename and content type in the index so the UI
can show the right name + icon. The on-disk filename is a UUID so a
malicious or duplicate upload name can't escape the uploads dir.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Optional

from . import INDEX_FILE, MAX_TOTAL_STORAGE_MB, UPLOADS_DIR


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class StoredFile:
    """Metadata for one uploaded file."""

    id: str
    name: str                 # original filename, as uploaded
    size: int                 # bytes
    content_type: str         # MIME type from the upload (or sniffed)
    added_at: float           # epoch seconds
    sha256: str               # hex digest of the file contents

    @property
    def safe_name(self) -> str:
        """A name safe to embed in download responses."""
        # Strip any path components and quotes the user might have included.
        return os.path.basename(self.name).replace('"', "").replace("\n", "")

    @property
    def size_human(self) -> str:
        """Size formatted for humans (e.g. '1.4 MB')."""
        return _humanize_bytes(self.size)

    def to_dict(self) -> dict:
        """Serialize to a JSON-friendly dict."""
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "StoredFile":
        """Hydrate a StoredFile from a dict (inverse of to_dict)."""
        return cls(
            id=d["id"],
            name=d["name"],
            size=int(d["size"]),
            content_type=d.get("content_type", "application/octet-stream"),
            added_at=float(d["added_at"]),
            sha256=d["sha256"],
        )


# ---------------------------------------------------------------------------
# Index management
# ---------------------------------------------------------------------------


_index_lock = threading.Lock()


def _load_index() -> list[dict]:
    if not INDEX_FILE.exists():  # type: ignore[union-attr]
        return []
    try:
        return json.loads(INDEX_FILE.read_text(encoding="utf-8"))  # type: ignore[union-attr]
    except (json.JSONDecodeError, OSError):
        return []


def _save_index(entries: list[dict]) -> None:
    """Atomic write: tmp file + rename, so a crash mid-write can't corrupt the index."""
    INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)  # type: ignore[union-attr]
    tmp = INDEX_FILE.with_suffix(".json.tmp")  # type: ignore[union-attr]
    tmp.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, INDEX_FILE)  # type: ignore[union-attr]


def list_files() -> list[StoredFile]:
    """Return all stored files, newest first."""
    with _index_lock:
        entries = _load_index()
    return [StoredFile.from_dict(e) for e in sorted(entries, key=lambda e: e["added_at"], reverse=True)]


def get_file(file_id: str) -> Optional[StoredFile]:
    """Return a single stored file by ID, or None if not found."""
    for f in list_files():
        if f.id == file_id:
            return f
    return None


def total_bytes() -> int:
    """Sum of sizes of all stored files, in bytes."""
    return sum(f.size for f in list_files())


def total_bytes_human() -> str:
    """Sum of sizes of all stored files, human-formatted (e.g. '4.2 MB')."""
    return _humanize_bytes(total_bytes())


def storage_remaining_bytes() -> int:
    """Bytes still available before hitting the total storage cap."""
    return max(0, MAX_TOTAL_STORAGE_MB * 1024 * 1024 - total_bytes())


# ---------------------------------------------------------------------------
# Write / delete
# ---------------------------------------------------------------------------


class StorageFullError(Exception):
    """Raised when accepting an upload would exceed the total storage cap."""


def add_file(
    *,
    name: str,
    content_type: str,
    data: bytes,
) -> StoredFile:
    """Persist a new uploaded file and return its metadata.

    The file ID is a UUID4 and the on-disk path is `<UPLOADS_DIR>/<id>`.
    Raises StorageFullError if the upload would push us over MAX_TOTAL_STORAGE_MB.
    """
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError(f"data must be bytes, got {type(data).__name__}")

    size = len(data)
    if total_bytes() + size > MAX_TOTAL_STORAGE_MB * 1024 * 1024:
        raise StorageFullError(
            f"Upload would exceed {MAX_TOTAL_STORAGE_MB} MB total storage cap "
            f"(currently using {total_bytes_human()})."
        )

    file_id = uuid.uuid4().hex
    digest = hashlib.sha256(data).hexdigest()
    dest = UPLOADS_DIR / file_id  # type: ignore[operator]
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Write atomically.
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, dest)

    entry = StoredFile(
        id=file_id,
        name=name,
        size=size,
        content_type=content_type or "application/octet-stream",
        added_at=time.time(),
        sha256=digest,
    )

    with _index_lock:
        entries = _load_index()
        entries.append(entry.to_dict())
        _save_index(entries)

    return entry


def delete_file(file_id: str) -> bool:
    """Delete a file by id. Returns True if it existed."""
    with _index_lock:
        entries = _load_index()
        remaining = [e for e in entries if e["id"] != file_id]
        if len(remaining) == len(entries):
            return False
        _save_index(remaining)

    path = UPLOADS_DIR / file_id  # type: ignore[operator]
    if path.exists():
        try:
            path.unlink()
        except OSError:
            # Index says deleted even if unlink failed; let a future scrub clean up.
            pass
    return True


def read_file_bytes(file_id: str) -> Optional[bytes]:
    """Read raw bytes of a stored file by ID, or None if missing or ID is malformed.

    Guards against path traversal by requiring a 32-char lowercase hex ID.
    """
    if not all(c in "0123456789abcdef" for c in file_id) or len(file_id) != 32:
        return None
    path = UPLOADS_DIR / file_id  # type: ignore[operator]
    if not path.exists():
        return None
    return path.read_bytes()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _humanize_bytes(n: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    f = float(n)
    for unit in units:
        if f < 1024 or unit == units[-1]:
            return f"{f:.1f} {unit}" if unit != "B" else f"{int(f)} {unit}"
        f /= 1024
    return f"{n} B"
