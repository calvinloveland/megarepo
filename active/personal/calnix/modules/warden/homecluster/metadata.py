"""
Cluster metadata management for HomeCluster.

Tracks nodes, directories, object placement, and replication state.
Designed to run on the Parent Warden (coordinator node).

Uses SQLite for persistent state.

Schema:
    nodes(
        node_id TEXT PRIMARY KEY,
        hostname TEXT,
        online INTEGER,
        last_seen TEXT,
        total_capacity_bytes INTEGER,
        total_free_bytes INTEGER
    )
    node_storage(
        node_id TEXT REFERENCES nodes(node_id),
        mount TEXT,
        capacity_bytes INTEGER,
        free_bytes INTEGER,
        storage_class TEXT
    )
    directory_placements(
        logical_path TEXT PRIMARY KEY,
        preferred_storage TEXT,
        replica_count INTEGER,
        temperature TEXT,
        read_count INTEGER DEFAULT 0,
        write_count INTEGER DEFAULT 0,
        last_access TEXT
    )
    directory_replicas(
        logical_path TEXT REFERENCES directory_placements(logical_path),
        node_id TEXT REFERENCES nodes(node_id),
        oid TEXT,
        size_bytes INTEGER,
        verified INTEGER DEFAULT 1
    )
    policies(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path_pattern TEXT,
        preferred_storage TEXT,
        replica_count INTEGER,
        priority INTEGER DEFAULT 0
    )
"""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class NodeStorage:
    """Storage resources reported by a node."""

    node_id: str
    hostname: str
    online: bool
    last_seen: str
    mounts: list[dict[str, Any]] = field(default_factory=list)

    @property
    def total_capacity_bytes(self) -> int:
        return sum(m.get("capacity_bytes", 0) for m in self.mounts)

    @property
    def total_free_bytes(self) -> int:
        return sum(m.get("free_bytes", 0) for m in self.mounts)

    @property
    def total_used_bytes(self) -> int:
        return self.total_capacity_bytes - self.total_free_bytes

    @property
    def used_pct(self) -> float:
        if self.total_capacity_bytes == 0:
            return 0.0
        return round((self.total_used_bytes / self.total_capacity_bytes) * 100, 1)


@dataclass
class DirectoryPlacement:
    """Placement and access tracking for a directory."""

    logical_path: str
    preferred_storage: str = "any"
    replica_count: int = 1
    temperature: str = "cold"  # hot, warm, cold, archive
    read_count: int = 0
    write_count: int = 0
    last_access: str = ""
    replicas: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class PlacementRule:
    """A placement policy rule."""

    path_pattern: str
    preferred_storage: str = "any"
    replica_count: int = 1
    priority: int = 0


