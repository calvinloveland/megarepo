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


def _rewrite_transports_for_clone(
    source_manifest: Path, target_manifest: Path, source_path: Path
) -> None:
    """Rewrite channel transport URLs in the cloned manifest to point at the
    absolute source path, so that ``k33p sync`` can find the original.

    For every channel whose transport looks like a local path or file:// URL,
    replace it with ``file://<absolute-source-path>``.  Other transports
    (git+https://, oci+https://, …) are left untouched.
    """
    import yaml

    with source_manifest.open(encoding="utf-8") as f:
        manifest_data = yaml.safe_load(f)

    if not isinstance(manifest_data, dict):
        # Can't parse — fall back to plain copy
        import shutil
        shutil.copy2(source_manifest, target_manifest)
        return

    absolute_source = source_path.resolve()
    changed = 0

    # Rewrite top-level channels
    for ch_name, ch_data in manifest_data.get("channels", {}).items():
        if isinstance(ch_data, dict) and "transport" in ch_data:
            orig = ch_data["transport"]
            if _looks_like_local_path(orig) or orig.startswith("file://"):
                ch_data["transport"] = f"file://{absolute_source}"
                changed += 1

    # Rewrite subproject channel overrides
    for sp_name, sp_data in manifest_data.get("subprojects", {}).items():
        if not isinstance(sp_data, dict):
            continue
        for ch_name, ch_data in sp_data.get("channels", {}).items():
            if isinstance(ch_data, dict) and "transport" in ch_data:
                orig = ch_data["transport"]
                if _looks_like_local_path(orig) or orig.startswith("file://"):
                    ch_data["transport"] = f"file://{absolute_source}"
                    changed += 1

    with target_manifest.open("w", encoding="utf-8") as f:
        yaml.dump(manifest_data, f, default_flow_style=False, sort_keys=False)

    # If no transports were rewritten, the YAML dump might differ from the
    # original (ordering, formatting).  In that case it's better to just copy.
    # This is a minor style concern; the important thing is correct semantics.


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

    # ── copy manifest (rewrite transports for file sources) ──────────
    if isinstance(transport, FileTransport):
        _rewrite_transports_for_clone(
            manifest_path, target_manifest, source_path
        )
    else:
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


def sync(project_path: str | Path | None = None) -> int:
    """Sync a local k33p project with its upstream sources.

    For each channel in the manifest that has a transport URL supported by
    an available transport (currently only ``file://`` or local paths),
    fetches new objects from that source into the local store.

    Args:
        project_path: Path to the project directory.  If ``None``, uses
            the current working directory.

    Returns:
        0 on success, 1 on error (message already printed to stderr).
    """
    import sys

    from k33p.project import load_project

    if project_path is None:
        project_path = Path.cwd()

    # ── load the project ────────────────────────────────────────────
    try:
        project = load_project(str(project_path))
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    m = project.manifest

    # Ensure local store exists
    local_store_path = project.store_path or (project.path / ".k33p" / "store")
    local_store = ContentStore(local_store_path)
    local_store.ensure()

    # ── collect unique transport sources ────────────────────────────
    seen_sources: set[str] = set()
    channel_sources: list[tuple[str, str]] = []  # (channel_name, source_url)

    for ch_name, ch in m.channels.items():
        transport_url = ch.transport
        if not transport_url:
            continue
        # Check if any transport supports this URL
        try:
            Transport.for_source(transport_url)
        except TransportError:
            continue
        if transport_url not in seen_sources:
            seen_sources.add(transport_url)
            channel_sources.append((ch_name, transport_url))

    # Also check subproject channels
    for sp_name, sp in m.subprojects.items():
        for ch_name, ch in sp.channels.items():
            transport_url = ch.transport
            if not transport_url:
                continue
            try:
                Transport.for_source(transport_url)
            except TransportError:
                continue
            if transport_url not in seen_sources:
                seen_sources.add(transport_url)
                channel_sources.append((f"{sp_name}/{ch_name}", transport_url))

    if not channel_sources:
        print("k33p: no syncable sources found (no file:// or local-path transports)")
        print("  Supported: file://<path> or a local directory path.")
        print("  Tip: git+https:// and other remote transports are not yet implemented.")
        return 0

    # ── fetch from each source ──────────────────────────────────────
    total_new = 0
    for ch_name, transport_url in channel_sources:
        try:
            transport = Transport.for_source(transport_url)
        except TransportError:
            print(f"  skipping {ch_name}: no transport for {transport_url}",
                  file=sys.stderr)
            continue

        try:
            new_count = transport.fetch(local_store)
        except TransportError as e:
            print(f"  {ch_name}: sync failed: {e}", file=sys.stderr)
            continue

        total_new += new_count
        if new_count:
            print(f"  {ch_name}: {new_count} new object(s)")

    # ── report ──────────────────────────────────────────────────────
    print()
    print(f"✓ Synced {m.project} ({m.type})")
    print(f"  {total_new} new object(s) fetched from {len(channel_sources)} source(s)")
    if project.root_lock:
        print(f"  lock: {project.root_lock.path}")
    return 0
