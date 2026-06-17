"""Channel type definitions for k33p.

A channel is a typed view over the content-addressed store. There are five
channel types:
    - source:       version-controlled code (wraps git)
    - secrets:      encrypted private content
    - dependencies: third-party code, pinned by content hash
    - artifacts:    built outputs, signed, content-addressed
    - live:         signed, rate-limited, auditable pointer updates

Each channel is scoped to either the monorepo as a whole or a specific
subproject path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class ChannelType(StrEnum):
    """The five channel types in k33p."""

    SOURCE = "source"
    SECRETS = "secrets"
    DEPENDENCIES = "dependencies"
    ARTIFACTS = "artifacts"
    LIVE = "live"


class HistoryPolicy(StrEnum):
    """How much history to keep for a channel."""

    FULL = "full"
    SHALLOW = "shallow"
    NONE = "none"
    LOCKFILE = "lockfile"
    RING = "ring"


class Visibility(StrEnum):
    """Who can see a channel."""

    PUBLIC = "public"
    PRIVATE = "private"
    TEAM = "team"


@dataclass(frozen=True)
class ChannelConfig:
    """A single channel's configuration as declared in k33p.yaml.

    The configuration is the *declaration* — what the channel is and where it
    lives. The view (where its content materializes on disk) is configured
    separately in the role/view system.
    """

    name: str
    type: ChannelType
    transport: str
    scope: str | None = None
    visibility: Visibility = Visibility.PRIVATE
    history: HistoryPolicy = HistoryPolicy.FULL
    history_ring: int | None = None
    encryption: str | None = None
    recipients: list[str] = field(default_factory=list)
    resolver: str | None = None
    pinned: bool = False
    content_addressed: bool = True
    signed: bool = False
    update_policy_max_per_hour: int | None = None
    update_policy_signed_by: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> ChannelConfig:
        """Parse a channel from its k33p.yaml block (full declaration)."""
        return cls._from_data(name, data, require_type_and_transport=True)

    @classmethod
    def from_override(cls, name: str, data: dict[str, Any]) -> ChannelConfig:
        """Parse a subproject's partial channel override.

        A subproject can override specific fields of an inherited parent
        channel; the rest is inherited. With this method, `type` and
        `transport` are optional in the override block.
        """
        return cls._from_data(name, data, require_type_and_transport=False)

    @classmethod
    def _from_data(
        cls, name: str, data: Any, *, require_type_and_transport: bool
    ) -> ChannelConfig:
        if not isinstance(data, dict):
            raise ManifestError(f"channel {name!r} must be a mapping")

        type_str = data.get("type")
        if require_type_and_transport and not type_str:
            raise ManifestError(
                f"channel {name!r} is missing required field 'type'"
            )
        if type_str is not None:
            try:
                channel_type = ChannelType(type_str)
            except ValueError as e:
                valid = ", ".join(t.value for t in ChannelType)
                raise ManifestError(
                    f"channel {name!r} has unknown type {type_str!r}; valid: {valid}"
                ) from e
        else:
            channel_type = None  # type: ignore[assignment]

        transport = data.get("transport")
        if require_type_and_transport and not transport:
            raise ManifestError(
                f"channel {name!r} is missing required field 'transport'"
            )

        # History parsing — supports strings, "ring(N)" shorthand, and dicts.
        history_raw = data.get("history", "full")
        history_ring = None
        if isinstance(history_raw, str):
            if history_raw.startswith("ring(") and history_raw.endswith(")"):
                try:
                    history_ring = int(history_raw[5:-1])
                except ValueError as e:
                    raise ManifestError(
                        f"channel {name!r} has invalid ring size in {history_raw!r}"
                    ) from e
                history = HistoryPolicy.RING
            else:
                try:
                    history = HistoryPolicy(history_raw)
                except ValueError as e:
                    raise ManifestError(
                        f"channel {name!r} has unknown history {history_raw!r}"
                    ) from e
        elif isinstance(history_raw, dict):
            try:
                history = HistoryPolicy(history_raw.get("policy", "full"))
            except ValueError as e:
                raise ManifestError(
                    f"channel {name!r} has unknown history policy"
                ) from e
            history_ring = history_raw.get("size")
        else:
            raise ManifestError(
                f"channel {name!r} 'history' must be a string or mapping"
            )

        visibility = Visibility(data.get("visibility", "private"))

        return cls(
            name=name,
            type=channel_type,
            transport=transport or "",
            scope=data.get("scope"),
            visibility=visibility,
            history=history,
            history_ring=history_ring,
            encryption=data.get("encryption"),
            recipients=list(data.get("recipients", [])),
            resolver=data.get("resolver"),
            pinned=bool(data.get("pinned", False)),
            content_addressed=bool(data.get("content_addressed", True)),
            signed=bool(data.get("signed", False)),
            update_policy_max_per_hour=data.get("update_policy", {}).get(
                "max_per_hour"
            ),
            update_policy_signed_by=list(
                data.get("update_policy", {}).get("signed_by", [])
            ),
            extra={
                k: v
                for k, v in data.items()
                if k
                not in {
                    "type",
                    "transport",
                    "scope",
                    "visibility",
                    "history",
                    "encryption",
                    "recipients",
                    "resolver",
                    "pinned",
                    "content_addressed",
                    "signed",
                    "update_policy",
                }
            },
        )


class ManifestError(ValueError):
    """Raised when a k33p manifest is malformed."""
