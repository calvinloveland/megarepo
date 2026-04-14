#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from calnix_state import (  # noqa: E402
    CalnixStateError,
    active_package_policies,
    current_system,
    effective_policy,
    effective_revision,
    ensure_package_state,
    find_repo_root,
    latest_confirmed_revision,
    list_generation_metadata,
    load_flake_lock,
    load_registry,
    load_state,
    nixpkgs_locked_reference,
    nixpkgs_locked_revision,
    resolve_state_dir,
    save_state,
    short_revision,
    update_package_state,
    utc_now,
    evaluate_package_version,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage calnix package health and generation history.")
    parser.add_argument("--state-dir", default=None, help="Override the machine-local calnix state directory")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON output")

    subparsers = parser.add_subparsers(dest="command", required=True)

    package_parser = subparsers.add_parser("package", help="Inspect and update package health state")
    package_subparsers = package_parser.add_subparsers(dest="package_command", required=True)

    package_subparsers.add_parser("list", help="List health-managed packages")

    package_status = package_subparsers.add_parser("status", help="Show package health status")
    package_status.add_argument("package", nargs="?", help="Optional package name")

    package_history = package_subparsers.add_parser("history", help="Show package history")
    package_history.add_argument("package")

    package_confirm = package_subparsers.add_parser("confirm", help="Record the currently selected package source as working")
    package_confirm.add_argument("package")
    package_confirm.add_argument("--repo", default=None, help="Path to the calnix repo containing flake.lock")
    package_confirm.add_argument("--notes", default="", help="Optional notes about why this version is working")

    package_fail = package_subparsers.add_parser("mark-failing", help="Mark the current package version as failing and activate rollback")
    package_fail.add_argument("package")
    package_fail.add_argument("--repo", default=None, help="Path to the calnix repo containing flake.lock")
    package_fail.add_argument("--notes", default="", help="Optional failure notes")

    package_observe = package_subparsers.add_parser("observe-healthy", help="Record a runtime-healthy observation")
    package_observe.add_argument("package")
    package_observe.add_argument("--minutes", type=int, default=60, help="Approximate healthy runtime in minutes")
    package_observe.add_argument("--notes", default="", help="Optional observation notes")

    package_current = package_subparsers.add_parser("use-current", help="Stop forcing a rollback and prefer current nixpkgs")
    package_current.add_argument("package")
    package_current.add_argument("--notes", default="", help="Optional note about why current should be retried")

    generation_parser = subparsers.add_parser("generation", help="Inspect recorded generation history")
    generation_subparsers = generation_parser.add_subparsers(dest="generation_command", required=True)

    generation_list = generation_subparsers.add_parser("list", help="List recorded generation metadata")
    generation_list.add_argument("--limit", type=int, default=10, help="Maximum number of generations to show")

    subparsers.add_parser("rebuild", help="Run the calnix rebuild helper")

    export_parser = subparsers.add_parser("export", help="Export the full calnix machine-local state")
    export_parser.add_argument("--pretty", action="store_true", help="Pretty-print the exported state")

    return parser


def managed_package(registry: dict[str, Any], package_name: str) -> dict[str, Any]:
    package = registry.get("packages", {}).get(package_name)
    if package is None:
        available = ", ".join(sorted(registry.get("packages", {})))
        raise CalnixStateError(f"Unknown package '{package_name}'. Managed packages: {available}")
    return package


def emit_json(data: Any, pretty: bool = False) -> None:
    if pretty:
        print(json.dumps(data, indent=2, sort_keys=True))
    else:
        print(json.dumps(data, sort_keys=True))


def command_package_list(registry: dict[str, Any], args: argparse.Namespace) -> int:
    packages = [
        {
            "package": name,
            "attr_path": entry["attrPath"],
            "default_policy": entry.get("defaultPolicy", "current"),
            "description": entry.get("description", ""),
        }
        for name, entry in sorted(registry.get("packages", {}).items())
    ]
    if args.json:
        emit_json(packages, pretty=True)
        return 0
    for package in packages:
        print(f"{package['package']}: {package['default_policy']} ({package['description']})")
    return 0


def package_status_payload(
    registry: dict[str, Any], state: dict[str, Any], package_name: str | None
) -> Any:
    if package_name:
        registry_entry = managed_package(registry, package_name)
        package_state = state.get("packages", {}).get(package_name, {})
        return {
            "package": package_name,
            "description": registry_entry.get("description", ""),
            "default_policy": registry_entry.get("defaultPolicy", "current"),
            "active_policy": effective_policy(package_state, registry_entry),
            "active_revision": effective_revision(package_state),
            "confirmations": package_state.get("confirmations", []),
            "failures": package_state.get("failures", []),
            "observations": package_state.get("observations", []),
        }

    return active_package_policies(state, registry)


