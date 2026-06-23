"""
HomeCluster FUSE Mount — exposes the cluster namespace as /homecluster.

Provides a unified logical view of all storage across the cluster.

Layout:
  /homecluster/           → root (shows tracked directories)
  /homecluster/photos/    → logical directory from ClusterMetadata
  /homecluster/photos/vacation.jpg  → object stored in the cluster

Operations:
  - readdir: Lists directories/files from ClusterMetadata + object store metadata
  - getattr: Returns attributes from stored metadata
  - read: Fetches object content from local store (or peer)
  - write: Creates new content-addressed object, updates metadata
  - create: Registers a new file in directory tracking
  - mkdir: Registers a new logical directory
  - unlink: Removes a file from the directory

Requires: fusepy (pip install fusepy) or fusepy from nixpkgs.
"""

from __future__ import annotations

import argparse
import errno
import json
import logging
import os
import stat
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add warden module to path
WARDEN_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WARDEN_DIR))

log = logging.getLogger("homecluster.fuse")

# ── Optional FUSE import ─────────────────────────────────────────

fuse_available = False
try:
    import fuse

    fuse_available = True
except ImportError:
    pass

try:
    from fuse import FuseOSError, Operations, LoggingMixin
except ImportError:
    # Stub for when fusepy isn't installed
    class Operations:
        pass
    class FuseOSError(OSError):
        pass
    class LoggingMixin:
        pass


# ── FUSE Operations ──────────────────────────────────────────────


