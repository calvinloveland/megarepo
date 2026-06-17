"""CLI entry point for k33p.

For the MVP, the only subcommand is `tui` (the default), which launches
the terminal UI. Other subcommands will be added as the implementation
grows.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    """Run the k33p CLI."""
    parser = argparse.ArgumentParser(
        prog="k33p",
        description="Typed version control — channels, views, roles, daemon",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help="path to a project directory or k33p.yaml (default: current dir)",
    )
    parser.add_argument(
        "--subproject",
        "-s",
        default=None,
        help="subproject to focus on (monorepo only)",
    )
    parser.add_argument(
        "--role",
        "-r",
        default=None,
        help="role to use (default: from manifest)",
    )
    parser.add_argument(
        "--print-manifest",
        action="store_true",
        help="print the parsed manifest as JSON and exit",
    )
    parser.add_argument(
        "--print-lock",
        action="store_true",
        help="print the parsed lock as JSON and exit",
    )
    parser.add_argument(
        "--no-tui",
        action="store_true",
        help="don't launch the TUI; just load the project and exit",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="print k33p version and exit",
    )

    args = parser.parse_args(argv)

    if args.version:
        from k33p.__about__ import __version__

        print(f"k33p {__version__}")
        return 0

    # Defer imports so --version doesn't require yaml/textual
    from k33p.project import load_project

    try:
        project = load_project(args.path)
    except FileNotFoundError as e:
        print(f"k33p: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 — surface all manifest errors helpfully
        print(f"k33p: failed to load project: {e}", file=sys.stderr)
        return 1

    if args.subproject:
        project.set_subproject(args.subproject)
    if args.role:
        project.set_role(args.role)

    if args.print_manifest:
        _print_manifest(project)
        return 0

    if args.print_lock:
        _print_lock(project)
        return 0

    if args.no_tui:
        _print_summary(project)
        return 0

    # Launch the TUI
    from k33p.tui.app import K33pApp

    app = K33pApp(project)
    app.run()
    return 0


def _print_manifest(project) -> None:
    """Print the parsed manifest as a readable summary."""
    m = project.manifest
    print(f"# {m.project} ({m.type})")
    if m.description:
        print(f"\n  {m.description}")
    if m.org or m.team:
        loc = " / ".join(filter(None, [m.org, m.team]))
        print(f"  org/team: {loc}")
    print(f"  manifest: {m.path}")

    print(f"\n## Channels ({len(m.channels)})")
    for ch_name, ch in m.channels.items():
        print(f"  - {ch_name}: {ch.type.value} → {ch.transport}")
        if ch.scope:
            print(f"      scope: {ch.scope}")
        if ch.history != ch.history.__class__.FULL or ch.history_ring is not None:
            ring = f"({ch.history_ring})" if ch.history_ring else ""
            print(f"      history: {ch.history.value}{ring}")

    if m.is_monorepo:
        print(f"\n## Subprojects ({len(m.subprojects)})")
        for sp_name, sp in m.subprojects.items():
            print(f"  - {sp_name} @ {sp.path}")
            if sp.channels:
                for ch_name in sp.channels:
                    print(f"      channel override: {ch_name}")

    print(f"\n## Views ({len(m.views)})")
    for v_name, v in m.views.items():
        extends = f" extends {v.extends}" if v.extends else ""
        print(f"  - {v_name}{extends} ({len(v.channels)} channel mounts)")

    print(f"\n## Roles ({len(m.roles)})")
    for r_name, r in m.roles.items():
        view = r.view or "(default)"
        print(f"  - {r_name}: view={view}")

    if m.daemon and m.daemon.auto_commit:
        ac = m.daemon.auto_commit
        print("\n## Daemon (auto_commit)")
        print(f"  enabled: {ac.enabled}, debounce: {ac.debounce}")
        if ac.paths:
            print(f"  paths: {', '.join(ac.paths)}")


def _print_lock(project) -> None:
    """Print the parsed lock as a readable summary."""
    lock = project.root_lock
    if lock is None:
        print("No k33p.lock at the project root.")
        if project.subproject_locks:
            print(f"Subproject locks: {', '.join(project.subproject_locks.keys())}")
        return

    print(f"# k33p.lock ({lock.path})")
    if lock.generated:
        print(f"  generated: {lock.generated}")

    if lock.channels:
        print(f"\n## Channels ({len(lock.channels)})")
        for ch_name, ch_lock in lock.channels.items():
            print(f"  - {ch_name}: {ch_lock.ref}")

    if lock.toolchain:
        t = lock.toolchain
        print("\n## Toolchain")
        for field_name in ("compiler", "build_system", "linker", "codegen_opts", "env_hash"):
            val = getattr(t, field_name)
            if val:
                print(f"  {field_name}: {val}")
        if t.extras:
            for k, v in t.extras.items():
                print(f"  {k}: {v}")

    if lock.signature:
        print(f"\n## Signature ({lock.signature.algorithm})")
        print(f"  key: {lock.signature.key}")
        print(f"  sig: {lock.signature.sig[:32]}...")


def _print_summary(project) -> None:
    """Print a short summary of the loaded project."""
    m = project.manifest
    print(f"Loaded: {m.project} ({m.type}) at {m.path}")
    print(f"  {len(m.channels)} channels, {len(m.subprojects)} subprojects, "
          f"{len(m.roles)} roles")
    if project.root_lock:
        print(f"  lock: {project.root_lock.path} "
              f"({len(project.root_lock.channels)} channel pins)")
    if project.store_path:
        from k33p.store import ContentStore
        stats = ContentStore(project.store_path).stats()
        print(f"  store: {stats.object_count} objects, "
              f"{stats.total_bytes / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    raise SystemExit(main())
