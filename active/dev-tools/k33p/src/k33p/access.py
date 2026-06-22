"""Multi-tenancy primitives for k33p — subproject-scoped permissions and team access.

The permission model is role-based:
- Each subproject has a set of teams/users with read/write/admin access
- Channel-level permissions (which channels a role can access in a subproject)
- Permissions are declared in the manifest and enforced by the CLI

For the MVP, permissions are stored in the manifest's ``visibility`` and
a new ``access`` section:
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ── types ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AccessEntry:
    """A single permission entry for a team or user."""

    subject: str  # team name or email
    role: str     # "read", "write", "admin"
    subproject: str | None = None  # None = monorepo-wide


@dataclass(frozen=True)
class PermissionConfig:
    """The permission configuration for a project.

    This is parsed from the manifest's optional ``access`` section.
    """

    entries: list[AccessEntry] = field(default_factory=list)


# ── permission helpers ──────────────────────────────────────────────────


def parse_access_config(manifest_data: dict[str, Any]) -> PermissionConfig:
    """Parse the access/permission config from manifest data.

    Looks for a ``permissions`` or ``access`` top-level key.
    """
    entries: list[AccessEntry] = []
    access_data = manifest_data.get("permissions") or manifest_data.get("access") or {}

    for entry in access_data.get("grants", []):
        subject = entry.get("to", "")
        role = entry.get("role", "read")
        subproject = entry.get("subproject")
        entries.append(AccessEntry(
            subject=subject, role=role, subproject=subproject,
        ))

    return PermissionConfig(entries=entries)


def format_permissions(entries: list[AccessEntry]) -> list[str]:
    """Format permission entries for display."""
    lines: list[str] = []
    for e in entries:
        scope = f"  [dim]({e.subproject})[/dim]" if e.subproject else ""
        role_str = {
            "read": "[green]read[/green]",
            "write": "[yellow]write[/yellow]",
            "admin": "[red]admin[/red]",
        }.get(e.role, e.role)
        lines.append(f"  • {e.subject}  →  {role_str}{scope}")
    return lines


# ── CLI commands ─────────────────────────────────────────────────────────


def cmd_grant(
    project_path: str,
    subject: str,
    role: str = "read",
    subproject: str | None = None,
) -> int:
    """Grant access to a team or user.

    For the MVP, this prints the intended grant and updates the
    manifest file with the new permission entry.
    """
    import sys
    import yaml

    from k33p.project import load_project

    try:
        project = load_project(project_path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    if role not in ("read", "write", "admin"):
        print(f"k33p: invalid role {role!r} (choose from: read, write, admin)",
              file=sys.stderr)
        return 1

    m = project.manifest

    # Read the current manifest
    manifest_path = project.path / "k33p.yaml"
    try:
        with manifest_path.open(encoding="utf-8") as f:
            manifest_data = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as e:
        print(f"k33p: failed to read manifest: {e}", file=sys.stderr)
        return 1

    # Add the grant
    manifest_data.setdefault("permissions", {}).setdefault("grants", [])
    new_grant = {"to": subject, "role": role}
    if subproject:
        new_grant["subproject"] = subproject

    # Check for duplicate
    for existing in manifest_data["permissions"]["grants"]:
        if (existing.get("to") == subject
                and existing.get("role") == role
                and existing.get("subproject") == subproject):
            print(f"k33p: grant already exists for {subject}"
                  f"{' on '+subproject if subproject else ''}",
                  file=sys.stderr)
            return 1

    manifest_data["permissions"]["grants"].append(new_grant)

    # Write back
    try:
        with manifest_path.open("w", encoding="utf-8") as f:
            yaml.dump(manifest_data, f, default_flow_style=False, sort_keys=False)
    except OSError as e:
        print(f"k33p: failed to write manifest: {e}", file=sys.stderr)
        return 1

    scope = f" on subproject '{subproject}'" if subproject else ""
    print(f"✓ Granted {role} access to {subject}{scope}")
    return 0


def cmd_revoke(
    project_path: str,
    subject: str,
    role: str | None = None,
    subproject: str | None = None,
) -> int:
    """Revoke access from a team or user.

    Removes matching permission entries from the manifest.
    """
    import sys
    import yaml

    from k33p.project import load_project

    try:
        project = load_project(project_path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    manifest_path = project.path / "k33p.yaml"
    try:
        with manifest_path.open(encoding="utf-8") as f:
            manifest_data = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as e:
        print(f"k33p: failed to read manifest: {e}", file=sys.stderr)
        return 1

    grants = list(manifest_data.get("permissions", {}).get("grants", []))
    before = len(grants)

    # Filter out matching entries
    remaining = [
        g for g in grants
        if not (
            g.get("to") == subject
            and (role is None or g.get("role") == role)
            and (subproject is None or g.get("subproject") == subproject)
        )
    ]
    removed = before - len(remaining)

    # Update the grants list
    manifest_data.setdefault("permissions", {})
    manifest_data["permissions"]["grants"] = remaining

    if removed == 0:
        print(f"k33p: no matching grant found for {subject}", file=sys.stderr)
        return 1

    try:
        with manifest_path.open("w", encoding="utf-8") as f:
            yaml.dump(manifest_data, f, default_flow_style=False, sort_keys=False)
    except OSError as e:
        print(f"k33p: failed to write manifest: {e}", file=sys.stderr)
        return 1

    scope = f" on subproject '{subproject}'" if subproject else ""
    print(f"✓ Revoked {removed} grant(s) for {subject}{scope}")
    return 0


def cmd_permissions(project_path: str) -> int:
    """List all permissions for a project."""
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

    # Parse access from visibility + optional access block
    print(f"Project: {m.project} ({m.type})")
    print(f"  Channels: {len(m.channels)}")

    # Show per-channel visibility
    print("\nChannel Visibility:")
    for ch_name, ch in m.channels.items():
        print(f"  • {ch_name}: {ch.visibility.value}")

    # Show subproject scoping
    if m.is_monorepo and m.subprojects:
        print(f"\nSubprojects ({len(m.subprojects)}):")
        for sp_name, sp in m.subprojects.items():
            print(f"  • {sp_name}  [dim]{sp.path}[/dim]")
            if sp.channels:
                for ch_name, ch in sp.channels.items():
                    scope = ch.scope or sp.path
                    print(f"      {ch_name}  scope={scope}")

    # Show grants from the access config
    import yaml
    manifest_path = project.path / "k33p.yaml"
    try:
        with manifest_path.open(encoding="utf-8") as f:
            manifest_data = yaml.safe_load(f) or {}
        access = parse_access_config(manifest_data)
        if access.entries:
            print(f"\nAccess Grants ({len(access.entries)}):")
            for line in format_permissions(access.entries):
                print(line)
        else:
            print("\nNo access grants configured.")
            print("  Use: k33p org grant <subject> --role <role> [--subproject <name>]")
    except (OSError, yaml.YAMLError):
        pass

    return 0
