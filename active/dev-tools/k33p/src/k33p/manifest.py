"""Parser and validator for k33p.yaml manifests.

A k33p.yaml declares:
    - project metadata (name, type, org, team, description)
    - channels (typed content streams)
    - views (per-role projection of channels onto disk paths)
    - roles (named bundles of view + channels + publish capabilities)
    - daemon config (auto-commit, hooks, mirrors)
    - subprojects (path-scoped slices, monorepo only)

The parser returns a Manifest dataclass. Validation happens during parsing;
invalid manifests raise ManifestError with a clear message.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from k33p.channels import ChannelConfig, ManifestError
from k33p.refs import Pointer

# ── sub-configs ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ViewMount:
    """Where a channel's content materializes on disk for a view."""

    at: str | None = None        # a path, e.g. "./" or "./node_modules"
    history: str | None = None   # override the channel default
    mount: str | None = None     # e.g. "env" for env-mount, "install" for installer
    vendored: bool = False
    install: bool = False

    @classmethod
    def from_dict(cls, data: Any) -> ViewMount:
        if isinstance(data, str):
            return cls(at=data)
        if isinstance(data, dict):
            return cls(
                at=data.get("at"),
                history=data.get("history"),
                mount=data.get("mount"),
                vendored=bool(data.get("vendored", False)),
                install=bool(data.get("install", False)),
            )
        raise ManifestError(
            f"view mount must be a string or mapping, got {type(data).__name__}"
        )


@dataclass(frozen=True)
class View:
    """A per-role projection of channels onto disk paths."""

    name: str
    extends: str | None = None
    channels: dict[str, ViewMount] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> View:
        if not isinstance(data, dict):
            raise ManifestError(f"view {name!r} must be a mapping")
        return cls(
            name=name,
            extends=data.get("extends"),
            channels={
                ch_name: ViewMount.from_dict(mount)
                for ch_name, mount in data.items()
                if ch_name != "extends"
            },
        )


@dataclass(frozen=True)
class Role:
    """A named bundle of view + channels + publish capabilities."""

    name: str
    view: str | None = None
    publish: list[str] = field(default_factory=list)
    verify: str | None = None

    @classmethod
    def from_dict(cls, name: str, data: Any) -> Role:
        if isinstance(data, str):
            return cls(name=name, view=data)
        if isinstance(data, dict):
            return cls(
                name=name,
                view=data.get("view"),
                publish=list(data.get("publish", [])),
                verify=data.get("verify"),
            )
        raise ManifestError(
            f"role {name!r} must be a string or mapping"
        )


@dataclass(frozen=True)
class AutoCommitConfig:
    """Daemon auto-commit configuration."""

    enabled: bool = False
    debounce: str = "5m"
    paths: list[str] = field(default_factory=list)
    ignore: list[str] = field(default_factory=list)
    message: str = "auto: changes in {files}"
    pre_commit: str | None = None
    push_after: str | None = None
    sign: bool = False
    sign_with: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AutoCommitConfig:
        return cls(
            enabled=bool(data.get("enabled", False)),
            debounce=data.get("debounce", "5m"),
            paths=list(data.get("paths", [])),
            ignore=list(data.get("ignore", [])),
            message=data.get("message", "auto: changes in {files}"),
            pre_commit=data.get("pre_commit"),
            push_after=data.get("push_after"),
            sign=bool(data.get("sign", False)),
            sign_with=data.get("sign_with"),
        )


@dataclass(frozen=True)
class DaemonConfig:
    """Daemon configuration block."""

    auto_commit: AutoCommitConfig | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DaemonConfig:
        ac = data.get("auto_commit")
        return cls(
            auto_commit=AutoCommitConfig.from_dict(ac) if ac else None,
        )


@dataclass(frozen=True)
class Subproject:
    """A path-scoped slice of a monorepo.

    The subproject's `channels` map holds *partial overrides* of the parent
    project's channels. A subproject can specify just the fields it wants
    to change (e.g. `scope:`, `recipients:`, `transport:`); the rest are
    inherited from the parent. The `ChannelConfig.from_override` classmethod
    does the merge.
    """

    name: str
    path: str
    description: str = ""
    channels: dict[str, ChannelConfig] = field(default_factory=dict)
    daemon: DaemonConfig | None = None
    extends: str | None = None

    @classmethod
    def from_dict(cls, name: str, data: dict[str, Any]) -> Subproject:
        path = data.get("path")
        if not path:
            raise ManifestError(
                f"subproject {name!r} is missing required field 'path'"
            )
        sub_channels: dict[str, ChannelConfig] = {}
        for ch_name, ch_data in data.get("channels", {}).items():
            sub_channels[ch_name] = ChannelConfig.from_override(ch_name, ch_data)
        daemon_data = data.get("daemon")
        return cls(
            name=name,
            path=path,
            description=data.get("description", ""),
            channels=sub_channels,
            daemon=DaemonConfig.from_dict(daemon_data) if daemon_data else None,
            extends=data.get("extends"),
        )