class ClusterMetadata:
    """SQLite-backed cluster metadata store.

    Thread-safe via connection-level locking.
    Designed for the Parent Warden role.
    """

    def __init__(self, db_path: str | os.PathLike[str]) -> None:
        self.db_path = Path(db_path)
        self._lock = threading.RLock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        """Create tables if they don't exist."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA foreign_keys=ON")

                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS nodes (
                        node_id TEXT PRIMARY KEY,
                        hostname TEXT NOT NULL,
                        online INTEGER DEFAULT 0,
                        last_seen TEXT,
                        total_capacity_bytes INTEGER DEFAULT 0,
                        total_free_bytes INTEGER DEFAULT 0
                    );
                    CREATE TABLE IF NOT EXISTS node_storage (
                        node_id TEXT REFERENCES nodes(node_id) ON DELETE CASCADE,
                        mount TEXT NOT NULL,
                        capacity_bytes INTEGER DEFAULT 0,
                        free_bytes INTEGER DEFAULT 0,
                        storage_class TEXT DEFAULT 'unknown',
                        PRIMARY KEY (node_id, mount)
                    );
                    CREATE TABLE IF NOT EXISTS directory_placements (
                        logical_path TEXT PRIMARY KEY,
                        preferred_storage TEXT DEFAULT 'any',
                        replica_count INTEGER DEFAULT 1,
                        temperature TEXT DEFAULT 'cold',
                        read_count INTEGER DEFAULT 0,
                        write_count INTEGER DEFAULT 0,
                        last_access TEXT
                    );
                    CREATE TABLE IF NOT EXISTS directory_replicas (
                        logical_path TEXT REFERENCES directory_placements(logical_path) ON DELETE CASCADE,
                        node_id TEXT NOT NULL,
                        oid TEXT,
                        size_bytes INTEGER DEFAULT 0,
                        verified INTEGER DEFAULT 1,
                        PRIMARY KEY (logical_path, node_id)
                    );
                    CREATE TABLE IF NOT EXISTS policies (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        path_pattern TEXT NOT NULL,
                        preferred_storage TEXT DEFAULT 'any',
                        replica_count INTEGER DEFAULT 1,
                        priority INTEGER DEFAULT 0
                    );
                    CREATE INDEX IF NOT EXISTS idx_replicas_node ON directory_replicas(node_id);
                    CREATE INDEX IF NOT EXISTS idx_replicas_path ON directory_replicas(logical_path);
                    CREATE INDEX IF NOT EXISTS idx_policies_pattern ON policies(path_pattern);
                """)
                conn.commit()
            finally:
                conn.close()

    # ── Node management ───────────────────────────────────────────

    def register_node(
        self,
        node_id: str,
        hostname: str,
        mounts: list[dict[str, Any]],
    ) -> None:
        """Register or update a node's storage resources."""
        total_capacity = sum(m.get("capacity_bytes", 0) for m in mounts)
        total_free = sum(m.get("free_bytes", 0) for m in mounts)

        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO nodes
                       (node_id, hostname, online, last_seen,
                        total_capacity_bytes, total_free_bytes)
                       VALUES (?, ?, 1, ?, ?, ?)""",
                    (node_id, hostname, _utcnow(), total_capacity, total_free),
                )

                # Replace mount info
                conn.execute("DELETE FROM node_storage WHERE node_id = ?", (node_id,))
                for m in mounts:
                    conn.execute(
                        """INSERT INTO node_storage
                           (node_id, mount, capacity_bytes, free_bytes, storage_class)
                           VALUES (?, ?, ?, ?, ?)""",
                        (
                            node_id,
                            m.get("mount", ""),
                            m.get("capacity_bytes", 0),
                            m.get("free_bytes", 0),
                            m.get("storage_class", "unknown"),
                        ),
                    )
                conn.commit()
            finally:
                conn.close()

    def mark_node_offline(self, node_id: str) -> None:
        """Mark a node as offline."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute(
                    "UPDATE nodes SET online = 0, last_seen = ? WHERE node_id = ?",
                    (_utcnow(), node_id),
                )
                conn.commit()
            finally:
                conn.close()

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        """Get node details including mounts."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM nodes WHERE node_id = ?", (node_id,)
                ).fetchone()
                if row is None:
                    return None
                node = dict(row)
                node["online"] = bool(node["online"])

                # Get mounts
                mounts = conn.execute(
                    "SELECT * FROM node_storage WHERE node_id = ?",
                    (node_id,),
                ).fetchall()
                node["mounts"] = [dict(m) for m in mounts]
                return node
            finally:
                conn.close()

    def list_nodes(self) -> list[dict[str, Any]]:
        """List all registered nodes."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("SELECT * FROM nodes ORDER BY hostname").fetchall()
                nodes = []
                for row in rows:
                    node = dict(row)
                    node["online"] = bool(node["online"])
                    mounts = conn.execute(
                        "SELECT * FROM node_storage WHERE node_id = ?",
                        (node["node_id"],),
                    ).fetchall()
                    node["mounts"] = [dict(m) for m in mounts]
                    nodes.append(node)
                return nodes
            finally:
                conn.close()

    def cluster_summary(self) -> dict[str, Any]:
        """Get a summary of the entire cluster storage pool."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row

                nodes = conn.execute("SELECT * FROM nodes").fetchall()
                total_capacity = sum(n["total_capacity_bytes"] for n in nodes)
                total_free = sum(n["total_free_bytes"] for n in nodes)
                online_count = sum(1 for n in nodes if n["online"])
                total_count = len(nodes)

                # Storage by class
                by_class = conn.execute(
                    """SELECT ns.storage_class,
                              SUM(ns.capacity_bytes) as capacity_bytes,
                              SUM(ns.free_bytes) as free_bytes,
                              COUNT(DISTINCT ns.node_id) as node_count,
                              COUNT(*) as mount_count
                       FROM node_storage ns
                       GROUP BY ns.storage_class"""
                ).fetchall()

                # Directories tracked
                dir_count = conn.execute(
                    "SELECT COUNT(*) as c FROM directory_placements"
                ).fetchone()["c"]

                # Replica count
                replica_count = conn.execute(
                    "SELECT COUNT(*) as c FROM directory_replicas"
                ).fetchone()["c"]

                return {
                    "node_count": total_count,
                    "online_count": online_count,
                    "offline_count": total_count - online_count,
                    "total_capacity_bytes": total_capacity,
                    "total_free_bytes": total_free,
                    "total_used_bytes": total_capacity - total_free,
                    "total_used_pct": round(
                        (1 - total_free / total_capacity) * 100, 1
                    ) if total_capacity else 0,
                    "by_class": {
                        row["storage_class"]: {
                            "capacity_bytes": row["capacity_bytes"],
                            "free_bytes": row["free_bytes"],
                            "node_count": row["node_count"],
                            "mount_count": row["mount_count"],
                        }
                        for row in by_class
                    },
                    "directory_count": dir_count,
                    "replica_count": replica_count,
                }
            finally:
                conn.close()

    # ── Directory placement ───────────────────────────────────────

    def set_directory_placement(
        self,
        logical_path: str,
        preferred_storage: str = "any",
        replica_count: int = 1,
    ) -> None:
        """Set placement policy for a directory."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO directory_placements
                       (logical_path, preferred_storage, replica_count, last_access)
                       VALUES (?, ?, ?, ?)""",
                    (logical_path, preferred_storage, replica_count, _utcnow()),
                )
                conn.commit()
            finally:
                conn.close()

    def add_replica(
        self,
        logical_path: str,
        node_id: str,
        oid: str | None = None,
        size_bytes: int = 0,
    ) -> None:
        """Record a replica of a directory on a node."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO directory_replicas
                       (logical_path, node_id, oid, size_bytes)
                       VALUES (?, ?, ?, ?)""",
                    (logical_path, node_id, oid, size_bytes),
                )
                conn.commit()
            finally:
                conn.close()

    def remove_replica(self, logical_path: str, node_id: str) -> None:
        """Remove a replica record."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute(
                    "DELETE FROM directory_replicas WHERE logical_path = ? AND node_id = ?",
                    (logical_path, node_id),
                )
                conn.commit()
            finally:
                conn.close()

    def get_placement(self, logical_path: str) -> dict[str, Any] | None:
        """Get full placement info for a directory."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM directory_placements WHERE logical_path = ?",
                    (logical_path,),
                ).fetchone()
                if row is None:
                    return None
                placement = dict(row)

                replicas = conn.execute(
                    """SELECT r.*, n.hostname, n.online
                       FROM directory_replicas r
                       JOIN nodes n ON r.node_id = n.node_id
                       WHERE r.logical_path = ?""",
                    (logical_path,),
                ).fetchall()
                placement["replicas"] = [
                    {
                        "node_id": r["node_id"],
                        "hostname": r["hostname"],
                        "online": bool(r["online"]),
                        "oid": r["oid"],
                        "size_bytes": r["size_bytes"],
                        "verified": bool(r["verified"]),
                    }
                    for r in replicas
                ]
                return placement
            finally:
                conn.close()

    def list_placements(self) -> list[dict[str, Any]]:
        """List all directory placements with replica info."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT * FROM directory_placements ORDER BY logical_path"
                ).fetchall()

                result = []
                for row in rows:
                    placement = dict(row)
                    replicas = conn.execute(
                        "SELECT * FROM directory_replicas WHERE logical_path = ?",
                        (placement["logical_path"],),
                    ).fetchall()
                    placement["replicas"] = [dict(r) for r in replicas]
                    placement["replica_count_current"] = len(replicas)
                    result.append(placement)

                return result
            finally:
                conn.close()

    # ── Access tracking ───────────────────────────────────────────

    def record_access(
        self,
        logical_path: str,
        read_count: int = 0,
        write_count: int = 0,
    ) -> None:
        """Record read/write access for a directory."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.execute(
                    """UPDATE directory_placements
                       SET read_count = read_count + ?,
                           write_count = write_count + ?,
                           last_access = ?
                       WHERE logical_path = ?""",
                    (read_count, write_count, _utcnow(), logical_path),
                )
                if conn.total_changes == 0:
                    # Path not tracked yet; insert
                    conn.execute(
                        """INSERT INTO directory_placements
                           (logical_path, read_count, write_count, last_access)
                           VALUES (?, ?, ?, ?)""",
                        (logical_path, read_count, write_count, _utcnow()),
                    )
                conn.commit()
            finally:
                conn.close()

    # ── Placement policies ────────────────────────────────────────

    def add_policy(
        self,
        path_pattern: str,
        preferred_storage: str = "any",
        replica_count: int = 1,
        priority: int = 0,
    ) -> int:
        """Add a placement policy rule. Returns the policy ID."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.execute(
                    """INSERT INTO policies
                       (path_pattern, preferred_storage, replica_count, priority)
                       VALUES (?, ?, ?, ?)""",
                    (path_pattern, preferred_storage, replica_count, priority),
                )
                conn.commit()
                return cursor.lastrowid or 0
            finally:
                conn.close()

    def list_policies(self) -> list[dict[str, Any]]:
        """List all policies, ordered by priority (highest first)."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT * FROM policies ORDER BY priority DESC, id ASC"
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()

    def delete_policy(self, policy_id: int) -> bool:
        """Delete a policy rule by ID."""
        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                cursor = conn.execute("DELETE FROM policies WHERE id = ?", (policy_id,))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def match_policies(self, logical_path: str) -> list[dict[str, Any]]:
        """Find all policies matching a logical path (glob-like)."""
        import fnmatch

        policies = self.list_policies()
        matched = []
        for p in policies:
            if fnmatch.fnmatch(logical_path, p["path_pattern"]):
                matched.append(p)
        return matched

    # ── Temperature calculation ───────────────────────────────────

    def calculate_temperature(
        self,
        logical_path: str,
        hot_threshold: int = 1000,
        warm_threshold: int = 100,
        archive_threshold_days: int = 90,
    ) -> str:
        """Calculate temperature class for a directory.

        hot: read_count >= hot_threshold
        warm: read_count >= warm_threshold
        cold: accessed recently but below warm_threshold
        archive: no access in archive_threshold_days
        """
        placement = self.get_placement(logical_path)
        if placement is None:
            return "cold"

        read_count = placement.get("read_count", 0)
        last_access = placement.get("last_access", "")

        if read_count >= hot_threshold:
            return "hot"
        if read_count >= warm_threshold:
            return "warm"

        if last_access:
            try:
                last = datetime.fromisoformat(last_access)
                now = datetime.now(timezone.utc)
                days_since_access = (now - last.replace(tzinfo=timezone.utc)).days
                if days_since_access >= archive_threshold_days:
                    return "archive"
            except (ValueError, TypeError):
                pass

        return "cold"

    def update_temperatures(
        self,
        hot_threshold: int = 1000,
        warm_threshold: int = 100,
        archive_threshold_days: int = 90,
    ) -> dict[str, int]:
        """Recalculate temperature for all tracked directories.

        Returns count of directories updated per temperature class.
        """
        counts: dict[str, int] = {"hot": 0, "warm": 0, "cold": 0, "archive": 0}

        with self._lock:
            conn = sqlite3.connect(str(self.db_path))
            try:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT * FROM directory_placements"
                ).fetchall()

                for row in rows:
                    logical_path = row["logical_path"]
                    read_count = row["read_count"]
                    # sqlite3.Row doesn't support .get(), check key existence
                    last_access = row["last_access"] if "last_access" in row.keys() else ""

                    if read_count >= hot_threshold:
                        temp = "hot"
                    elif read_count >= warm_threshold:
                        temp = "warm"
                    elif last_access:
                        try:
                            last = datetime.fromisoformat(last_access)
                            now = datetime.now(timezone.utc)
                            days_since = (
                                now - last.replace(tzinfo=timezone.utc)
                            ).days
                            if days_since >= archive_threshold_days:
                                temp = "archive"
                            else:
                                temp = "cold"
                        except (ValueError, TypeError):
                            temp = "cold"
                    else:
                        temp = "cold"

                    conn.execute(
                        "UPDATE directory_placements SET temperature = ? WHERE logical_path = ?",
                        (temp, logical_path),
                    )
                    counts[temp] = counts.get(temp, 0) + 1
                conn.commit()
            finally:
                conn.close()

        return counts


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()
