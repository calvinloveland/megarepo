"""
Tests for HomeCluster storage modules.

Run: python -m pytest tests/test_homecluster.py -v
Run from the warden module directory.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

# Add parent to sys.path for imports
WARDEN_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WARDEN_DIR))


# ── Storage Class ─────────────────────────────────────────────────


def test_storage_class_enum():
    """Verify StorageClass enum values."""
    from homecluster.storage_class import StorageClass
    assert StorageClass.SSD.value == "ssd"
    assert StorageClass.HDD.value == "hdd"
    assert StorageClass.ARCHIVE.value == "archive"
    assert StorageClass.UNKNOWN.value == "unknown"


def test_storage_mount_dataclass():
    """Verify StorageMount dataclass fields."""
    from homecluster.storage_class import StorageClass, StorageMount
    m = StorageMount(
        mount="/mnt/test",
        filesystem="ext4",
        device="/dev/sda1",
        capacity_bytes=1000,
        used_bytes=500,
        free_bytes=500,
        storage_class=StorageClass.SSD,
        rotational=False,
        label="test",
    )
    assert m.mount == "/mnt/test"
    assert m.storage_class == StorageClass.SSD
    assert m.capacity_bytes == 1000
    assert m.free_bytes == 500
    assert m.rotational is False


def test_format_storage_summary():
    """Verify storage summary computation."""
    from homecluster.storage_class import StorageClass, StorageMount, format_storage_summary

    mounts = [
        StorageMount(mount="/", filesystem="ext4", device="/dev/sda1",
                     capacity_bytes=1000, used_bytes=500, free_bytes=500,
                     storage_class=StorageClass.SSD),
        StorageMount(mount="/data", filesystem="ext4", device="/dev/sdb1",
                     capacity_bytes=2000, used_bytes=1000, free_bytes=1000,
                     storage_class=StorageClass.HDD),
    ]
    summary = format_storage_summary(mounts)

    assert summary["total_capacity_bytes"] == 3000
    assert summary["total_free_bytes"] == 1500
    assert summary["total_used_bytes"] == 1500
    assert summary["total_used_pct"] == 50.0
    assert "ssd" in summary["by_class"]
    assert "hdd" in summary["by_class"]
    assert summary["by_class"]["ssd"]["capacity_bytes"] == 1000
    assert summary["by_class"]["hdd"]["capacity_bytes"] == 2000
    assert len(summary["mounts"]) == 2


def test_classify_storage_no_sysfs():
    """Verify classify_storage returns gracefully without /sys/block."""
    from homecluster.storage_class import classify_storage

    # Should not crash — returns empty if no mounts can be detected
    mounts = classify_storage()
    # We at least get back a list (may be empty in minimal environments)
    assert isinstance(mounts, list)


def test_classify_storage_with_overrides():
    """Verify storage class overrides work."""
    from homecluster.storage_class import classify_storage

    mounts = classify_storage(overrides={"/": "hdd"})
    root_mounts = [m for m in mounts if m.mount == "/"]
    if root_mounts:
        from homecluster.storage_class import StorageClass
        assert root_mounts[0].storage_class == StorageClass.HDD


# ── Object Store ──────────────────────────────────────────────────


def test_object_store_put_and_get():
    """Verify basic put/get round-trip."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"hello world")
        data = store.get(oid)
        assert data == b"hello world"


def test_object_store_dedup():
    """Verify same content returns same OID."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid1 = store.put(b"dedup test")
        oid2 = store.put(b"dedup test")
        assert oid1 == oid2
        assert store.object_count() == 1


def test_object_store_verify():
    """Verify integrity check works."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"verify me")
        assert store.verify(oid) is True
        assert store.verify("0000" + "a" * 60) is False  # Non-existent


def test_object_store_exists():
    """Verify exists check works."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"existing")
        assert store.exists(oid) is True
        assert store.exists("0000" + "b" * 60) is False


def test_object_store_delete():
    """Verify deletion works."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"delete me")
        assert store.exists(oid)
        assert store.delete(oid) is True
        assert store.exists(oid) is False
        assert store.delete(oid) is False  # Already deleted


def test_object_store_list():
    """Verify listing objects works."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        assert store.list_objects() == []
        oid1 = store.put(b"object one")
        oid2 = store.put(b"object two")
        all_oids = store.list_objects()
        assert len(all_oids) == 2
        assert oid1 in all_oids
        assert oid2 in all_oids


def test_object_store_metadata():
    """Verify metadata is saved and retrieved."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"meta test", content_type="text/plain", logical_path="/test/file.txt", labels={"env": "test"})
        meta = store.get_metadata(oid)
        assert meta is not None
        assert meta.oid == oid
        assert meta.size_bytes == 9
        assert meta.content_type == "text/plain"
        assert meta.logical_path == "/test/file.txt"
        assert meta.labels == {"env": "test"}


