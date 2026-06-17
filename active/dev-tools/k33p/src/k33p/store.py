"""Content-addressed object store (skeleton).

In v1, the store is a real CAS: every object in k33p is content-addressed
by hash, and the store is a directory of sharded objects (like git's
.git/objects/). For the MVP, this module exposes just the parts the TUI
needs: stats, listing, and a stub for actual reads.

The store lives at .k33p/store/ inside a project root.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ObjectStat:
    """Stats about a single object in the store."""

    hash: str
    size: int
    kind: str  # blob, commit, manifest, secret, artifact, pointer


@dataclass(frozen=True)
class StoreStats:
    """Aggregate stats about the store."""

    object_count: int
    total_bytes: int
    shard_count: int


class ContentStore:
    """The content-addressed object store for a k33p project.

    In the MVP, this is a read-only view over an existing on-disk store.
    The store is laid out like git's object store: sharded by the first
    two characters of the hash, with the rest of the hash as the filename.
    """

    def __init__(self, path: Path | None) -> None:
        self.path = path

    @property
    def exists(self) -> bool:
        return self.path is not None and self.path.exists()

    def stats(self) -> StoreStats:
        """Return aggregate stats for the store.

        Returns zeros if the store doesn't exist on disk.
        """
        if not self.exists:
            return StoreStats(object_count=0, total_bytes=0, shard_count=0)

        assert self.path is not None  # for the type checker
        shards = [p for p in self.path.iterdir() if p.is_dir()]
        obj_count = 0
        total = 0
        for shard in shards:
            for obj in shard.iterdir():
                if obj.is_file():
                    obj_count += 1
                    try:
                        total += obj.stat().st_size
                    except OSError:
                        pass
        return StoreStats(
            object_count=obj_count,
            total_bytes=total,
            shard_count=len(shards),
        )

    def iter_objects(self) -> Iterator[ObjectStat]:
        """Iterate over all objects in the store.

        Yields ObjectStat for each. The `kind` is a best-effort guess
        based on the hash length and structure — the real source of
        truth is the channel declaration in k33p.yaml.
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
                    size = obj.stat().st_size
                except OSError:
                    continue
                hash_str = shard.name + obj.name
                yield ObjectStat(hash=hash_str, size=size, kind="blob")