def command_package_status(registry: dict[str, Any], state: dict[str, Any], args: argparse.Namespace) -> int:
    payload = package_status_payload(registry, state, args.package)
    if args.json:
        emit_json(payload, pretty=True)
        return 0

    if args.package:
        print(f"Package: {payload['package']}")
        print(f"Default policy: {payload['default_policy']}")
        print(f"Active policy: {payload['active_policy']}")
        print(f"Active revision: {short_revision(payload['active_revision'])}")
        print(f"Confirmations: {len(payload['confirmations'])}")
        print(f"Failures: {len(payload['failures'])}")
        print(f"Observations: {len(payload['observations'])}")
        return 0

    for entry in payload:
        detail = short_revision(entry["revision"])
        suffix = " degraded" if entry["degraded"] else ""
        print(f"{entry['package']}: {entry['policy']} ({detail}){suffix}")
    return 0


def command_package_history(registry: dict[str, Any], state: dict[str, Any], args: argparse.Namespace) -> int:
    payload = package_status_payload(registry, state, args.package)
    if args.json:
        emit_json(payload, pretty=True)
        return 0
    print(f"History for {payload['package']}")
    for label in ("confirmations", "failures", "observations"):
        print(f"{label.capitalize()}:")
        entries = payload[label]
        if not entries:
            print("  (none)")
            continue
        for item in entries:
            revision = short_revision(item.get("nixpkgs_rev"))
            detail = item.get("notes") or item.get("reason") or ""
            print(f"  - {item.get('timestamp', 'unknown time')} [{revision}] {detail}".rstrip())
    return 0


def determine_selected_source(
    package_name: str,
    registry: dict[str, Any],
    state: dict[str, Any],
    repo_root: Path,
) -> dict[str, Any]:
    registry_entry = managed_package(registry, package_name)
    package_state = state.get("packages", {}).get(package_name, {})
    lock_data = load_flake_lock(repo_root)
    current_rev = nixpkgs_locked_revision(lock_data)
    current_ref = nixpkgs_locked_reference(lock_data)
    policy = effective_policy(package_state, registry_entry)
    revision = effective_revision(package_state) or current_rev
    nixpkgs_ref = current_ref if revision == current_rev else f"github:NixOS/nixpkgs/{revision}"
    version = evaluate_package_version(registry_entry["attrPath"], nixpkgs_ref, current_system())
    return {
        "policy": policy,
        "revision": revision,
        "nixpkgs_ref": nixpkgs_ref,
        "version": version,
        "current_revision": current_rev,
    }


def command_package_confirm(registry: dict[str, Any], state_dir: Path, args: argparse.Namespace) -> int:
    registry_entry = managed_package(registry, args.package)
    state = load_state(state_dir)
    package_state = ensure_package_state(state, args.package)
    repo_root = find_repo_root(args.repo)
    selected = determine_selected_source(args.package, registry, state, repo_root)

    package_state["confirmations"].append(
        {
            "timestamp": utc_now(),
            "nixpkgs_rev": selected["revision"],
            "version": selected["version"],
            "policy": selected["policy"],
            "notes": args.notes,
            "attr_path": registry_entry["attrPath"],
        }
    )
    update_package_state(state, args.package, package_state)
    save_state(state, state_dir)

    if args.json:
        emit_json({"package": args.package, "confirmed": selected}, pretty=True)
    else:
        print(
            f"Confirmed {args.package} {selected['version']} from {short_revision(selected['revision'])} "
            f"using policy {selected['policy']}."
        )
    return 0


def command_package_mark_failing(registry: dict[str, Any], state_dir: Path, args: argparse.Namespace) -> int:
    registry_entry = managed_package(registry, args.package)
    state = load_state(state_dir)
    package_state = ensure_package_state(state, args.package)
    repo_root = find_repo_root(args.repo)
    lock_data = load_flake_lock(repo_root)
    current_rev = nixpkgs_locked_revision(lock_data)
    fallback_revision = latest_confirmed_revision(package_state, current_rev)

    if fallback_revision:
        package_state["active_policy"] = "revision"
        package_state["active_revision"] = fallback_revision
        activated_policy = "revision"
    else:
        default_policy = registry_entry.get("defaultPolicy", "current")
        if default_policy == "current":
            raise CalnixStateError(
                f"No previously confirmed working revision exists for {args.package}. "
                "Confirm a good version first before asking calnix to roll back."
            )
        package_state["active_policy"] = default_policy
        package_state["active_revision"] = None
        activated_policy = default_policy

    package_state["failures"].append(
        {
            "timestamp": utc_now(),
            "nixpkgs_rev": current_rev,
            "notes": args.notes,
            "activated_policy": activated_policy,
        }
    )
    update_package_state(state, args.package, package_state)
    save_state(state, state_dir)

    payload = {
        "package": args.package,
        "activated_policy": activated_policy,
        "active_revision": package_state.get("active_revision"),
    }
    if args.json:
        emit_json(payload, pretty=True)
    else:
        revision_text = short_revision(package_state.get("active_revision"))
        print(f"Marked {args.package} failing; next rebuild will use {activated_policy} ({revision_text}).")
    return 0