# ── top-level manifest ────────────────────────────────────────────────


@dataclass(frozen=True)
class Manifest:
    """A parsed k33p.yaml manifest.

    The project_type field is 'monorepo' (with subprojects) or 'single'
    (one implicit subproject at the root path). For single projects,
    `subprojects` is empty and `implicit_subproject` holds the root.
    """

    path: Path
    project: str
    type: str = "single"
    description: str = ""
    org: str | None = None
    team: str | None = None
    channels: dict[str, ChannelConfig] = field(default_factory=dict)
    views: dict[str, View] = field(default_factory=dict)
    roles: dict[str, Role] = field(default_factory=dict)
    daemon: DaemonConfig | None = None
    subprojects: dict[str, Subproject] = field(default_factory=dict)
    visibility: dict[str, str] = field(default_factory=dict)
    pointers: dict[str, Pointer] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def is_monorepo(self) -> bool:
        return self.type == "monorepo"

    @property
    def all_subproject_names(self) -> list[str]:
        """All subproject names, including the implicit one for single projects."""
        if self.is_monorepo:
            return list(self.subprojects.keys())
        return [self.project]

    @property
    def default_role(self) -> str:
        """The default role to use when none is specified."""
        if "developer" in self.roles:
            return "developer"
        if self.roles:
            return next(iter(self.roles))
        return "developer"

    def channel_for(
        self, channel_name: str, subproject: str | None = None
    ) -> ChannelConfig | None:
        """Look up a channel, optionally scoped to a subproject.

        A subproject can override or extend a channel from the parent
        manifest. The subproject's version wins; fields not specified in
        the override are inherited from the parent.
        """
        if subproject and subproject in self.subprojects:
            sub = self.subprojects[subproject]
            if channel_name in sub.channels:
                return _merge_channel(self.channels.get(channel_name), sub.channels[channel_name])
        return self.channels.get(channel_name)

    def channels_for_subproject(
        self, subproject: str | None = None
    ) -> dict[str, ChannelConfig]:
        """All channels visible from a subproject's perspective.

        Subproject-scoped channels override parent channels with the same
        name; missing fields in the override are inherited from the parent.
        """
        merged: dict[str, ChannelConfig] = dict(self.channels)
        if subproject and subproject in self.subprojects:
            sub = self.subprojects[subproject]
            for ch_name, sub_ch in sub.channels.items():
                parent = self.channels.get(ch_name)
                merged[ch_name] = _merge_channel(parent, sub_ch)
        return merged

    def effective_daemon(self, subproject: str | None = None) -> DaemonConfig | None:
        """The effective daemon config for a subproject (or the project)."""
        if subproject and subproject in self.subprojects:
            sub = self.subprojects[subproject]
            if sub.daemon is not None:
                return sub.daemon
        return self.daemon


# ── parser ─────────────────────────────────────────────────────────────


