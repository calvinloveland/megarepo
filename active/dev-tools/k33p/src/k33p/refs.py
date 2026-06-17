"""Ref and pointer types for k33p.

A *ref* is a pointer to a specific state in a channel. Refs are immutable
in the source/secrets/dependencies/artifacts channels — once a ref points
at an object, it always points at that object.

A *pointer* is a ref in the live channel that can change. A pointer maps
a human-friendly name to a ref in another channel. Pointer updates are
themselves signed, rate-limited events recorded in the live channel.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class RefType(StrEnum):
    """The shape of a ref depends on the channel type."""

    COMMIT = "commit"          # src: a git commit SHA
    CONTENT_HASH = "content_hash"  # secrets: a content hash
    LOCKFILE_REV = "lockfile_rev"  # dependencies: a lockfile revision
    MANIFEST_ID = "manifest_id"    # artifacts: a signed manifest ID
    POINTER = "pointer"            # live: a pointer update event
    BRANCH = "branch"              # live: a branch pointer
    TAG = "tag"                    # any: a human-friendly tag pointing to a lock


@dataclass(frozen=True)
class Ref:
    """An immutable reference to a specific state in a channel.

    The `ref_type` field tells the consumer how to interpret the value:
    a commit SHA for src, a content hash for secrets, etc. The `channel`
    field identifies which channel the ref belongs to.
    """

    channel: str
    value: str
    ref_type: RefType
    subproject: str | None = None  # the subproject this ref is scoped to, if any

    def __str__(self) -> str:
        scope = f"{self.subproject}@" if self.subproject else ""
        return f"{scope}{self.channel}@{self.value}"


@dataclass(frozen=True)
class Pointer:
    """A named, mutable pointer in the live channel.

    Pointers live in the live channel and map human-friendly names to refs
    in other channels. A pointer update is a signed event; the live channel
    keeps an audit log of pointer moves.
    """

    name: str
    target: Ref
    subproject: str | None = None
    signature_key: str | None = None
    signature_value: str | None = None
    timestamp: str | None = None
    reason: str | None = None

    @classmethod
    def from_dict(cls, name: str, data: Any) -> Pointer:
        """Parse a pointer from its k33p.yaml block.

        The `data` field is the value associated with the pointer name in
        the live channel's `pointers:` block, e.g.:
            latest-stable: artifacts@v1.2.3
        Or a richer mapping:
            latest-stable:
              target: artifacts@v1.2.3
              reason: "release v1.2.3"
        """
        if isinstance(data, str):
            target = parse_ref_string(data)
            return cls(name=name, target=target)
        if isinstance(data, dict):
            target_str = data.get("target")
            if not target_str:
                raise ValueError(
                    f"pointer {name!r} is missing required 'target' field"
                )
            target = parse_ref_string(target_str)
            return cls(
                name=name,
                target=target,
                signature_key=data.get("signature", {}).get("key"),
                signature_value=data.get("signature", {}).get("sig"),
                timestamp=data.get("timestamp"),
                reason=data.get("reason"),
            )
        raise ValueError(f"pointer {name!r} must be a string or mapping")


def parse_ref_string(text: str) -> Ref:
    """Parse a ref string like `artifacts@v1.2.3` or `src@deadbeef`.

    Format: [<subproject>@]<channel>@<value>
    """
    parts = text.split("@", 2)
    if len(parts) < 2:
        raise ValueError(
            f"ref string {text!r} must be in form 'channel@value' or "
            f"'subproject@channel@value'"
        )
    if len(parts) == 2:
        channel, value = parts
        subproject = None
    else:
        subproject, channel, value = parts

    ref_type = _infer_ref_type(channel, value)
    return Ref(channel=channel, value=value, ref_type=ref_type, subproject=subproject)


def _infer_ref_type(channel: str, value: str) -> RefType:
    """Infer the ref type from the channel name and value format.

    Heuristic — the real source of truth is the channel declaration in
    k33p.yaml. This is good enough for display and quick checks.
    """
    if channel == "src":
        # 7+ hex chars and not all digits-only-untagged → commit
        if all(c in "0123456789abcdef" for c in value.lower()) and len(value) >= 7:
            return RefType.COMMIT
        return RefType.BRANCH
    if channel == "private":
        return RefType.CONTENT_HASH
    if channel == "deps":
        return RefType.LOCKFILE_REV
    if channel == "artifacts":
        if value.startswith("v") and "." in value:
            return RefType.TAG
        return RefType.MANIFEST_ID
    if channel == "live":
        return RefType.POINTER
    return RefType.COMMIT  # default
