"""Transport abstraction for k33p — how objects move between stores.

A Transport knows how to fetch objects from a remote (or local) source
into a local ContentStore.  The base class defines the interface; concrete
implementations know about specific URL schemes (file://, git+https://,
oci+https://, k33p://).

For the MVP, only the ``file://`` transport is implemented.  It reads
objects from another k33p project's local store.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from k33p.store import ContentStore


# ── transport base ───────────────────────────────────────────────────────


class TransportError(RuntimeError):
    """Raised when a transport operation fails."""


class Transport(ABC):
    """Abstract base for all k33p transports.

    Every transport can *fetch* objects from a source into a local store.
    Future versions will also support *push* and *list*.
    """

    source: str

    def __init__(self, source: str) -> None:
        self.source = source

    @abstractmethod
    def fetch(self, store: ContentStore) -> int:
        """Fetch all available objects from the source into *store*.

        Args:
            store: The local ContentStore to populate.

        Returns:
            The number of objects fetched.
        """

    @classmethod
    @abstractmethod
    def supports(cls, source: str) -> bool:
        """Return True if this transport can handle *source*."""

    @classmethod
    def for_source(cls, source: str) -> Transport:
        """Factory: return the right Transport for *source*.

        Raises TransportError if no transport can handle the source.
        """
        for sub in cls.__subclasses__():
            t = sub  # noqa: F841
            # We use the concrete classes below, not dynamic subclass scan
            pass
        # Manual dispatch (more predictable than __subclasses__ scan)
        transports: list[type[Transport]] = [
            FileTransport,
        ]
        for transport_cls in transports:
            if transport_cls.supports(source):
                return transport_cls(source)

        raise TransportError(
            f"no transport available for {source!r} "
            f"(supported: file://<path>, or a local path)"
        )


# ── file transport ───────────────────────────────────────────────────────


class FileTransport(Transport):
    """Transport that reads objects from a local directory.

    The source must be a path to an existing k33p project directory
    (one that contains ``k33p.yaml`` and ``.k33p/store/``).  Supports
    bare paths (``/path/to/project``) and ``file://`` URLs.
    """

    @classmethod
    def supports(cls, source: str) -> bool:
        return source.startswith("file://") or _looks_like_local_path(source)

    def _resolve_path(self) -> Path:
        """Resolve the source string to a local directory."""
        src = self.source
        if src.startswith("file://"):
            src = src[len("file://"):]
        return Path(src).resolve()

    def fetch(self, store: ContentStore) -> int:
        """Copy all objects from the source store into *store*."""
        source_path = self._resolve_path()
        source_store_path = source_path / ".k33p" / "store"

        if not source_store_path.is_dir():
            raise TransportError(
                f"source {source_path} has no .k33p/store/ "
                f"(is it a k33p project?)"
            )

        source_store = ContentStore(source_store_path)

        if not source_store.exists:
            raise TransportError(f"source store not found at {source_store_path}")

        count = 0
        for obj in source_store.iter_objects():
            data = source_store.get(obj.hash)
            if data is None:
                continue
            # Check if we already have it (dedup)
            if not store.has(obj.hash):
                store.put(data, kind=obj.kind)
                count += 1

        return count


# ── helpers ──────────────────────────────────────────────────────────────


def _looks_like_local_path(source: str) -> bool:
    """Heuristic: is *source* a local path rather than a URL with a scheme?"""
    if "://" in source:
        return False
    # Relative or absolute path
    return True


def clone(source: str, target: str | Path | None = None, *, force: bool = False) -> int:
    """Clone a k33p project from *source* into a new directory *target*.

    Args:
        source: Transport URL or local path.
        target: Destination directory (will be created).  If ``None``, the
            project name from the source manifest is used in the current dir.
        force: Overwrite existing ``k33p.yaml`` in the target.

    Returns:
        0 on success, 1 on error (message already printed to stderr).
    """
    import sys
    import shutil

    from k33p.manifest import parse_manifest

    # ── resolve the transport ────────────────────────────────────────
    try:
        transport = Transport.for_source(source)
    except TransportError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1

    # ── resolve source directory ─────────────────────────────────────
    if isinstance(transport, FileTransport):
        source_path = transport._resolve_path()
    else:
        print(f"k33p: unsupported transport for clone", file=sys.stderr)
        return 1

    # ── load source manifest ─────────────────────────────────────────
    manifest_path = source_path / "k33p.yaml"
    if not manifest_path.exists():
        print(f"k33p: no k33p.yaml found at {source_path}", file=sys.stderr)
        return 1

    try:
        manifest = parse_manifest(manifest_path)
    except Exception as e:
        print(f"k33p: failed to parse source manifest: {e}", file=sys.stderr)
        return 1

    # ── determine target path ────────────────────────────────────────
    if target is None:
        target_path = Path.cwd() / manifest.project
    else:
        target_path = Path(target).resolve()

    target_manifest = target_path / "k33p.yaml"

    # ── prepare target directory ─────────────────────────────────────
    if target_manifest.exists() and not force:
        print(
            f"k33p: {target_manifest} already exists (use --force to overwrite)",
            file=sys.stderr,
        )
        return 1

    target_path.mkdir(parents=True, exist_ok=True)

    # ── copy manifest ────────────────────────────────────────────────
    shutil.copy2(manifest_path, target_manifest)

    # ── copy lock if present ─────────────────────────────────────────
    lock_path = source_path / "k33p.lock"
    if lock_path.exists():
        shutil.copy2(lock_path, target_path / "k33p.lock")

    # ── initialise target store ──────────────────────────────────────
    target_store_path = target_path / ".k33p" / "store"
    target_store = ContentStore(target_store_path)
    target_store.ensure()

    # ── fetch objects ────────────────────────────────────────────────
    try:
        count = transport.fetch(target_store)
    except TransportError as e:
        print(f"k33p: clone failed: {e}", file=sys.stderr)
        return 1

    # ── report ───────────────────────────────────────────────────────
    print(f"✓ Cloned {manifest.project} ({manifest.type})")
    print(f"  from:  {source_path}")
    print(f"  to:    {target_path}")
    print(f"  store: {count} object(s) fetched")
    print(f"  manifest: {target_manifest}")
    if lock_path.exists():
        print(f"  lock:  {target_path / 'k33p.lock'}")
    print()
    print("Next steps:")
    print(f"  cd {target_path}")
    print("  k33p             # launch the TUI viewer")
    print("  k33p info        # show project info")
    return 0