class HomeClusterFS(LoggingMixin, Operations):
    """FUSE filesystem for the HomeCluster namespace.

    Presents a unified logical view of all storage in the cluster
    backed by the object store and cluster metadata.
    """

    def __init__(
        self,
        store_root: str | os.PathLike[str],
        metadata_db: str | os.PathLike[str],
        mount_point: str = "/homecluster",
        readonly: bool = False,
    ) -> None:
        self.store_root = Path(store_root)
        self.metadata_db = Path(metadata_db)
        self.mount_point = Path(mount_point)
        self.readonly = readonly
        self._start_time = time.time()

        # Lazily initialized
        self._store: Any = None
        self._metadata: Any = None

    def _get_store(self):
        if self._store is None:
            from homecluster.object_store import ObjectStore
            self._store = ObjectStore(self.store_root)
        return self._store

    def _get_metadata(self):
        if self._metadata is None:
            from homecluster.metadata import ClusterMetadata
            self._metadata = ClusterMetadata(self.metadata_db)
        return self._metadata

    # ── Helpers ──────────────────────────────────────────────────

    def _is_root(self, path: str) -> bool:
        return path == "/"

    def _logical_path(self, path: str) -> str:
        """Convert FUSE path to logical path (strip leading /)."""
        return "/" + path.lstrip("/")

    def _get_meta_for_file(self, logical_path: str) -> dict[str, Any] | None:
        """Look up object metadata by logical path across all objects."""
        store = self._get_store()
        for oid in store.list_objects():
            meta = store.get_metadata(oid)
            if meta and meta.logical_path == logical_path:
                return {
                    "oid": oid,
                    "size": meta.size_bytes,
                    "created": meta.created_at,
                    "content_type": meta.content_type,
                }
        return None

    def _get_meta_for_dir(self, logical_path: str) -> dict[str, Any] | None:
        """Look up directory placement in cluster metadata."""
        meta = self._get_metadata()
        return meta.get_placement(logical_path)

    def _list_dir_contents(self, logical_path: str) -> list[dict[str, Any]]:
        """List files and subdirectories under a logical path."""
        meta = self._get_metadata()
        store = self._get_store()
        entries: list[dict[str, Any]] = []

        # Directories from ClusterMetadata that have this as parent
        placements = meta.list_placements()
        prefix = logical_path.rstrip("/") + "/"

        for p in placements:
            lp = p["logical_path"]
            if lp == logical_path:
                continue
            if lp.startswith(prefix):
                remainder = lp[len(prefix):]
                if "/" in remainder:
                    # Nested subdirectory — extract top-level
                    subdir = remainder.split("/")[0]
                    entry_name = subdir
                    if not any(e.get("name") == entry_name for e in entries):
                        entries.append({
                            "name": entry_name,
                            "type": "dir",
                            "size": 4096,
                        })
                else:
                    entries.append({
                        "name": remainder,
                        "type": "dir",
                        "size": 4096,
                    })

        # Files from object store metadata with this logical path prefix
        for oid in store.list_objects():
            obj_meta = store.get_metadata(oid)
            if obj_meta and obj_meta.logical_path:
                lp = obj_meta.logical_path
                if lp.startswith(prefix):
                    remainder = lp[len(prefix):]
                    if "/" not in remainder:
                        entries.append({
                            "name": remainder,
                            "type": "file",
                            "size": obj_meta.size_bytes,
                            "oid": oid,
                            "created": obj_meta.created_at,
                        })

        return entries

    # ── FUSE operations ──────────────────────────────────────────

    def getattr(self, path: str, fh: Any = None) -> dict[str, Any]:
        """Get file/directory attributes."""
        logical = self._logical_path(path)
        now = time.time()

        if self._is_root(path):
            return {
                "st_mode": stat.S_IFDIR | 0o755,
                "st_nlink": 2,
                "st_size": 4096,
                "st_ctime": now,
                "st_mtime": now,
                "st_atime": now,
                "st_uid": os.getuid(),
                "st_gid": os.getgid(),
            }

        # Check if it's a tracked directory
        dir_meta = self._get_meta_for_dir(logical)
        if dir_meta:
            # Get temperature-dependent access time
            temp = dir_meta.get("temperature", "cold")
            read_count = dir_meta.get("read_count", 0)
            return {
                "st_mode": stat.S_IFDIR | 0o755,
                "st_nlink": 2,
                "st_size": 4096,
                "st_ctime": now,
                "st_mtime": now,
                "st_atime": now,
                "st_uid": os.getuid(),
                "st_gid": os.getgid(),
            }

        # Check if it's a file in the object store
        file_meta = self._get_meta_for_file(logical)
        if file_meta:
            created_ts = 0
            try:
                created = datetime.fromisoformat(file_meta.get("created", ""))
                created_ts = created.timestamp()
            except (ValueError, TypeError):
                created_ts = now
            return {
                "st_mode": stat.S_IFREG | 0o644,
                "st_nlink": 1,
                "st_size": file_meta.get("size", 0),
                "st_ctime": created_ts,
                "st_mtime": created_ts,
                "st_atime": now,
                "st_uid": os.getuid(),
                "st_gid": os.getgid(),
            }

        # Check parent path — maybe a subdirectory of a tracked dir
        # This happens when we have /photos tracked and user stat's /photos/vacation
        # where vacation isn't a tracked placement
        parent = Path(logical).parent
        parent_meta = self._get_meta_for_dir(str(parent))
        if parent_meta:
            # It could be a file inside a tracked directory
            file_meta = self._get_meta_for_file(logical)
            if file_meta:
                created_ts = 0
                try:
                    created = datetime.fromisoformat(file_meta["created"])
                    created_ts = created.timestamp()
                except (ValueError, TypeError):
                    created_ts = now
                return {
                    "st_mode": stat.S_IFREG | 0o644,
                    "st_nlink": 1,
                    "st_size": file_meta["size"],
                    "st_ctime": created_ts,
                    "st_mtime": created_ts,
                    "st_atime": now,
                    "st_uid": os.getuid(),
                    "st_gid": os.getgid(),
                }

        raise FuseOSError(errno.ENOENT)

    def readdir(self, path: str, fh: Any) -> list[dict[str, Any]]:
        """List directory contents."""
        logical = self._logical_path(path)
        entries = [{"name": "."}, {"name": ".."}]

        contents = self._list_dir_contents(logical)
        for entry in contents:
            entries.append({"name": entry["name"]})

        return entries

    def read(self, path: str, size: int, offset: int, fh: Any) -> bytes:
        """Read file content from the object store."""
        logical = self._logical_path(path)
        store = self._get_store()

        file_meta = self._get_meta_for_file(logical)
        if file_meta is None:
            raise FuseOSError(errno.ENOENT)

        try:
            data = store.get(file_meta["oid"])
        except Exception as e:
            log.error("Failed to read object %s: %s", file_meta["oid"], e)
            raise FuseOSError(errno.EIO)

        # Record access for temperature tracking
        try:
            meta = self._get_metadata()
            meta.record_access(logical, read_count=1)
        except Exception:
            pass

        return data[offset:offset + size]

    def write(self, path: str, buf: bytes, offset: int, fh: Any) -> int:
        """Write content to a file.

        Creates a new content-addressed object. Writes are always
        appended or whole-file (no partial overwrite), since objects
        are immutable. A new object ID is created for each write.
        """
        if self.readonly:
            raise FuseOSError(errno.EROFS)

        logical = self._logical_path(path)
        store = self._get_store()

        # Get the existing object to determine content type
        content_type = "application/octet-stream"
        file_meta = self._get_meta_for_file(logical)
        if file_meta:
            existing = store.get_metadata(file_meta["oid"])
            if existing:
                content_type = existing.content_type

        # For offset 0, we replace the whole file content
        # For non-zero offset, we'd need to merge (not supported for MVP)
        # FUSE writes are typically whole-file for small files
        oid = store.put(
            buf,
            content_type=content_type,
            logical_path=logical,
        )

        # Record write access
        try:
            meta = self._get_metadata()
            meta.record_access(logical, write_count=1)
        except Exception:
            pass

        return len(buf)

    def create(self, path: str, mode: int, fi: Any = None) -> int:
        """Create a new file and register it in the object store."""
        if self.readonly:
            raise FuseOSError(errno.EROFS)

        logical = self._logical_path(path)
        store = self._get_store()

        # Store empty placeholder
        oid = store.put(
            b"",
            content_type="application/octet-stream",
            logical_path=logical,
        )

        # Record creation in metadata
        try:
            meta = self._get_metadata()
            meta.record_access(logical, write_count=1)
        except Exception:
            pass

        return 0

    def mkdir(self, path: str, mode: int) -> None:
        """Create a new logical directory."""
        logical = self._logical_path(path)
        meta = self._get_metadata()

        # Check if already exists
        existing = meta.get_placement(logical)
        if existing:
            raise FuseOSError(errno.EEXIST)

        # Register directory placement
        meta.set_directory_placement(logical, preferred_storage="any", replica_count=1)
        log.info("Created directory: %s", logical)

    def unlink(self, path: str) -> None:
        """Delete a file."""
        if self.readonly:
            raise FuseOSError(errno.EROFS)

        logical = self._logical_path(path)
        store = self._get_store()

        file_meta = self._get_meta_for_file(logical)
        if file_meta is None:
            raise FuseOSError(errno.ENOENT)

        store.delete(file_meta["oid"])
        log.info("Deleted: %s", logical)

    def rmdir(self, path: str) -> None:
        """Remove a logical directory."""
        if self.readonly:
            raise FuseOSError(errno.EROFS)

        logical = self._logical_path(path)
        meta = self._get_metadata()

        existing = meta.get_placement(logical)
        if existing is None:
            raise FuseOSError(errno.ENOENT)

        # Check if empty
        contents = self._list_dir_contents(logical)
        if contents:
            raise FuseOSError(errno.ENOTEMPTY)

        # Remove all replicas
        for replica in existing.get("replicas", []):
            meta.remove_replica(logical, replica["node_id"])

        log.info("Removed directory: %s", logical)

    def statfs(self, path: str) -> dict[str, int]:
        """Report filesystem statistics from the cluster."""
        store = self._get_store()
        total_objects = store.object_count()
        total_size = store.total_size()

        # Aggregate storage from metadata if available
        try:
            meta = self._get_metadata()
            summary = meta.cluster_summary()
            total_cap = summary.get("total_capacity_bytes", total_size) or total_size
            total_free = summary.get("total_free_bytes", total_size) or total_size
        except Exception:
            total_cap = total_size + (10 * 1024 ** 4)  # Assume 10TB
            total_free = total_cap - total_size

        return {
            "f_bsize": 4096,
            "f_blocks": total_cap // 4096,
            "f_bfree": total_free // 4096,
            "f_bavail": total_free // 4096,
            "f_files": max(1000, total_objects + 100),
            "f_ffree": 10000,
        }

    def chmod(self, path: str, mode: int) -> None:
        """No-op — we don't track permissions per file."""
        pass

    def chown(self, path: str, uid: int, gid: int) -> None:
        """No-op — we don't track ownership per file."""
        pass

    def utimens(self, path: str, times: tuple[float, float] | None = None) -> None:
        """No-op — timestamps are managed by the store."""
        pass

    def flush(self, path: str, fh: Any) -> None:
        """No-op — data is written immediately."""
        pass

    def fsync(self, path: str, datasync: bool, fh: Any) -> None:
        """No-op — data is already on disk."""
        pass

    def release(self, path: str, fh: Any) -> None:
        """No-op — nothing to release."""
        pass