def parse_manifest(path: str | Path) -> Manifest:
    """Parse a k33p.yaml file.

    Raises:
        FileNotFoundError: if the file doesn't exist.
        ManifestError: if the manifest is malformed.
        yaml.YAMLError: if the YAML is unparseable.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"k33p.yaml not found at {path}")

    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if data is None:
        raise ManifestError(f"{path} is empty")
    if not isinstance(data, dict):
        raise ManifestError(
            f"{path} must be a YAML mapping, got {type(data).__name__}"
        )

    return _manifest_from_dict(path, data)


def _manifest_from_dict(path: Path, data: dict[str, Any]) -> Manifest:
    project = data.get("project")
    if not project:
        raise ManifestError(f"{path} is missing required field 'project'")

    channels: dict[str, ChannelConfig] = {}
    for ch_name, ch_data in data.get("channels", {}).items():
        channels[ch_name] = ChannelConfig.from_dict(ch_name, ch_data)

    views: dict[str, View] = {}
    for v_name, v_data in data.get("views", {}).items():
        views[v_name] = View.from_dict(v_name, v_data)

    roles: dict[str, Role] = {}
    for r_name, r_data in data.get("roles", {}).items():
        roles[r_name] = Role.from_dict(r_name, r_data)

    subprojects: dict[str, Subproject] = {}
    for s_name, s_data in data.get("subprojects", {}).items():
        subprojects[s_name] = Subproject.from_dict(s_name, s_data)

    daemon_data = data.get("daemon")
    daemon = DaemonConfig.from_dict(daemon_data) if daemon_data else None

    pointers: dict[str, Pointer] = {}
    live_ch = data.get("channels", {}).get("live")
    if live_ch and "pointers" in live_ch:
        for p_name, p_data in live_ch["pointers"].items():
            pointers[p_name] = Pointer.from_dict(p_name, p_data)

    project_type = data.get("type", "single")
    if project_type not in ("single", "monorepo"):
        raise ManifestError(
            f"project.type must be 'single' or 'monorepo', got {project_type!r}"
        )

    # If subprojects are declared, force type=monorepo
    if subprojects and project_type != "monorepo":
        project_type = "monorepo"

    known_top_level = {
        "project",
        "type",
        "description",
        "org",
        "team",
        "channels",
        "views",
        "roles",
        "daemon",
        "subprojects",
        "visibility",
    }
    extra = {k: v for k, v in data.items() if k not in known_top_level}

    return Manifest(
        path=path,
        project=project,
        type=project_type,
        description=data.get("description", ""),
        org=data.get("org"),
        team=data.get("team"),
        channels=channels,
        views=views,
        roles=roles,
        daemon=daemon,
        subprojects=subprojects,
        visibility=data.get("visibility", {}),
        pointers=pointers,
        extra=extra,
    )


def discover_manifest(start: str | Path) -> Manifest:
    """Find and parse the k33p.yaml at or above `start`.

    Searches the given path and each parent directory for a k33p.yaml.
    Raises FileNotFoundError if none is found.
    """
    start = Path(start).resolve()
    if start.is_file():
        start = start.parent
    for candidate in [start, *start.parents]:
        manifest_path = candidate / "k33p.yaml"
        if manifest_path.exists():
            return parse_manifest(manifest_path)
    raise FileNotFoundError(f"no k33p.yaml found at or above {start}")


def _explicitly_set(
    cfg: ChannelConfig, field: str, default_field: str | None = None
) -> bool:
    """Heuristic: was a field explicitly set in this override?

    Since frozen dataclasses don't track field provenance, we compare
    against the class default.  If the value matches the default we assume
    it *wasn't* explicitly set.  This is imperfect: someone who explicitly
    sets visibility to PRIVATE (the default) will look like "not set".
    For the MVP that's an acceptable edge case.
    """
    cls_default = ChannelConfig.__dataclass_fields__[field].default
    return getattr(cfg, field) != cls_default


# ── channel merging ─────────────────────────────────────────────────


def _merge_channel(
    parent: ChannelConfig | None, override: ChannelConfig
) -> ChannelConfig:
    """Merge a subproject's channel override with the parent's channel.

    The override's fields win when they are explicitly set (non-default
    for strings, non-empty for collections, not None for Optional).
    The parent's type and transport are required to come from the parent
    if not specified in the override.
    """
    if parent is None:
        # No parent — the override must fully specify the channel.
        if override.type is None or not override.transport:
            raise ManifestError(
                f"channel {override.name!r} in subproject has no parent to "
                f"inherit from; must specify 'type' and 'transport'"
            )
        return override

    # Merge field-by-field
    merged_recipients = override.recipients if override.recipients else parent.recipients
    return ChannelConfig(
        name=override.name,
        type=override.type if override.type is not None else parent.type,
        transport=override.transport if override.transport else parent.transport,
        scope=override.scope if override.scope is not None else parent.scope,
        # visibility field: the override doesn't have a sentinel, so we can't tell
        # if it was explicitly set to PRIVATE vs unset.  We use the parent's value
        # when the override's visibility matches the default *and* the parent has
        # a different value.  This is an imperfect heuristic but covers the
        # common case where a subproject adds channels without specifying visibility.
        visibility=(
            override.visibility
            if _explicitly_set(override, "visibility", default_field="visibility")
            else parent.visibility
        ),
        history=override.history,
        history_ring=override.history_ring if override.history_ring is not None else parent.history_ring,
        encryption=override.encryption if override.encryption is not None else parent.encryption,
        recipients=merged_recipients,
        resolver=override.resolver if override.resolver is not None else parent.resolver,
        pinned=override.pinned or parent.pinned,
        content_addressed=parent.content_addressed,
        signed=parent.signed or override.signed,
        update_policy_max_per_hour=(
            override.update_policy_max_per_hour
            if override.update_policy_max_per_hour is not None
            else parent.update_policy_max_per_hour
        ),
        update_policy_signed_by=(
            override.update_policy_signed_by
            if override.update_policy_signed_by
            else parent.update_policy_signed_by
        ),
        extra={**parent.extra, **override.extra},
    )