def command_package_observe(registry: dict[str, Any], state_dir: Path, args: argparse.Namespace) -> int:
    managed_package(registry, args.package)
    state = load_state(state_dir)
    package_state = ensure_package_state(state, args.package)
    package_state["observations"].append(
        {
            "timestamp": utc_now(),
            "kind": "runtime-healthy",
            "minutes": args.minutes,
            "notes": args.notes,
        }
    )
    update_package_state(state, args.package, package_state)
    save_state(state, state_dir)
    if args.json:
        emit_json({"package": args.package, "minutes": args.minutes}, pretty=True)
    else:
        print(f"Recorded a healthy runtime observation for {args.package} ({args.minutes} minutes).")
    return 0


def command_package_use_current(registry: dict[str, Any], state_dir: Path, args: argparse.Namespace) -> int:
    managed_package(registry, args.package)
    state = load_state(state_dir)
    package_state = ensure_package_state(state, args.package)
    package_state["active_policy"] = "current"
    package_state["active_revision"] = None
    if args.notes:
        package_state["observations"].append(
            {
                "timestamp": utc_now(),
                "kind": "policy-reset",
                "notes": args.notes,
            }
        )
    update_package_state(state, args.package, package_state)
    save_state(state, state_dir)
    if args.json:
        emit_json({"package": args.package, "active_policy": "current"}, pretty=True)
    else:
        print(f"{args.package} will use the current flake nixpkgs revision on the next rebuild.")
    return 0


def command_generation_list(state_dir: Path, args: argparse.Namespace) -> int:
    records = list_generation_metadata(state_dir, limit=args.limit)
    if args.json:
        emit_json(records, pretty=True)
        return 0
    if not records:
        print("No generation metadata recorded yet.")
        return 0
    for record in records:
        status = record.get("robustness", {}).get("status", "unknown")
        duration = record.get("timings", {}).get("total_seconds", "?")
        print(f"generation {record.get('generation')}: {duration}s {status}")
    return 0


def command_export(state_dir: Path, args: argparse.Namespace) -> int:
    emit_json(load_state(state_dir), pretty=args.pretty or args.json)
    return 0


def build_global_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--state-dir", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--json", action="store_true", help=argparse.SUPPRESS)
    return parser


def resolve_rebuild_script() -> Path:
    env_path = os.environ.get("CALNIX_REBUILD_SCRIPT")
    if env_path:
        candidate = Path(env_path)
        if candidate.exists():
            return candidate
        raise CalnixStateError(f"Configured rebuild script not found: {candidate}")

    candidate = Path(__file__).resolve().with_name("rebuild.py")
    if candidate.exists():
        return candidate

    repo_root = find_repo_root()
    candidate = repo_root / "rebuild.py"
    if candidate.exists():
        return candidate

    raise CalnixStateError("Unable to locate rebuild.py for `calnix rebuild`.")


def command_rebuild(state_dir: str | None, rebuild_args: list[str], json_requested: bool) -> int:
    if json_requested:
        raise CalnixStateError("`calnix rebuild` does not support --json.")

    script = resolve_rebuild_script()
    env = os.environ.copy()
    if state_dir is not None:
        env["CALNIX_STATE_DIR"] = str(state_dir)

    result = subprocess.run([sys.executable, str(script), *rebuild_args], check=False, env=env)
    return result.returncode


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(argv) if argv is not None else sys.argv[1:]
    global_args, remaining = build_global_parser().parse_known_args(raw_argv)

    if remaining and remaining[0] == "rebuild":
        try:
            return command_rebuild(global_args.state_dir, remaining[1:], global_args.json)
        except CalnixStateError as exc:
            print(f"calnix: {exc}", file=sys.stderr)
            return 1

    parser = build_parser()
    args = parser.parse_args(raw_argv)
    state_dir = resolve_state_dir(args.state_dir)

    try:
        registry = load_registry()
        if args.command == "package":
            state = load_state(state_dir)
            if args.package_command == "list":
                return command_package_list(registry, args)
            if args.package_command == "status":
                return command_package_status(registry, state, args)
            if args.package_command == "history":
                return command_package_history(registry, state, args)
            if args.package_command == "confirm":
                return command_package_confirm(registry, state_dir, args)
            if args.package_command == "mark-failing":
                return command_package_mark_failing(registry, state_dir, args)
            if args.package_command == "observe-healthy":
                return command_package_observe(registry, state_dir, args)
            if args.package_command == "use-current":
                return command_package_use_current(registry, state_dir, args)

        if args.command == "generation" and args.generation_command == "list":
            return command_generation_list(state_dir, args)

        if args.command == "export":
            return command_export(state_dir, args)
    except CalnixStateError as exc:
        parser.exit(1, f"calnix: {exc}\n")

    parser.exit(2, "Unhandled command\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
