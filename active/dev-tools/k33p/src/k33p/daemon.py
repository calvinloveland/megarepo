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
import subprocess
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from k33p.store import ContentStore
from k33p.transport import FileTransport as _FileTransport

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

    @property
    def poll_interval(self) -> float:
        """Seconds between file scans; config-driven with a 2s default."""
        ac = self.auto_commit_config
        if ac is None or ac.poll_interval is None:
            return 2.0
        return float(ac.poll_interval)

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

        Results are cached against a fingerprint of the ignore sources
        (every ``.gitignore`` file seen in the walk plus ``.git/info/exclude``)
        so we only re-spawn ``git`` when the ignore rules actually change.
        """
        import subprocess

        if not paths:
            return set()

        # Reuse cached results when the ignore sources are unchanged and the
        # requested paths are all known.
        sig = self._ignore_signature()
        cache = getattr(self, "_gitignore_cache", None)
        if cache is not None and cache[0] == sig:
            cached_map = cache[1]
            if all(p in cached_map for p in paths):
                return {p for p in paths if cached_map[p]}

        try:
            result = subprocess.run(
                ["git", "check-ignore", "--stdin"],
                input="\n".join(paths),
                capture_output=True, text=True, timeout=30,
                cwd=str(self._project_root),
            )
            if result.returncode == 0 and result.stdout:
                ignored = set(line.strip() for line in result.stdout.splitlines() if line.strip())
            else:
                ignored = set()
        except (OSError, subprocess.TimeoutExpired):
            return set()

        self._gitignore_cache = (sig, {p: (p in ignored) for p in paths})
        return ignored

    def _ignore_signature(self) -> tuple:
        """Fingerprint the ignore sources that affect ``git check-ignore``.

        Returns (path, mtime_ns) pairs for every ``.gitignore`` file seen by
        the most recent tree walk, plus ``.git/info/exclude``. Sorting is
        stable so the tuple is comparable across polls.
        """
        sig: list[tuple[str, int]] = []
        for p in getattr(self, "_ignore_files_seen", []):
            try:
                sig.append((str(p), p.stat().st_mtime_ns))
            except OSError:
                sig.append((str(p), -1))
        excl = self._project_root / ".git" / "info" / "exclude"
        try:
            sig.append((str(excl), excl.stat().st_mtime_ns))
        except OSError:
            sig.append((str(excl), -1))
        return tuple(sorted(sig))

    def _collect_watched_files(self) -> dict[str, float]:
        """Walk all watched paths and return {relative_path: mtime}.

        Excludes the daemon ignore list (k33p.yaml ``ignore``) and
        known-large directories; does NOT apply gitignore rules, so the
        caller can partition the result into source vs artifact files.

        Also records every ``.gitignore`` file encountered so
        ``_filter_gitignored`` can fingerprint the ignore sources and cache
        ``git check-ignore`` results until they actually change.
        """
        result: dict[str, float] = {}
        self._ignore_files_seen: list[Path] = []
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
                        if filename == ".gitignore":
                            self._ignore_files_seen.append(full)
                        rel = os.path.relpath(str(full), str(self._project_root))
                        if self._should_ignore(rel):
                            continue
                        try:
                            result[rel] = full.stat().st_mtime
                        except OSError:
                            pass
        return result

    def _scan_files(self) -> dict[str, float]:
        """Return {relative_path: mtime} for source (non-gitignored) files."""
        return self._collect_partitioned()[0]

    def _scan_artifact_files(self) -> dict[str, float]:
        """Return {relative_path: mtime} for gitignored (artifact) files.

        Artifacts are generated/derived files that .gitignore excludes from
        version control (backups, tool history, plotted outputs, …). The
        daemon content-addresses them into the CAS store instead of
        committing them to git.
        """
        return self._collect_partitioned()[1]

    def _collect_partitioned(
        self,
    ) -> tuple[dict[str, float], dict[str, float]]:
        """One walk + one gitignore filter, partitioned into
        ``(source_files, artifact_files)``.

        Both scan entry points use this so a poll cycle or commit never
        walks the tree or shells out to ``git`` more than once.
        """
        files = self._collect_watched_files()
        if not files:
            return {}, {}
        gitignored = self._filter_gitignored(list(files.keys()))
        source = {p: t for p, t in files.items() if p not in gitignored}
        artifacts = {p: t for p, t in files.items() if p in gitignored}
        return source, artifacts


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

    def _detect_artifact_changes(self) -> list[FileChange]:
        """Return artifact files that have changed since the last scan."""
        current = self._scan_artifact_files()
        previous = getattr(self, "_last_artifact_scan", {})
        changes: list[FileChange] = []
        for path, mtime in current.items():
            if path not in previous or previous[path] != mtime:
                changes.append(FileChange(path=path, mtime=mtime))
        self._last_artifact_scan = current
        return changes

    def _detect_partitioned_changes(
        self,
    ) -> tuple[list[FileChange], list[FileChange]]:
        """Detect source and artifact changes with one walk + one filter.

        Returns ``(source_changes, artifact_changes)`` and records both
        baselines so ``_do_commit`` snapshots everything changed since the
        previous poll, whether git-tracked or gitignored.
        """
        source, artifacts = self._collect_partitioned()

        prev_source = getattr(self, "_last_scan", {})
        prev_artifacts = getattr(self, "_last_artifact_scan", {})

        source_changes = [
            FileChange(path=path, mtime=mtime)
            for path, mtime in source.items()
            if path not in prev_source or prev_source[path] != mtime
        ]
        artifact_changes = [
            FileChange(path=path, mtime=mtime)
            for path, mtime in artifacts.items()
            if path not in prev_artifacts or prev_artifacts[path] != mtime
        ]

        self._last_scan = source
        self._last_artifact_scan = artifacts
        return source_changes, artifact_changes


    # ── snapshot / commit ─────────────────────────────────────────────

    def _build_tree(self, files: dict[str, float], *, kind: str = "blob") -> str | None:
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
            blob_hash = store.put(data, kind=kind)
            tree_entries.append(f"{kind} {rel_path}\0{blob_hash}")

        if not tree_entries:
            return None

        tree_content = "\n".join(tree_entries).encode()
        tree_hash = store.put(tree_content, kind="tree")
        return tree_hash

    def _create_commit(
        self, tree_hash: str, files_changed: list[str],
        *, artifact_tree_hash: str | None = None,
    ) -> str | None:
        """Create a commit object referencing *tree_hash*.

        When *artifact_tree_hash* is given, the commit also records the
        content-addressed tree of gitignored artifact files (backups,
        tool history, plotted outputs) that are NOT committed via git.

        Returns the commit hash, or None on failure.
        """
        from k33p.store import ContentStore

        store_path = self.project.store_path or (
            self._project_root / ".k33p" / "store"
        )
        store = ContentStore(store_path)
        store.ensure()

        now = datetime.now(UTC)
        timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Build commit content
        lines = [f"tree {tree_hash}"]
        if self.state.last_commit_hash:
            lines.append(f"parent {self.state.last_commit_hash}")
        if artifact_tree_hash:
            lines.append(f"artifacts {artifact_tree_hash}")
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

    def run(self, *, once: bool = False, poll_interval: float | None = None) -> int:
        """Run the daemon.

        Args:
            once: If True, do a single check and return.
            poll_interval: Seconds between file scans. ``None`` (default)
                uses the config value ``daemon.auto_commit.poll_interval``
                or 2s when unset.

        Returns:
            0 on success, 1 on error.
        """
        import sys

        if poll_interval is None:
            poll_interval = self.poll_interval

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
        self._last_scan, self._last_artifact_scan = self._collect_partitioned()
        if once:
            # Single-pass mode has no meaningful baseline: treat the current
            # state as new so the run snapshots everything already on disk.
            self._last_scan = {}
            self._last_artifact_scan = {}

        print(f"k33p daemon: watching {len(self.watched_paths)} path(s)", flush=True)
        for p in self.watched_paths:
            print(f"  watch: {p}", flush=True)
        print(f"  baseline files: {len(self._last_scan)}", flush=True)
        print(f"  debounce: {self.debounce_seconds}s", flush=True)
        print(f"  poll interval: {poll_interval}s", flush=True)

        while self.state.running:
            changes, artifact_changes = self._detect_partitioned_changes()

            if changes or artifact_changes:
                self.state.pending_changes.extend(changes)
                self.state.pending_changes.extend(artifact_changes)
                self.state.last_change_time = time.time()
                for c in changes + artifact_changes:
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
        """Create a commit from pending changes and reset.

        The commit records the source tree (non-gitignored files) and, when
        present, a content-addressed artifact tree of gitignored files so
        backups, history, and generated outputs are retained in the CAS
        while staying out of git.
        """
        changed_files = [c.path for c in self.state.pending_changes]

        # Get current file state (one walk + one gitignore filter)
        current_files, artifact_files = self._collect_partitioned()

        # Build tree
        tree_hash = self._build_tree(current_files)
        if tree_hash is None:
            self.state.pending_changes.clear()
            return

        # Content-address gitignored artifacts too (kept out of git)
        artifact_tree_hash = self._build_tree(artifact_files, kind="artifact")

        # Create commit
        commit_hash = self._create_commit(
            tree_hash, changed_files,
            artifact_tree_hash=artifact_tree_hash,
        )
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

        for _, ch in m.channels.items():
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

        # New (untracked) files never appear in ``git diff``; include them
        # explicitly so a host whose only changes are brand-new files still
        # gets a commit.  ``--exclude-standard`` keeps ignored files out,
        # matching the ``git add --all`` sweep below.
        try:
            result = subprocess.run(
                ["git", "ls-files", "--others", "--exclude-standard"],
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

        # Stage all changes in watched paths, including new files.
        try:
            watched = [os.path.relpath(str(p), str(self._project_root)) for p in self.watched_paths]
            subprocess.run(
                ["git", "add", "--all", "--"] + watched,
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
            commit_result = subprocess.run(
                ["git", "commit", "-m", msg],
                capture_output=True, text=True, timeout=30,
                cwd=str(self._project_root),
            )
            if commit_result.returncode != 0:
                print(f"  ⚠ git commit failed: {commit_result.stderr.strip()}")
                return 0
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
                stderr = result.stderr.strip()
                print(f"    ⚠ push stderr: {stderr}")
                lower = stderr.lower()
                if "non-fast-forward" in lower or "fetch first" in lower or "rejected" in lower:
                    print(f"    ↺ attempting automatic rebase onto {remote}/{branch}")
                    fetch = subprocess.run(
                        ["git", "fetch", remote, branch],
                        capture_output=True, text=True, timeout=120,
                        cwd=str(self._project_root),
                    )
                    if fetch.returncode != 0:
                        print(f"    ⚠ git fetch failed: {fetch.stderr.strip()}")
                        return len(changed)
                    rebase = subprocess.run(
                        ["git", "rebase", f"{remote}/{branch}"],
                        capture_output=True, text=True, timeout=120,
                        cwd=str(self._project_root),
                    )
                    if rebase.returncode != 0:
                        print(f"    ⚠ git rebase failed: {rebase.stderr.strip()}")
                        try:
                            subprocess.run(
                                ["git", "rebase", "--abort"],
                                capture_output=True, text=True, timeout=30,
                                cwd=str(self._project_root),
                            )
                        except (OSError, subprocess.TimeoutExpired):
                            pass
                        return len(changed)
                    retry = subprocess.run(
                        ["git", "push", remote, branch],
                        capture_output=True, text=True, timeout=120,
                        cwd=str(self._project_root),
                    )
                    if retry.returncode == 0:
                        print(f"    ✓ pushed after rebase ({len(changed)} file(s))")
                    else:
                        print(f"    ⚠ push retry failed: {retry.stderr.strip()}")
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
