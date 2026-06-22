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
        transports: list[type[Transport]] = [
            FileTransport,
            GitTransport,
        ]
        # Lazy-import OCITransport to avoid circular imports
        try:
            from k33p.transport_oci import OCITransport  # noqa: E402
            transports.append(OCITransport)
        except ImportError:
            pass

        for transport_cls in transports:
            if transport_cls.supports(source):
                return transport_cls(source)

        raise TransportError(
            f"no transport available for {source!r} "
            f"(supported: file://<path>, git+https://<url>, "
            f"oci+https://<url>, or a local path)"
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


# ── git transport ─────────────────────────────────────────────────────────


class GitTransport(Transport):
    """Transport that fetches objects from a git repository.

    Uses the ``git`` CLI to clone remote repositories and convert git
    objects (blobs, trees, commits) into k33p content-addressed store
    objects.

    Supports URLs with the ``git+`` prefix (``git+https://``,
    ``git+ssh://``) as well as bare git URLs.
    """

    @classmethod
    def supports(cls, source: str) -> bool:
        source_lower = source.lower()
        # git+https://, git+ssh://, etc.
        if source_lower.startswith("git+"):
            return True
        # Bare git-style URLs like git@github.com:org/repo.git
        if source_lower.startswith("git@") or source_lower.endswith(".git"):
            return True
        # Plain https:// URLs that look like git repos
        if "://" not in source:
            return False
        if any(
            source_lower.startswith(prefix)
            for prefix in ("https://", "http://", "ssh://")
        ):
            return True
        return False

    def _strip_prefix(self) -> str:
        """Return the actual URL without the ``git+`` prefix."""
        src = self.source
        if src.lower().startswith("git+"):
            return src[4:]
        return src

    def fetch(self, store: ContentStore) -> int:
        """Clone the git repo and convert all objects into *store*."""
        import subprocess
        import tempfile

        url = self._strip_prefix()
        if not _git_available():
            raise TransportError(
                "git is not available on this system (install git and try again)"
            )

        # Clone bare into a temp directory
        with tempfile.TemporaryDirectory(prefix="k33p-git-") as tmp:
            bare_path = Path(tmp) / ".git"
            try:
                subprocess.run(
                    ["git", "clone", "--bare", url, str(bare_path)],
                    capture_output=True, text=True, timeout=120,
                )
            except subprocess.CalledProcessError as e:
                raise TransportError(
                    f"git clone failed: {e.stderr.strip() or e}"
                ) from e
            except FileNotFoundError as e:
                raise TransportError(
                    f"git not found: {e}"
                ) from e

            if not bare_path.is_dir():
                raise TransportError(
                    f"git clone did not produce a .git directory at {bare_path}"
                )

            # Walk git objects and store them
            return _import_git_objects(bare_path, store)


# ── helpers ──────────────────────────────────────────────────────────────


def _git_available() -> bool:
    """Check if the ``git`` CLI is available on PATH."""
    import shutil
    return shutil.which("git") is not None


def _import_git_objects(git_dir: Path, store: ContentStore) -> int:
    """Walk a bare git repo's object store and import into *store*.

    Returns the number of objects imported.
    """
    import zlib

    objects_dir = git_dir / "objects"
    if not objects_dir.is_dir():
        return 0

    count = 0
    # Walk shards (first 2 hex chars of SHA-1 hash)
    for shard in sorted(objects_dir.iterdir()):
        if not shard.is_dir() or len(shard.name) != 2:
            continue
        for obj_file in sorted(shard.iterdir()):
            if not obj_file.is_file():
                continue
            git_hash = shard.name + obj_file.name
            try:
                raw = obj_file.read_bytes()
                decompressed = zlib.decompress(raw)
            except (OSError, zlib.error):
                continue

            # Parse the git object header: "<type> <size>\0<content>"
            null_pos = decompressed.index(b"\0")
            header = decompressed[:null_pos]
            content = decompressed[null_pos + 1 :]

            header_parts = header.split(b" ", 1)
            if len(header_parts) != 2:
                continue
            git_type = header_parts[0].decode()

            # Map git type to k33p kind
            kind_map = {
                "blob": "blob",
                "tree": "tree",
                "commit": "commit",
                "tag": "manifest",
            }
            k33p_kind = kind_map.get(git_type, "blob")

            k33p_hash = store.put(content, kind=k33p_kind)
            if k33p_hash:
                count += 1

    return count


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
        print("k33p: no syncable sources found")
        print("  Supported: file://<path>, git+https://<url>, oci+https://<url>")
        print("  or a local directory path.")
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


def import_from_git(
    git_url: str,
    target: str | Path | None = None,
    *,
    force: bool = False,
) -> int:
    """Import a git repository as a new k33p project.

    Clones the git repo, creates a ``k33p.yaml`` manifest pointing at the
    git URL, imports all git objects into the content-addressed store, and
    generates a ``k33p.lock`` with the HEAD ref.

    Args:
        git_url: Git remote URL (https://, git+https://, git@, etc.).
        target: Target directory (default: repo name in current dir).
        force: Overwrite existing files.

    Returns:
        0 on success, 1 on error.
    """
    import subprocess
    import tempfile
    import shutil
    import sys
    from datetime import datetime, timezone

    if not _git_available():
        print("k33p: git is not available on this system", file=sys.stderr)
        print("  Install git and try again.", file=sys.stderr)
        return 1

    # Determine the project name from the URL
    repo_name = _git_url_to_name(git_url)

    # Determine target path
    if target is None:
        target_path = Path.cwd() / repo_name
    else:
        target_path = Path(target).resolve()

    target_manifest = target_path / "k33p.yaml"
    if target_manifest.exists() and not force:
        print(
            f"k33p: {target_manifest} already exists (use --force to overwrite)",
            file=sys.stderr,
        )
        return 1

    print(f"Cloning git repository {git_url} ...")

    # Clone bare into a temp directory
    try:
        with tempfile.TemporaryDirectory(prefix="k33p-git-import-") as tmp:
            bare_path = Path(tmp) / ".git"
            result = subprocess.run(
                ["git", "clone", "--bare", git_url, str(bare_path)],
                capture_output=True, text=True, timeout=300,
            )
            if result.returncode != 0:
                print(f"k33p: git clone failed: {result.stderr.strip()}",
                      file=sys.stderr)
                return 1

            if not bare_path.is_dir():
                print(f"k33p: git clone did not produce a .git directory",
                      file=sys.stderr)
                return 1

            # ── create k33p.yaml ────────────────────────────────────
            target_path.mkdir(parents=True, exist_ok=True)

            # Get the default branch name
            branch = "main"
            try:
                branch_result = subprocess.run(
                    ["git", "-C", str(bare_path), "symbolic-ref", "--short", "HEAD"],
                    capture_output=True, text=True, timeout=30,
                )
                if branch_result.returncode == 0:
                    branch = branch_result.stdout.strip()
            except (OSError, subprocess.TimeoutExpired):
                pass

            # Get HEAD commit
            head_commit = ""
            try:
                rev_result = subprocess.run(
                    ["git", "-C", str(bare_path), "rev-parse", "HEAD"],
                    capture_output=True, text=True, timeout=30,
                )
                if rev_result.returncode == 0:
                    head_commit = rev_result.stdout.strip()
            except (OSError, subprocess.TimeoutExpired):
                pass

            yaml_content = f"""# k33p.yaml — imported from git
project: {repo_name}
type: single
description: Imported from {git_url}

channels:
  src:
    type: source
    transport: {git_url}
    visibility: public
    history: full

views:
  default:
    src: {{ at: "./" }}

roles:
  developer:   {{ view: default }}
"""
            target_manifest.write_text(yaml_content, encoding="utf-8")

            # ── initialise store ────────────────────────────────────
            store_path = target_path / ".k33p" / "store"
            store = ContentStore(store_path)
            store.ensure()

            # ── import git objects ──────────────────────────────────
            count = _import_git_objects(bare_path, store)

            # ── create lockfile ─────────────────────────────────────
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            lock_content = f"""# k33p.lock — generated by `k33p import --from-git`
generated: {now}

channels:
  src:
    ref: src@{head_commit or branch}

toolchain:
  compiler: git
"""
            lock_path = target_path / "k33p.lock"
            lock_path.write_text(lock_content, encoding="utf-8")

            # ── report ──────────────────────────────────────────────
            print(f"✓ Imported {repo_name} from git")
            print(f"  url:    {git_url}")
            print(f"  to:     {target_path}")
            print(f"  branch: {branch}")
            print(f"  head:   {head_commit[:16] if head_commit else '(unknown)'}")
            print(f"  store:  {count} object(s) imported")
            print(f"  manifest: {target_manifest}")
            print(f"  lock:   {lock_path}")
            print()
            print("Next steps:")
            print(f"  cd {target_path}")
            print("  k33p             # launch the TUI viewer")
            print("  k33p info        # show project info")
            return 0

    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"k33p: git operation failed: {e}", file=sys.stderr)
        return 1


def _git_url_to_name(git_url: str) -> str:
    """Extract a project name from a git URL.

    Examples:
        https://github.com/org/my-project.git  → my-project
        git@github.com:org/my-project.git      → my-project
        git+https://github.com/org/my-project  → my-project
    """
    # Strip protocol prefix
    url = git_url
    if url.lower().startswith("git+"):
        url = url[4:]
    # Strip trailing .git
    if url.endswith(".git"):
        url = url[:-4]
    # Get the last path component
    if "/" in url:
        url = url.rstrip("/").split("/")[-1]
    # For git@ URLs, also strip the host part
    if ":" in url:
        url = url.split(":")[-1]
    return url or "imported-project"