def test_object_store_put_file():
    """Verify put_file stores a file correctly."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        src = Path(tmpdir) / "source.txt"
        src.write_text("file content")
        oid = store.put_file(src, content_type="text/plain", logical_path="/test/source.txt")
        assert store.exists(oid)
        retrieved = store.get(oid)
        assert retrieved == b"file content"


def test_object_store_get_file():
    """Verify get_file extracts to a destination."""
    from homecluster.object_store import ObjectStore

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"get file test")
        dest = Path(tmpdir) / "output.txt"
        store.get_file(oid, dest)
        assert dest.read_bytes() == b"get file test"


def test_object_store_corruption_detection():
    """Verify corrupted data is detected on read."""
    from homecluster.object_store import ObjectStore, ObjectStoreError

    with tempfile.TemporaryDirectory() as tmpdir:
        store = ObjectStore(tmpdir)
        oid = store.put(b"original data")

        # Tamper with the object file
        import os as _os
        obj_dir = Path(tmpdir) / "objects" / oid[:2]
        for f in obj_dir.iterdir():
            if oid[2:] in f.name:
                f.write_bytes(b"tampered data")
                break

        # Read should fail with integrity error
        try:
            store.get(oid)
            assert False, "Should have raised ObjectStoreError"
        except ObjectStoreError as e:
            assert "corrupted" in str(e).lower()


# ── Cluster Metadata ──────────────────────────────────────────────


def test_cluster_metadata_init():
    """Verify metadata database creates tables."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        db = Path(tmpdir) / "cluster.db"
        meta = ClusterMetadata(db)
        assert db.exists()
        tables = meta.list_nodes()
        assert isinstance(tables, list)


def test_cluster_register_node():
    """Verify node registration works."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("test-node", "testhost", [
            {"mount": "/", "capacity_bytes": 1000, "free_bytes": 500, "storage_class": "ssd"},
        ])
        node = meta.get_node("test-node")
        assert node is not None
        assert node["hostname"] == "testhost"
        assert node["online"] is True
        assert len(node["mounts"]) == 1


def test_cluster_mark_offline():
    """Verify node can be marked offline."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "host1", [{"mount": "/", "capacity_bytes": 1000, "free_bytes": 500, "storage_class": "ssd"}])
        meta.mark_node_offline("n1")
        node = meta.get_node("n1")
        assert node["online"] is False


def test_cluster_summary():
    """Verify cluster summary aggregates correctly."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "host1", [
            {"mount": "/", "capacity_bytes": 1000, "free_bytes": 500, "storage_class": "ssd"},
        ])
        meta.register_node("n2", "host2", [
            {"mount": "/data", "capacity_bytes": 4000, "free_bytes": 3000, "storage_class": "hdd"},
        ])
        summary = meta.cluster_summary()
        assert summary["node_count"] == 2
        assert summary["online_count"] == 2
        assert summary["total_capacity_bytes"] == 5000
        assert summary["total_free_bytes"] == 3500
        assert "ssd" in summary["by_class"]
        assert "hdd" in summary["by_class"]


def test_cluster_directory_placement():
    """Verify directory placement and replica tracking."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "host1", [{"mount": "/", "capacity_bytes": 1000, "free_bytes": 500, "storage_class": "ssd"}])
        meta.register_node("n2", "host2", [{"mount": "/data", "capacity_bytes": 4000, "free_bytes": 3000, "storage_class": "hdd"}])

        meta.set_directory_placement("/photos", preferred_storage="hdd", replica_count=2)
        meta.add_replica("/photos", "n1", oid="abc", size_bytes=500)
        meta.add_replica("/photos", "n2", oid="def", size_bytes=500)

        placement = meta.get_placement("/photos")
        assert placement is not None
        assert placement["preferred_storage"] == "hdd"
        assert placement["replica_count"] == 2
        assert len(placement["replicas"]) == 2

        meta.remove_replica("/photos", "n1")
        placement = meta.get_placement("/photos")
        assert len(placement["replicas"]) == 1


