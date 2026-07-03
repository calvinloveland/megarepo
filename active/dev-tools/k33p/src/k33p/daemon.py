"""Daemon for k33p — auto-commit, file watching, and background tasks.

The daemon watches configured paths in a k33p project, debounces file
changes, and creates content-addressed snapshots ("commits") in the store.

For the MVP, the daemon uses a simple polling loop (no inotify/fsevents
dependency).  It checks file modification times every few seconds and
creates a snapshot after a configurable debounce period of inactivity.
"""

from __future__ import annotations

import fnmatch
import os
import time
from pathlib import Path

from k33p.store import ContentStore
from k33p.transport import FileTransport as _FileTransport
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


# ── types ────────────────────────────────────────────────────────────────


@dataclass
class FileChange:
    """A single file change detected by the watcher."""

    path: str
    mtime: float


@dataclass
class DaemonState:
    """Runtime state of the daemon."""

    running: bool = False
    last_commit_hash: str | None = None
    commit_count: int = 0
    pending_changes: list[FileChange] = field(default_factory=list)
    last_change_time: float = 0.0
    start_time: float = 0.0
    last_commit_time: float = 0.0  # when the last commit was created
    last_push_time: float = 0.0    # when the last push was attempted


# ── daemon ───────────────────────────────────────────────────────────────


