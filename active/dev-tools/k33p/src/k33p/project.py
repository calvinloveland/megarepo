"""Project model: ties a manifest, lock, and store together.

A Project is the in-memory model of a k33p project. It has a manifest, an
optional lock, and a reference to the content-addressed store. For monorepos,
it also has a set of Subproject instances, each of which can have its own
lockfile and channel overrides.

The Project model is the unit the TUI displays. The TUI calls methods on
Project to render its views; Project is the single source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from k33p.lock import Lock, discover_lock, parse_lock
from k33p.manifest import Manifest, Subproject, parse_manifest


@dataclass(frozen=True)
class ProjectView:
    """A rendered view of a project for a given role and subproject.

    This is what the TUI displays. It's a flat, computed object: the
    manifest declares channels and roles, the role selects a view, the
    view maps channels to disk paths, the lock pins the refs. ProjectView
    is the join of all four.
    """

    subproject: str | None
    role: str
    channels: dict[str, ResolvedChannelView] = field(default_factory=dict)
    active_view: str | None = None

    @property
    def subproject_label(self) -> str:
        return self.subproject or "(root)"


@dataclass(frozen=True)
class ResolvedChannelView:
    """A channel's resolved state for a particular role + subproject.

    Joins the channel declaration, the view's mount, and (if present)
    the lock's pinned ref.
    """

    channel_name: str
    channel_type: str
    transport: str
    mount: str | None
    history: str | None
    pinned_ref: str | None
    scope: str | None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class Project:
    """The in-memory model of a k33p project.

    A Project has a manifest, an optional root lock, optional subproject
    locks, and a reference to the on-disk store. Subprojects are first-class
    children of the project; the model exposes them by name and supports
    per-subproject role + view resolution.
    """

    manifest: Manifest
    root_lock: Lock | None = None
    subproject_locks: dict[str, Lock] = field(default_factory=dict)
    store_path: Path | None = None
    active_role: str = "developer"
    active_subproject: str | None = None

    @property
    def path(self) -> Path:
        return self.manifest.path.parent

    @property
    def name(self) -> str:
        return self.manifest.project

    @property
    def is_monorepo(self) -> bool:
        return self.manifest.is_monorepo

    @property
    def subproject_names(self) -> list[str]:
        return self.manifest.all_subproject_names

    def subproject(self, name: str) -> Subproject | None:
        return self.manifest.subprojects.get(name)

    def lock_for(self, subproject: str | None = None) -> Lock | None:
        """Get the lock for a subproject (or the root if None)."""
        if subproject and subproject in self.subproject_locks:
            return self.subproject_locks[subproject]
        return self.root_lock

    def resolve_view(
        self, subproject: str | None = None, role: str | None = None
    ) -> ProjectView:
        """Resolve the active view for a subproject + role combination.

        Returns a ProjectView with the joined channel information ready for
        the TUI to display. The view computation follows:
            1. Pick the role (default = manifest.default_role)
            2. Find the role's view (or the default view)
            3. For each channel, resolve the mount + pinned ref
        """
        role = role or self.active_role
        subproject = subproject or self.active_subproject

        role_cfg = self.manifest.roles.get(role)
        if role_cfg is None:
            # Unknown role — return empty view
            return ProjectView(subproject=subproject, role=role)

        view_name = role_cfg.view
        if view_name is None:
            view_name = "default"
        view = self.manifest.views.get(view_name)
        if view is None:
            return ProjectView(subproject=subproject, role=role)

        # Walk the view's extends chain
        chain: list = []
        v = view
        seen: set[str] = set()
        while v is not None and v.name not in seen:
            seen.add(v.name)
            chain.append(v)
            if v.extends:
                v = self.manifest.views.get(v.extends)
            else:
                v = None
        # Reverse so the base view comes first, overrides on top
        chain.reverse()

        # Merge mounts across the chain
        merged_mounts: dict[str, Any] = {}
        for v in chain:
            merged_mounts.update(v.channels)

        # Resolve channels for this subproject
        channels = self.manifest.channels_for_subproject(subproject)
        lock = self.lock_for(subproject)

        resolved: dict[str, ResolvedChannelView] = {}
        for ch_name, ch_cfg in channels.items():
            mount = merged_mounts.get(ch_name)
            pinned = None
            if lock and ch_name in lock.channels:
                pinned = lock.channels[ch_name].ref.value
            resolved[ch_name] = ResolvedChannelView(
                channel_name=ch_name,
                channel_type=ch_cfg.type.value,
                transport=ch_cfg.transport,
                mount=mount.at if mount else None,
                history=mount.history if mount else ch_cfg.history.value,
                pinned_ref=pinned,
                scope=ch_cfg.scope,
            )

        return ProjectView(
            subproject=subproject,
            role=role,
            channels=resolved,
            active_view=view_name,
        )

    def set_role(self, role: str) -> None:
        """Set the active role. Silently ignored if the role is unknown."""
        if role in self.manifest.roles or role in ("end-user", "developer", "maintainer", "ci", "auditor"):
            self.active_role = role

    def set_subproject(self, subproject: str | None) -> None:
        """Set the active subproject. Pass None for the monorepo root."""
        if subproject is None or subproject in self.manifest.subprojects:
            self.active_subproject = subproject
        # For single projects, accept the project name as the implicit subproject
        elif not self.manifest.is_monorepo and subproject == self.manifest.project:
            self.active_subproject = None


def load_project(path: str | Path) -> Project:
    """Load a project from a path (file or directory).

    If the path is a k33p.yaml file, that's used. If it's a directory,
    the k33p.yaml in that directory is used. Subproject locks are loaded
    alongside the root lock.
    """
    path = Path(path)
    if path.is_dir():
        manifest_path = path / "k33p.yaml"
    else:
        manifest_path = path

    manifest = parse_manifest(manifest_path)
    project_root = manifest_path.parent
    root_lock = discover_lock(manifest_path)

    subproject_locks: dict[str, Lock] = {}
    for sub_name, sub in manifest.subprojects.items():
        sub_lock_path = project_root / sub.path / "k33p.lock"
        if sub_lock_path.exists():
            subproject_locks[sub_name] = parse_lock(sub_lock_path)

    # The CAS lives at .k33p/store/ if the project has been initialized
    store_path = project_root / ".k33p" / "store"
    if not store_path.exists():
        store_path = None

    return Project(
        manifest=manifest,
        root_lock=root_lock,
        subproject_locks=subproject_locks,
        store_path=store_path,
        active_role=manifest.default_role,
    )
