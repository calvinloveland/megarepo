#!/usr/bin/env python3
"""
HomeCluster Access Tracker — directory-level read/write telemetry.

Monitors configured directories for access activity and feeds the
data into ClusterMetadata for temperature calculation.

Uses periodic stat() polling to detect atime/mtime changes:
- atime change → read
- mtime change → write

This avoids external dependencies (no inotify-tools required) and
works on all POSIX filesystems.

Usage:
  homecluster_access_tracker --watch /photos,/projects --interval 60

Or as a systemd service:
  homecluster_access_tracker --daemon
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add warden module to path
WARDEN_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WARDEN_DIR))


# ── FileStat tracking ─────────────────────────────────────────────


class FileAccessSnapshot:
    """Captures atime/mtime/size for a set of paths to detect changes."""

    def __init__(self) -> None:
        self._stats: dict[str, dict[str, float]] = {}

    def scan(self, root_dir: str | os.PathLike[str]) -> dict[str, dict[str, float]]:
        """Scan a directory tree and return current stat snapshot.

        Returns dict mapping relative_path → {atime, mtime, size}.
        """
        snapshot: dict[str, dict[str, float]] = {}
        root = Path(root_dir)

        if not root.exists():
            return snapshot

        for entry in root.rglob("*"):
            if not entry.is_file():
                continue
            try:
                st = entry.stat()
                rel = str(entry.relative_to(root))
                snapshot[rel] = {
                    "atime": st.st_atime,
                    "mtime": st.st_mtime,
                    "size": st.st_size,
                }
            except (OSError, PermissionError, ValueError):
                continue

        return snapshot

    def compare(
        self,
        current: dict[str, dict[str, float]],
        previous: dict[str, dict[str, float]] | None = None,
    ) -> dict[str, dict[str, int]]:
        """Compare two snapshots and count reads and writes.

        Returns dict mapping relative_path → {reads, writes}.
        """
        if previous is None:
            previous = self._stats

        changes: dict[str, dict[str, int]] = {}

        all_paths = set(current.keys()) | set(previous.keys())

        for path in all_paths:
            cur = current.get(path)
            prev = previous.get(path)

            if cur is None:
                # File was deleted — no activity
                continue
            if prev is None:
                # New file — counts as 1 write
                changes[path] = {"reads": 0, "writes": 1, "size": cur.get("size", 0)}
                continue

            reads = 0
            writes = 0

            # atime change → read activity
            if cur.get("atime", 0) > prev.get("atime", 0):
                reads = 1

            # mtime change → write activity
            if cur.get("mtime", 0) > prev.get("mtime", 0):
                writes = 1

            if reads > 0 or writes > 0:
                changes[path] = {
                    "reads": reads,
                    "writes": writes,
                    "size": cur.get("size", 0),
                }

        return changes

    def aggregate_by_directory(
        self,
        changes: dict[str, dict[str, int]],
    ) -> dict[str, dict[str, int]]:
        """Aggregate file-level changes up to directory level.

        Groups changes by parent directory and sums reads/writes.
        """
        dirs: dict[str, dict[str, int]] = {}

        for path, counts in changes.items():
            parent = str(Path(path).parent)
            if parent not in dirs:
                dirs[parent] = {"reads": 0, "writes": 0, "files_changed": 0}
            dirs[parent]["reads"] += counts.get("reads", 0)
            dirs[parent]["writes"] += counts.get("writes", 0)
            dirs[parent]["files_changed"] += 1

        return dirs


# ── Metadata DB integration ──────────────────────────────────────


def record_access_counts(
    db_path: str | os.PathLike[str],
    dir_changes: dict[str, dict[str, int]],
) -> int:
    """Record aggregated directory access counts into ClusterMetadata.

    Returns number of directories updated.
    """
    try:
        from homecluster.metadata import ClusterMetadata

        meta = ClusterMetadata(db_path)
        count = 0

        for directory, counts in dir_changes.items():
            reads = counts.get("reads", 0)
            writes = counts.get("writes", 0)
            if reads > 0 or writes > 0:
                # Prepend / to make it a logical path
                logical = f"/{directory}" if not directory.startswith("/") else directory
                meta.record_access(logical, read_count=reads, write_count=writes)
                count += 1

        return count
    except ImportError as e:
        print(f"[access-tracker] Import error: {e}", file=sys.stderr)
        return 0
    except Exception as e:
        print(f"[access-tracker] DB error: {e}", file=sys.stderr)
        return 0


# ── Main loop ─────────────────────────────────────────────────────


def run_tracker(
    watch_dirs: list[str],
    interval: int = 60,
    db_path: str | None = None,
    metadata_db: str | None = None,
    one_shot: bool = False,
) -> None:
    """Run the access tracker loop.

    Args:
        watch_dirs: List of directories to monitor
        interval: Poll interval in seconds
        db_path: Path to state file (unused, kept for compat)
        metadata_db: Path to cluster metadata SQLite database
        one_shot: Run once and exit (for testing)
    """
    if metadata_db is None:
        metadata_db = os.environ.get(
            "HOME_CLUSTER_METADB", "/var/lib/homecluster/metadata.db"
        )

    scanner = FileAccessSnapshot()
    previous_snapshots: dict[str, dict[str, dict[str, float]]] = {}

    print(f"[access-tracker] Watching: {', '.join(watch_dirs)}", file=sys.stderr)
    print(f"[access-tracker] Interval: {interval}s", file=sys.stderr)
    print(f"[access-tracker] Metadata DB: {metadata_db}", file=sys.stderr)

    iteration = 0

    while True:
        iteration += 1
        total_dirs_updated = 0
        total_files_changed = 0

        for watch_dir in watch_dirs:
            if not os.path.isdir(watch_dir):
                continue

            # Scan current state
            current = scanner.scan(watch_dir)
            previous = previous_snapshots.get(watch_dir)

            # Compare and detect changes
            changes = scanner.compare(current, previous)
            dir_changes = scanner.aggregate_by_directory(changes)

            # Record to metadata DB
            if dir_changes:
                updated = record_access_counts(metadata_db, dir_changes)
                total_dirs_updated += updated
                total_files_changed += sum(
                    d.get("files_changed", 0) for d in dir_changes.values()
                )

            # Save snapshot for next iteration
            previous_snapshots[watch_dir] = current

        if total_files_changed > 0:
            print(
                f"[access-tracker] Iteration {iteration}: "
                f"{total_dirs_updated} dirs, {total_files_changed} files changed",
                file=sys.stderr,
            )

        if one_shot:
            break

        time.sleep(interval)


# ── CLI ───────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="HomeCluster Access Tracker — directory-level read/write telemetry"
    )
    parser.add_argument(
        "--watch",
        help="Comma-separated list of directories to watch",
        default="/home",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=60,
        help="Poll interval in seconds (default: 60)",
    )
    parser.add_argument(
        "--metadata-db",
        help="Path to cluster metadata SQLite database",
        default=None,
    )
    parser.add_argument(
        "--one-shot",
        action="store_true",
        help="Run once and exit (for testing)",
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run as a daemon (same as default)",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    watch_dirs = [d.strip() for d in args.watch.split(",") if d.strip()]

    # Validate watch dirs
    valid_dirs = []
    for d in watch_dirs:
        p = Path(d).expanduser().resolve()
        if p.exists() and p.is_dir():
            valid_dirs.append(str(p))
        else:
            print(
                f"[access-tracker] Warning: {d} does not exist, skipping",
                file=sys.stderr,
            )

    if not valid_dirs:
        print(
            "[access-tracker] Error: No valid watch directories specified",
            file=sys.stderr,
        )
        sys.exit(1)

    run_tracker(
        watch_dirs=valid_dirs,
        interval=args.interval,
        metadata_db=args.metadata_db,
        one_shot=args.one_shot,
    )


if __name__ == "__main__":
    main()