class Daemon:
    """A polling-based auto-commit daemon for a k33p project.

    Usage::

        daemon = Daemon(project)
        daemon.run(once=False)  # loop forever, or once=True for a single check
    """

    def __init__(self, project) -> None:
        self.project = project
        self.state = DaemonState()
        self._project_root = project.path

    # ── configuration ─────────────────────────────────────────────────

    @property
    def auto_commit_config(self):  # -> AutoCommitConfig | None
        """The effective auto_commit config for the project."""
        m = self.project.manifest
        if m.daemon and m.daemon.auto_commit:
            return m.daemon.auto_commit
        return None

    @property
    def watched_paths(self) -> list[Path]:
        """The paths to watch, resolved relative to the project root."""
        ac = self.auto_commit_config
        if ac is None or not ac.enabled:
            return []
        paths = ac.paths if ac.paths else ["."]
        return [(self._project_root / p).resolve() for p in paths]

    @property
    def ignore_patterns(self) -> list[str]:
        ac = self.auto_commit_config
        if ac is None:
            return []
        return ac.ignore

    @property
    def debounce_seconds(self) -> int:
        """Parse the debounce string (e.g. '5m', '30s', '1h') into seconds."""
        ac = self.auto_commit_config
        if ac is None:
            return 300  # default 5 minutes
        return _parse_duration(ac.debounce)

    def message_template(self) -> str:
        ac = self.auto_commit_config
        if ac is None:
            return "auto: changes in {files}"
        return ac.message

    @property
    def push_after_seconds(self) -> int | None:
        """Return ``push_after`` duration in seconds, or ``None`` if not set."""
        ac = self.auto_commit_config
        if ac is None or not ac.push_after:
            return None
        return _parse_duration(ac.push_after)

    # ── file scanning ─────────────────────────────────────────────────

    def _should_ignore(self, rel_path: str) -> bool:
        """Check if *rel_path* matches any ignore pattern.

        Checks both the k33p.yaml ``ignore`` list and the project's
        ``.gitignore`` rules (via ``git check-ignore --stdin``).
        """
        # First check config-based ignore patterns
        for pattern in self.ignore_patterns:
            if fnmatch.fnmatch(rel_path, pattern):
                return True
            norm_pattern = pattern.rstrip("/")
            for part in rel_path.split("/"):
                if fnmatch.fnmatch(part, norm_pattern):
                    return True
        return False

    def _filter_gitignored(self, paths: list[str]) -> set[str]:
        """Return the subset of *paths* that are gitignored.

        Uses ``git check-ignore --stdin`` for batch checking, which
        respects all ``.gitignore`` files (root + nested), negation
        patterns, etc.
        """
        import subprocess

        if not paths:
            return set()

        try:
            result = subprocess.run(
                ["git", "check-ignore", "--stdin"],
                input="\n".join(paths),
                capture_output=True, text=True, timeout=30,
                cwd=str(self._project_root),
            )
            if result.returncode == 0 and result.stdout:
                return set(line.strip() for line in result.stdout.splitlines() if line.strip())
            return set()
        except (OSError, subprocess.TimeoutExpired):
            return set()

    def _scan_files(self) -> dict[str, float]:
        """Scan all watched paths and return {relative_path: mtime}."""
        result: dict[str, float] = {}
        for watch_path in self.watched_paths:
            if not watch_path.exists():
                continue
            if watch_path.is_file():
                rel = os.path.relpath(str(watch_path), str(self._project_root))
                if not self._should_ignore(rel):
                    try:
                        result[rel] = watch_path.stat().st_mtime
                    except OSError:
                        pass
            elif watch_path.is_dir():
                for dirpath, dirnames, filenames in os.walk(watch_path):
                    # Skip known-large/ignored directories (hardcoded perf guard)
                    dirnames[:] = [
                        d for d in dirnames
                        if d not in (
                            ".k33p", ".git", "__pycache__",
                            "node_modules", ".venv", "venv",
                            "dist", "build", "out",
                            ".cache", "site", ".docs-site",
                        )
                    ]
                    # Also prune any directory whose relative path matches an
                    # ignore pattern (e.g. ``data/``, ``*.egg-info/``).
                    pruned: list[str] = []
                    for d in dirnames:
                        rel_dir = os.path.relpath(
                            os.path.join(dirpath, d),
                            str(self._project_root),
                        )
                        if not self._should_ignore(rel_dir):
                            pruned.append(d)
                    dirnames[:] = pruned
                    for filename in filenames:
                        full = Path(dirpath) / filename
                        rel = os.path.relpath(str(full), str(self._project_root))
                        if self._should_ignore(rel):
                            continue
                        try:
                            result[rel] = full.stat().st_mtime
                        except OSError:
                            pass

        # Filter out gitignored paths (respects all .gitignore rules)
        if result:
            gitignored = self._filter_gitignored(list(result.keys()))
            for p in gitignored:
                result.pop(p, None)

        return result

    def _detect_changes(self) -> list[FileChange]:
        """Return list of files that have changed since the last scan."""
        current = self._scan_files()
        previous = getattr(self, "_last_scan", {})
        changes: list[FileChange] = []
        for path, mtime in current.items():
            if path not in previous or previous[path] != mtime:
                changes.append(FileChange(path=path, mtime=mtime))
        self._last_scan = current
        return changes

    # ── snapshot / commit ─────────────────────────────────────────────

    def _build_tree(self, files: dict[str, float]) -> str | None:
        """Build a tree object from the scanned files and store it.

        Returns the hash of the tree object, or None if no files.
        """
        from k33p.store import ContentStore

        store_path = self.project.store_path or (
            self._project_root / ".k33p" / "store"
        )
        store = ContentStore(store_path)
        store.ensure()

        if not files:
            return None

        # Store each file as a blob
        tree_entries: list[str] = []
        for rel_path in sorted(files.keys()):
            full_path = self._project_root / rel_path
            if not full_path.exists() or not full_path.is_file():
                continue
            try:
                data = full_path.read_bytes()
            except (OSError, PermissionError):
                continue
            blob_hash = store.put(data, kind="blob")
            tree_entries.append(f"blob {rel_path}\0{blob_hash}")

        if not tree_entries:
            return None

        tree_content = "\n".join(tree_entries).encode()
        tree_hash = store.put(tree_content, kind="tree")
        return tree_hash

    def _create_commit(
        self, tree_hash: str, files_changed: list[str],
    ) -> str | None:
        """Create a commit object referencing *tree_hash*.

        Returns the commit hash, or None on failure.
        """
        from k33p.store import ContentStore

        store_path = self.project.store_path or (
            self._project_root / ".k33p" / "store"
        )
        store = ContentStore(store_path)
        store.ensure()

        now = datetime.now(timezone.utc)
        timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Build commit content
        lines = [f"tree {tree_hash}"]
        if self.state.last_commit_hash:
            lines.append(f"parent {self.state.last_commit_hash}")
        lines.append(f"author k33p-daemon <daemon@k33p> {timestamp}")
        lines.append("")

        # Generate message from template
        file_list = ", ".join(sorted(set(files_changed))[:10])
        if len(files_changed) > 10:
            file_list += f" (+{len(files_changed) - 10} more)"
        msg = self.message_template().format(files=file_list)
        lines.append(msg)

        commit_content = "\n".join(lines).encode()
        commit_hash = store.put(commit_content, kind="commit")

        self.state.last_commit_hash = commit_hash
        self.state.commit_count += 1
        return commit_hash

    # ── main loop ─────────────────────────────────────────────────────

    def run(self, *, once: bool = False, poll_interval: float = 2.0) -> int:
        """Run the daemon.

        Args:
            once: If True, do a single check and return.
            poll_interval: Seconds between file scans (default: 2s).

        Returns:
            0 on success, 1 on error.
        """
        import sys

        ac = self.auto_commit_config
        if ac is None or not ac.enabled:
            print("k33p daemon: auto_commit is not enabled in k33p.yaml",
                  file=sys.stderr)
            print("  Add a 'daemon:' section to enable it.", file=sys.stderr)
            return 1

        if not self.watched_paths:
            print("k33p daemon: no paths to watch", file=sys.stderr)
            return 1

        self.state.running = True
        self.state.start_time = time.time()
        self._last_scan: dict[str, float] = {}

        print(f"k33p daemon: watching {len(self.watched_paths)} path(s)", flush=True)
        for p in self.watched_paths:
            print(f"  watch: {p}", flush=True)
        print(f"  debounce: {self.debounce_seconds}s", flush=True)
        print(f"  poll interval: {poll_interval}s", flush=True)

        while self.state.running:
            changes = self._detect_changes()

            if changes:
                self.state.pending_changes.extend(changes)
                self.state.last_change_time = time.time()
                for c in changes:
                    print(f"  ✎ {c.path}", flush=True)

            # Check debounce
            if self.state.pending_changes:
                elapsed = time.time() - self.state.last_change_time
                if elapsed >= self.debounce_seconds or once:
                    self._do_commit()

            # Check push timer
            if not once and self.push_after_seconds is not None:
                push_elapsed = time.time() - self.state.last_commit_time
                if (self.state.last_commit_time > 0
                        and push_elapsed >= self.push_after_seconds
                        and time.time() - self.state.last_push_time >= self.push_after_seconds):
                    self._do_push()

            if once:
                self.state.running = False
                break

            time.sleep(poll_interval)

        return 0

    def _do_commit(self) -> None:
        """Create a commit from pending changes and reset."""
        changed_files = [c.path for c in self.state.pending_changes]

        # Get current file state
        current_files = self._scan_files()

        # Build tree
        tree_hash = self._build_tree(current_files)
        if tree_hash is None:
            self.state.pending_changes.clear()
            return

        # Create commit
        commit_hash = self._create_commit(tree_hash, changed_files)
        if commit_hash:
            print(f"  ✔ committed {commit_hash[:16]} ({len(changed_files)} file(s))", flush=True)
            self.state.last_commit_time = time.time()

        self.state.pending_changes.clear()

    def _do_push(self) -> None:
        """Push new objects to all transport sources.

        For each channel in the manifest that has a supported transport
        URL, sync local objects to the remote store.  For git transports
        this also creates git commits and pushes to the remote.
        """
        from k33p.transport import GitTransport, Transport, TransportError

        store_path = self.project.store_path or (
            self._project_root / ".k33p" / "store"
        )
        local_store = ContentStore(store_path)

        m = self.project.manifest
        pushed_any = False

        for ch_name, ch in m.channels.items():
            transport_url = ch.transport
            if not transport_url:
                continue
            try:
                transport = Transport.for_source(transport_url)
            except TransportError:
                continue

            # For FileTransport, push = copy new objects to the source
            if isinstance(transport, _FileTransport):
                try:
                    source_path = transport._resolve_path()
                    remote_store_path = source_path / ".k33p" / "store"
                    remote_store = ContentStore(remote_store_path)
                    remote_store.ensure()

                    count = 0
                    for obj in local_store.iter_objects():
                        if not remote_store.has(obj.hash):
                            data = local_store.get(obj.hash)
                            if data is not None:
                                remote_store.put(data, kind=obj.kind)
                                count += 1

                    if count > 0:
                        print(f"  ↑ pushed {count} object(s) to {transport_url}")
                        pushed_any = True
                except (TransportError, OSError) as e:
                    print(f"  ⚠ push to {transport_url} failed: {e}")

            # For GitTransport, create git commits and push
            elif isinstance(transport, GitTransport):
                try:
                    count = self._do_git_push(transport_url)
                    if count > 0:
                        pushed_any = True
                except Exception as e:
                    print(f"  ⚠ git push to {transport_url} failed: {e}")

        if pushed_any:
            self.state.last_push_time = time.time()
        else:
            print("  · nothing to push")

    # ── git commit + push ────────────────────────────────────────

    def _do_git_push(self, transport_url: str) -> int:
        """Create a git commit from pending changes and push to remote.

        Returns the number of files committed, or 0 if nothing changed.
        """
        ac = self.auto_commit_config
        if ac is None:
            return 0

        import subprocess

        # Build the list of changed files from pending changes and last scan
        changed = set()
        for change in self.state.pending_changes:
            changed.add(change.path)

        # Also check for any working-tree changes in watched paths
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", "--relative"] + [str(p) for p in self.watched_paths],
                capture_output=True, text=True, timeout=30,
                cwd=str(self._project_root),
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    line = line.strip()
                    if line:
                        changed.add(line)
        except (OSError, subprocess.TimeoutExpired):
            pass

        if not changed:
            return 0

        # Stage all changes in watched paths
        try:
            subprocess.run(
                ["git", "add", "--update"] + [str(p) for p in self.watched_paths],
                capture_output=True, timeout=30,
                cwd=str(self._project_root),
            )
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"  ⚠ git add failed: {e}")
            return 0

        # Check if there's anything to commit
        try:
            result = subprocess.run(
                ["git", "diff", "--cached", "--quiet"],
                capture_output=True, timeout=30,
                cwd=str(self._project_root),
            )
            if result.returncode == 0:
                # No staged changes
                return 0
        except (OSError, subprocess.TimeoutExpired):
            pass

        # Generate commit message from template
        file_list = ", ".join(sorted(changed)[:10])
        if len(changed) > 10:
            file_list += f" (+{len(changed) - 10} more)"
        msg = self.message_template().format(files=file_list)

        try:
            subprocess.run(
                ["git", "commit", "-m", msg],
                capture_output=True, timeout=30,
                cwd=str(self._project_root),
            )
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"  ⚠ git commit failed: {e}")
            return 0

        # Push to the remote
        remote = "origin"
        branch = "main"
        try:
            # Detect current branch
            br_result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, timeout=10,
                cwd=str(self._project_root),
            )
            if br_result.returncode == 0:
                branch = br_result.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            pass

        print(f"  ↑ git push {remote}/{branch}")
        try:
            result = subprocess.run(
                ["git", "push", remote, branch],
                capture_output=True, text=True, timeout=120,
                cwd=str(self._project_root),
            )
            if result.returncode == 0:
                print(f"    ✓ pushed {len(changed)} file(s) to {transport_url}")
            else:
                print(f"    ⚠ push stderr: {result.stderr.strip()}")
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"  ⚠ git push failed: {e}")

        return len(changed)

    def stop(self) -> None:
        """Signal the daemon to stop."""
        self.state.running = False


# ── duration parsing ─────────────────────────────────────────────────────


def _parse_duration(text: str) -> int:
    """Parse a duration string like '5m', '30s', '1h', '2h30m' into seconds."""
    import re

    total = 0
    # Match patterns like 2h, 30m, 15s
    for match in re.finditer(r"(\d+)\s*([hms])", text.lower()):
        value = int(match.group(1))
        unit = match.group(2)
        if unit == "h":
            total += value * 3600
        elif unit == "m":
            total += value * 60
        elif unit == "s":
            total += value
    if total == 0:
        # Try plain number (assume seconds)
        try:
            total = int(text)
        except ValueError:
            total = 300  # default 5 minutes
    return total


# ── CLI helper ───────────────────────────────────────────────────────────


def run_daemon(project_path: str | None = None, *, once: bool = False) -> int:
    """Load a project and run the daemon.

    Args:
        project_path: Path to the project (default: current dir).
        once: If True, do a single check and return (useful for testing).

    Returns:
        0 on success, 1 on error.
    """
    import sys

    from k33p.project import load_project

    path = project_path or "."
    try:
        project = load_project(path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    daemon = Daemon(project)
    return daemon.run(once=once)