# ── CLI ───────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="HomeCluster FUSE mount — /homecluster namespace"
    )
    parser.add_argument(
        "mountpoint",
        nargs="?",
        default="/homecluster",
        help="Mount point (default: /homecluster)",
    )
    parser.add_argument(
        "--store-root",
        default=None,
        help="Object store root directory",
    )
    parser.add_argument(
        "--metadata-db",
        default=None,
        help="Cluster metadata SQLite database path",
    )
    parser.add_argument(
        "--readonly",
        action="store_true",
        help="Mount read-only",
    )
    parser.add_argument(
        "--foreground",
        "-f",
        action="store_true",
        help="Run in foreground (don't daemonize)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Configure logging
    level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="[homecluster-fuse] %(message)s",
        stream=sys.stderr,
    )

    if not fuse_available:
        log.error(
            "fusepy is not installed. "
            "Install it with: pip install fusepy\n"
            "Or add python3Packages.fusepy to your Nix configuration."
        )
        sys.exit(1)

    # Resolve paths
    store_root = args.store_root or os.environ.get(
        "HOME_CLUSTER_STORE", "/var/lib/homecluster/objects"
    )
    metadata_db = args.metadata_db or os.environ.get(
        "HOME_CLUSTER_METADB", "/var/lib/homecluster/metadata.db"
    )

    mount_point = args.mountpoint

    log.info("Mounting HomeCluster at %s", mount_point)
    log.info("Store root: %s", store_root)
    log.info("Metadata DB: %s", metadata_db)
    log.info("Read-only: %s", args.readonly)

    fs = HomeClusterFS(
        store_root=store_root,
        metadata_db=metadata_db,
        mount_point=mount_point,
        readonly=args.readonly,
    )

    # Mount with FUSE
    fuse_opts = {
        "foreground": args.foreground,
        "allow_other": False,
        "debug": args.debug,
        "fsname": f"homecluster@{os.uname().nodename}",
        "subtype": "homecluster",
    }

    try:
        fuse.FUSE(
            fs,
            mount_point,
            **fuse_opts,  # type: ignore
        )
    except RuntimeError as e:
        if "Transport endpoint is not connected" in str(e):
            log.error(
                "Mount point %s is already in use. "
                "Unmount first: fusermount -u %s",
                mount_point,
                mount_point,
            )
        else:
            log.error("FUSE mount failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
