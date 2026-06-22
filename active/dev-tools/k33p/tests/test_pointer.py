"""Tests for live channel pointer updates."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from k33p.pointer import (
    PointerError,
    check_rate_limit,
    create_pointer_update,
    list_pointer_events,
    cmd_pointer_set,
    cmd_pointer_list,
)
from k33p.store import ContentStore


@pytest.fixture
def store() -> ContentStore:
    """Create a fresh store for each test."""
    with tempfile.TemporaryDirectory() as tmp:
        store_path = Path(tmp) / "store"
        store = ContentStore(store_path)
        store.ensure()
        yield store


class TestCreatePointerUpdate:
    def test_create_basic_pointer(self, store: ContentStore) -> None:
        p = create_pointer_update(store, "latest-stable", "artifacts@v1.2.3")
        assert p.name == "latest-stable"
        assert p.target.channel == "artifacts"
        assert p.target.value == "v1.2.3"
        assert p.timestamp is not None
        assert p.reason is None

    def test_create_with_reason(self, store: ContentStore) -> None:
        p = create_pointer_update(
            store, "canary", "artifacts@ci-2026-06-22",
            reason="promote to canary",
        )
        assert p.reason == "promote to canary"

    def test_create_with_subproject(self, store: ContentStore) -> None:
        p = create_pointer_update(
            store, "latest", "powder_play@src@main",
        )
        assert p.target.subproject == "powder_play"
        assert str(p.target) == "powder_play@src@main"

    def test_create_with_signature(self, store: ContentStore) -> None:
        p = create_pointer_update(
            store, "latest-stable", "artifacts@v1.2.3",
            signature_key="age1maintainer",
            signature_value="sig1abc",
        )
        assert p.signature_key == "age1maintainer"
        assert p.signature_value == "sig1abc"

    def test_invalid_target_ref_raises(self, store: ContentStore) -> None:
        with pytest.raises(PointerError, match="invalid target"):
            create_pointer_update(store, "bad", "noatsymbol")

    def test_pointer_stored_in_cas(self, store: ContentStore) -> None:
        create_pointer_update(store, "main", "src@main")
        events = list_pointer_events(store)
        assert len(events) == 1
        assert events[0]["pointer"] == "main"
        assert events[0]["target"] == "src@main"

    def test_multiple_pointers_stored(self, store: ContentStore) -> None:
        create_pointer_update(store, "a", "artifacts@v1")
        create_pointer_update(store, "b", "artifacts@v2")
        events = list_pointer_events(store)
        assert len(events) == 2


class TestCheckRateLimit:
    def test_no_limit_always_passes(self, store: ContentStore) -> None:
        # Should not raise
        check_rate_limit(store, None)
        check_rate_limit(store, 0)

    def test_under_limit_passes(self, store: ContentStore) -> None:
        create_pointer_update(store, "a", "src@abc")
        # 1 update, max 10 per hour → should pass
        check_rate_limit(store, 10)

    def test_over_limit_raises(self, store: ContentStore) -> None:
        for i in range(5):
            create_pointer_update(store, f"p{i}", "src@abc")
        # 5 updates, max 3 per hour → should raise
        with pytest.raises(PointerError, match="rate limit"):
            check_rate_limit(store, 3)

    def test_empty_store_passes(self, store: ContentStore) -> None:
        check_rate_limit(store, 10)


class TestListPointerEvents:
    def test_empty_store(self, store: ContentStore) -> None:
        events = list_pointer_events(store)
        assert events == []

    def test_events_ordered_by_timestamp(self, store: ContentStore) -> None:
        import time
        create_pointer_update(store, "first", "src@a")
        time.sleep(0.01)  # microsecond precision ensures different timestamps
        create_pointer_update(store, "second", "src@b")
        events = list_pointer_events(store)
        assert len(events) == 2
        # Most recent first
        assert events[0]["pointer"] == "second", \
            f"expected 'second' first, got {events[0]}"

    def test_event_has_hash(self, store: ContentStore) -> None:
        create_pointer_update(store, "test", "src@abc")
        events = list_pointer_events(store)
        assert "hash" in events[0]
        assert len(events[0]["hash"]) == 64


class TestCmdPointerSet:
    def test_set_on_initialised_project(self) -> None:
        """Test pointer set on a project with a live channel and store."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "k33p.yaml").write_text("""\
project: pointer-test
type: single
channels:
  src:
    type: source
    transport: file:///tmp/nonexistent
    visibility: public
    history: full
  live:
    type: live
    transport: file:///tmp/nonexistent
    update_policy:
      max_per_hour: 10
      signed_by: [release-key]
    pointers:
      latest-stable: artifacts@v1.2.3
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
            (root / ".k33p" / "store").mkdir(parents=True, exist_ok=True)
            rc = cmd_pointer_set(
                str(root), "latest-stable", "artifacts@v2.0.0",
                reason="release v2",
                force=True,
            )
            assert rc == 0

    def test_set_without_live_channel(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "k33p.yaml").write_text("""\
project: no-live
type: single
channels:
  src:
    type: source
    transport: file:///tmp/nonexistent
    visibility: public
    history: full
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
            (root / ".k33p" / "store").mkdir(parents=True, exist_ok=True)
            rc = cmd_pointer_set(str(root), "test", "src@abc")
            assert rc == 1  # no live channel


class TestCmdPointerList:
    def test_list_with_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "k33p.yaml").write_text("""\
project: pointer-list
type: single
channels:
  live:
    type: live
    transport: file:///tmp/nonexistent
    pointers:
      latest: artifacts@v1
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
            (root / ".k33p" / "store").mkdir(parents=True, exist_ok=True)
            # Create a pointer update first
            cmd_pointer_set(str(root), "latest", "artifacts@v2", force=True)
            rc = cmd_pointer_list(str(root))
            assert rc == 0

    def test_list_no_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "k33p.yaml").write_text("""\
project: empty-list
type: single
channels:
  live:
    type: live
    transport: file:///tmp/nonexistent
views:
  default:
    src: { at: "./" }
roles:
  developer:   { view: default }
""")
            (root / ".k33p" / "store").mkdir(parents=True, exist_ok=True)
            rc = cmd_pointer_list(str(root))
            assert rc == 0
