"""Migration tools for k33p — split subprojects, convert formats.

The ``k33p split`` command extracts a subproject from a monorepo into
a standalone k33p project.  The ``k33p convert`` command (future) will
translate k33p projects to other formats.
"""

from __future__ import annotations

from pathlib import Path


# ── split ────────────────────────────────────────────────────────────────


def cmd_split(
    project_path: str,
    subproject_name: str,
    target: str | None = None,
    *,
    force: bool = False,
) -> int:
    """Split a subproject from a monorepo into a standalone k33p project.

    Creates a new directory with its own ``k33p.yaml`` manifest that
    inherits the subproject's channel configuration but scopes all
    paths to the subproject's location.

    Args:
        project_path: Path to the monorepo.
        subproject_name: Name of the subproject to extract.
        target: Target directory (default: ``<subproject_name>`` in cwd).
        force: Overwrite existing files.

    Returns:
        0 on success, 1 on error.
    """
    import sys
    import shutil

    from k33p.project import load_project
    from k33p.channels import ChannelType

    try:
        project = load_project(project_path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    m = project.manifest

    if not m.is_monorepo:
        print(f"k33p: {m.project} is not a monorepo (type={m.type})",
              file=sys.stderr)
        return 1

    if subproject_name not in m.subprojects:
        print(f"k33p: subproject {subproject_name!r} not found in {m.project}",
              file=sys.stderr)
        print(f"  Available: {', '.join(m.subprojects.keys())}")
        return 1

    sub = m.subprojects[subproject_name]
    sub_path = project.path / sub.path

    if not sub_path.is_dir():
        print(f"k33p: subproject path {sub.path} does not exist",
              file=sys.stderr)
        return 1

    # Determine target
    if target is None:
        target_path = Path.cwd() / subproject_name
    else:
        target_path = Path(target).resolve()

    target_manifest = target_path / "k33p.yaml"
    if target_manifest.exists() and not force:
        print(
            f"k33p: {target_manifest} already exists (use --force to overwrite)",
            file=sys.stderr,
        )
        return 1

    # Build the new manifest
    target_path.mkdir(parents=True, exist_ok=True)

    # Determine channels for the new project
    # Start with channels defined in or overridden by the subproject
    channels = {}
    for ch_name, ch in sub.channels.items():
        channels[ch_name] = ch
    # Then inherit parent channels not overridden by the subproject
    for ch_name, parent_ch in m.channels.items():
        if ch_name not in channels:
            channels[ch_name] = parent_ch

    # Ensure at least a src channel — inherit from parent or make a minimal one
    if "src" not in channels:
        from k33p.channels import ChannelConfig
        channels["src"] = ChannelConfig(
            name="src",
            type=ChannelType.SOURCE,
            transport=str(sub_path),
            scope="./",
        )

    # Build YAML manually for a clean output
    yaml_lines = [
        f"# k33p.yaml — split from {m.project}/{subproject_name}",
        f"project: {subproject_name}",
        "type: single",
        f"description: {sub.description or f'Split from {m.project}'}",
        "",
        "channels:",
    ]

    for ch_name, ch in channels.items():
        yaml_lines.append(f"  {ch_name}:")
        if ch.type:
            yaml_lines.append(f"    type: {ch.type.value}")
        if ch.transport:
            yaml_lines.append(f"    transport: {ch.transport}")
        if ch.scope:
            yaml_lines.append(f"    scope: {ch.scope}")
        elif ch_name == "src":
            yaml_lines.append(f"    scope: ./")
        yaml_lines.append(f"    visibility: {ch.visibility.value}")
        yaml_lines.append(f"    history: {ch.history.value}")
        if ch.recipients:
            yaml_lines.append(f"    recipients:")
            for r in ch.recipients:
                yaml_lines.append(f"      - {r!r}")
        if ch.pinned:
            yaml_lines.append("    pinned: true")
        if ch.resolver:
            yaml_lines.append(f"    resolver: {ch.resolver}")
        if ch.encryption:
            yaml_lines.append(f"    encryption: {ch.encryption}")
        yaml_lines.append("")

    # Default views and roles
    yaml_lines.extend([
        "views:",
        "  default:",
        "    src: { at: \"./\" }",
        "",
        "roles:",
        "  developer:   { view: default }",
        "  maintainer:  { view: default, publish: [src] }",
        "",
    ])

    target_manifest.write_text("\n".join(yaml_lines), encoding="utf-8")

    # Initialise the store
    store_path = target_path / ".k33p" / "store"
    store_path.mkdir(parents=True, exist_ok=True)

    # Copy store objects from the monorepo (if they exist)
    copy_count = 0
    if project.store_path and project.store_path.is_dir():
        from k33p.store import ContentStore
        source_store = ContentStore(project.store_path)
        target_store = ContentStore(store_path)
        target_store.ensure()
        for obj in source_store.iter_objects():
            data = source_store.get(obj.hash)
            if data is not None and not target_store.has(obj.hash):
                target_store.put(data, kind=obj.kind)
                copy_count += 1

    print(f"✓ Split {subproject_name} from {m.project}")
    print(f"  from:  {project.path}")
    print(f"  to:    {target_path}")
    print(f"  channels: {len(channels)}")
    print(f"  objects copied: {copy_count}")
    if copy_count > 0:
        print(f"  manifest: {target_manifest}")
    return 0


# ── convert placeholder ─────────────────────────────────────────────────


def cmd_convert(
    project_path: str,
    target_format: str,
    output: str | None = None,
) -> int:
    """Convert a k33p project to another format.

    Supported formats (future): oci-image, flat-dir.

    Args:
        project_path: Path to the project.
        target_format: Output format.
        output: Output path (default: project name).

    Returns:
        0 on success, 1 on error.
    """
    import sys

    _ = project_path, target_format, output  # placeholder

    print(f"k33p: convert to {target_format!r} is not yet implemented",
          file=sys.stderr)
    print("  Planned formats: oci-image, flat-dir", file=sys.stderr)
    return 1