def test_cluster_access_tracking():
    """Verify access recording and temperature calculation."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.record_access("/hot-stuff", read_count=5000, write_count=100)
        meta.record_access("/cold-stuff", read_count=5, write_count=0)

        hot_temp = meta.calculate_temperature("/hot-stuff", hot_threshold=1000, warm_threshold=100)
        cold_temp = meta.calculate_temperature("/cold-stuff", hot_threshold=1000, warm_threshold=100)
        unknown_temp = meta.calculate_temperature("/nonexistent")

        assert hot_temp == "hot"
        assert cold_temp == "cold"
        assert unknown_temp == "cold"

        # Before update, the directory_placements entry might not have temperature
        # Let's update and check
        updated = meta.update_temperatures()
        assert "hot" in updated
        assert "cold" in updated


def test_cluster_policies():
    """Verify policy add, list, match, delete."""
    from homecluster.metadata import ClusterMetadata

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        assert meta.list_policies() == []

        pid = meta.add_policy("/photos/*", preferred_storage="hdd", replica_count=2)
        assert pid > 0
        meta.add_policy("/projects/*", preferred_storage="ssd", replica_count=2)

        policies = meta.list_policies()
        assert len(policies) == 2

        matched = meta.match_policies("/photos/vacation")
        assert len(matched) == 1
        assert matched[0]["preferred_storage"] == "hdd"

        assert meta.delete_policy(pid) is True
        assert len(meta.list_policies()) == 1


# ── Scheduler ─────────────────────────────────────────────────────


def test_scheduler_evaluate_place():
    """Verify scheduler suggests placement for untracked directory."""
    from homecluster.metadata import ClusterMetadata
    from homecluster.scheduler import PlacementScheduler

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "nas", [{"mount": "/data", "capacity_bytes": 10e12, "free_bytes": 8e12, "storage_class": "hdd"}])
        meta.register_node("n2", "desktop", [{"mount": "/", "capacity_bytes": 500e9, "free_bytes": 100e9, "storage_class": "ssd"}])

        scheduler = PlacementScheduler(meta)

        # No policy — should place on best node
        decision = scheduler.evaluate("/test", size_bytes=1e9)
        assert decision.action in ("place", "noop", "blocked")
        assert decision.target_node in ("n1", "n2")


def test_scheduler_policy_respected():
    """Verify scheduler respects placement policies."""
    from homecluster.metadata import ClusterMetadata
    from homecluster.scheduler import PlacementScheduler

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "nas", [{"mount": "/data", "capacity_bytes": 10e12, "free_bytes": 8e12, "storage_class": "hdd"}])
        meta.register_node("n2", "desktop", [{"mount": "/", "capacity_bytes": 500e9, "free_bytes": 100e9, "storage_class": "ssd"}])

        meta.add_policy("/photos/*", preferred_storage="hdd", replica_count=2)

        scheduler = PlacementScheduler(meta)
        decision = scheduler.evaluate("/photos/vacation", size_bytes=1e9)
        # Should prefer hdd (nas)
        assert decision.target_node == "n1"
        assert "hdd" in decision.reason.lower() or "nas" in decision.reason.lower()


def test_scheduler_replicate():
    """Verify scheduler requests replication when below target."""
    from homecluster.metadata import ClusterMetadata
    from homecluster.scheduler import PlacementScheduler

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "nas", [{"mount": "/data", "capacity_bytes": 10e12, "free_bytes": 8e12, "storage_class": "hdd"}])
        meta.register_node("n2", "laptop", [{"mount": "/", "capacity_bytes": 1e12, "free_bytes": 200e9, "storage_class": "ssd"}])

        meta.set_directory_placement("/photos", preferred_storage="any", replica_count=2)
        meta.add_replica("/photos", "n1", oid="abc", size_bytes=500e9)

        scheduler = PlacementScheduler(meta)
        decision = scheduler.evaluate("/photos", size_bytes=50e9)
        # Has 1 replica, needs 2, should suggest replicate
        assert decision.action == "replicate"


def test_scheduler_capacity_check():
    """Verify scheduler doesn't place on full nodes."""
    from homecluster.metadata import ClusterMetadata
    from homecluster.scheduler import PlacementScheduler

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        meta.register_node("n1", "full-node", [{"mount": "/", "capacity_bytes": 1000, "free_bytes": 10, "storage_class": "ssd"}])
        meta.register_node("n2", "roomy-node", [{"mount": "/data", "capacity_bytes": 10000, "free_bytes": 9000, "storage_class": "hdd"}])

        meta.add_policy("/big/*", preferred_storage="any", replica_count=1)

        scheduler = PlacementScheduler(meta)
        # Request 1GB of space on a node with only 10 bytes free
        decision = scheduler.evaluate("/big/file", size_bytes=500)
        # Should not place on n1 (low space)
        assert decision.target_node != "n1"


def test_scheduler_policy_loading():
    """Verify scheduler can load policies from a JSON file."""
    from homecluster.metadata import ClusterMetadata
    from homecluster.scheduler import PlacementScheduler

    with tempfile.TemporaryDirectory() as tmpdir:
        meta = ClusterMetadata(Path(tmpdir) / "cluster.db")
        policy_file = Path(tmpdir) / "policies.json"
        policy_file.write_text(json.dumps({
            "rules": [
                {"path": "/photos/*", "preferred_storage": "hdd", "replicas": 2},
                {"path": "/projects/*", "preferred_storage": "ssd", "replicas": 1},
            ]
        }))

        scheduler = PlacementScheduler(meta)
        count = scheduler.load_policies_from_yaml(str(policy_file))
        assert count == 2
        policies = meta.list_policies()
        assert len(policies) == 2
