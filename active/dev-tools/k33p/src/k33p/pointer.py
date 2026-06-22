"""Pointer operations for k33p — update, list, and verify live channel pointers.

Pointers map human-friendly names to refs in other channels.  Each pointer
update is a signed, timestamped event stored in the CAS as a ``pointer``
kind object.  The live channel keeps an audit log of all pointer moves.

Rate limiting is enforced per the manifest's ``update_policy.max_per_hour``:
if set, the module checks recent pointer update timestamps before allowing
a new update.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from k33p.refs import Pointer, Ref, parse_ref_string
from k33p.store import ContentStore


# ── pointer error ────────────────────────────────────────────────────────


class PointerError(RuntimeError):
    """Raised when a pointer operation fails."""


# ── create pointer updates ──────────────────────────────────────────────


def create_pointer_update(
    store: ContentStore,
    pointer_name: str,
    target_ref: str,
    *,
    reason: str | None = None,
    signature_key: str | None = None,
    signature_value: str | None = None,
    subproject: str | None = None,
) -> Pointer:
    """Create a signed pointer update and store it in the CAS.

    Args:
        store: The content-addressed store.
        pointer_name: The human-friendly pointer name (e.g. ``latest-stable``).
        target_ref: Ref string (e.g. ``artifacts@v1.2.3`` or
            ``powder_play@src@main``).
        reason: Optional human-readable reason for the update.
        signature_key: Optional signing key identifier.
        signature_value: Optional signature value.
        subproject: Optional subproject scope.

    Returns:
        The created Pointer.

    Raises:
        PointerError: If the target ref string is invalid.
    """
    store.ensure()

    try:
        target = parse_ref_string(target_ref)
    except ValueError as e:
        raise PointerError(f"invalid target ref: {e}") from e

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    pointer = Pointer(
        name=pointer_name,
        target=target,
        subproject=subproject,
        signature_key=signature_key,
        signature_value=signature_value,
        timestamp=timestamp,
        reason=reason,
    )

    # Store the pointer update event in the CAS
    _store_pointer_event(store, pointer)

    return pointer


def _store_pointer_event(store: ContentStore, pointer: Pointer) -> str:
    """Serialize a pointer update and store it in the CAS.

    Returns the hash of the stored pointer event.
    """
    import json

    event = {
        "type": "pointer_update",
        "pointer": pointer.name,
        "target": str(pointer.target),
        "timestamp": pointer.timestamp,
    }
    if pointer.reason:
        event["reason"] = pointer.reason
    if pointer.signature_key:
        event["signature"] = {
            "key": pointer.signature_key,
            "sig": pointer.signature_value or "",
        }
    if pointer.subproject:
        event["subproject"] = pointer.subproject

    data = json.dumps(event, indent=2).encode()
    return store.put(data, kind="pointer")


# ── rate limiting ────────────────────────────────────────────────────────


def check_rate_limit(
    store: ContentStore,
    max_per_hour: int | None,
) -> None:
    """Check if a pointer update would exceed the rate limit.

    Looks at existing pointer events in the store within the last hour.

    Args:
        store: The content-addressed store.
        max_per_hour: Maximum updates per hour (``None`` = no limit).

    Raises:
        PointerError: If the rate limit would be exceeded.
    """
    if max_per_hour is None or max_per_hour <= 0:
        return  # No limit

    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - 3600  # 1 hour ago

    recent_count = 0
    for obj in store.iter_objects():
        if obj.kind != "pointer":
            continue
        data = store.get(obj.hash)
        if data is None:
            continue
        try:
            import json
            event = json.loads(data)
            ts = event.get("timestamp", "")
            if ts:
                try:
                    event_time = datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
                    if event_time.timestamp() >= cutoff:
                        recent_count += 1
                except (ValueError, OSError):
                    continue
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue

    if recent_count >= max_per_hour:
        raise PointerError(
            f"rate limit exceeded: {recent_count} updates in the last hour "
            f"(max: {max_per_hour})"
        )


# ── list pointers ────────────────────────────────────────────────────────


def list_pointer_events(store: ContentStore) -> list[dict[str, Any]]:
    """List all pointer update events stored in the CAS.

    Returns a list of dicts with keys: type, pointer, target, timestamp,
    reason (optional), signature (optional).
    """
    import json

    events: list[dict[str, Any]] = []
    for obj in store.iter_objects():
        if obj.kind != "pointer":
            continue
        data = store.get(obj.hash)
        if data is None:
            continue
        try:
            event = json.loads(data)
            event["hash"] = obj.hash
            events.append(event)
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue

    # Sort by timestamp descending
    events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return events


# ── CLI integration ──────────────────────────────────────────────────────


def cmd_pointer_set(
    project_path: str,
    pointer_name: str,
    target_ref: str,
    *,
    reason: str | None = None,
    sign_with: str | None = None,
    force: bool = False,
) -> int:
    """CLI handler for ``k33p pointer set``.

    Returns:
        0 on success, 1 on error.
    """
    import sys

    from k33p.project import load_project

    try:
        project = load_project(project_path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    m = project.manifest

    # Find the live channel config
    live_ch = m.channels.get("live")
    if not live_ch or live_ch.type.value != "live":
        live_ch = next(
            (ch for ch in m.channels.values() if ch.type.value == "live"),
            None
        )
    if not live_ch:
        print("k33p: no live channel found in manifest", file=sys.stderr)
        return 1

    # Check rate limit
    max_per_hour = live_ch.update_policy_max_per_hour
    store_path = project.store_path or (project.path / ".k33p" / "store")
    store = ContentStore(store_path)
    store.ensure()

    if not force:
        try:
            check_rate_limit(store, max_per_hour)
        except PointerError as e:
            print(f"k33p: {e}", file=sys.stderr)
            return 1

    # Sign with key if requested
    sig_key = sign_with
    sig_value = None
    if sign_with:
        # For the MVP, signatures are recorded but not cryptographically
        # verified.  A real implementation would use age or signify.
        sig_value = f"sig:placeholder-{sign_with}-{datetime.now(timezone.utc).isoformat()}"

    try:
        pointer = create_pointer_update(
            store,
            pointer_name,
            target_ref,
            reason=reason,
            signature_key=sig_key,
            signature_value=sig_value,
        )
    except PointerError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1

    print(f"✓ Pointer {pointer_name!r} updated → {target_ref}")
    if reason:
        print(f"  reason: {reason}")
    if pointer.timestamp:
        print(f"  timestamp: {pointer.timestamp}")
    if pointer.signature_key:
        print(f"  signed with: {pointer.signature_key}")
    return 0


def cmd_pointer_list(
    project_path: str,
) -> int:
    """CLI handler for ``k33p pointer list``.

    Returns:
        0 on success, 1 on error.
    """
    import sys

    from k33p.project import load_project

    try:
        project = load_project(project_path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    store_path = project.store_path or (project.path / ".k33p" / "store")
    store = ContentStore(store_path)
    store.ensure()

    events = list_pointer_events(store)

    if not events:
        print("No pointer update events found.")
        return 0

    print(f"{'Pointer':20} {'Target':30} {'Timestamp':22}  Reason")
    print("-" * 85)
    for ev in events:
        pointer = ev.get("pointer", "?")
        target = ev.get("target", "?")
        ts = ev.get("timestamp", "?")
        reason = ev.get("reason", "")[:30]
        print(f"{pointer:20} {target:30} {ts:22}  {reason}")

    return 0
