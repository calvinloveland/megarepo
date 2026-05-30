#!/usr/bin/env python3
"""
Warden backup runner — manages restic backups with repository configuration,
scheduling, integrity checks, and retention policies.

Configuration from /var/lib/warden/config.json or command-line args.

Usage:
  python3 backup_runner.py run [--repository NAME]
  python3 backup_runner.py status
  python3 backup_runner.py snapshots
  python3 backup_runner.py check [--repository NAME]
  python3 backup_runner.py list-repos
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

WARDEN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WARDEN_DIR))

from warden_state import (
    append_event,
    load_config,
    load_state,
    save_state,
    utc_now,
)


def get_restic_binary() -> str:
    """Find restic binary."""
    restic = os.environ.get("RESTIC_BIN", "restic")
    return restic


def run_restic(
    args: list[str],
    env: dict[str, str] | None = None,
    timeout: int = 3600,
) -> subprocess.CompletedProcess:
    """Run a restic command with the given arguments."""
    cmd = [get_restic_binary()] + args
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=merged_env,
    )


def get_repo_config(
    repo_name: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Get configuration for a specific backup repository."""
    if config is None:
        config = load_config()
    repos = config.get("backups", {}).get("repositories", {})
    return repos.get(repo_name)


def get_backup_env(repo_config: dict[str, Any]) -> dict[str, str]:
    """Build environment variables for restic from repository config."""
    env = {}
    password_file = repo_config.get("passwordFile")
    if password_file:
        env["RESTIC_PASSWORD_FILE"] = password_file
    elif repo_config.get("password"):
        env["RESTIC_PASSWORD"] = repo_config["password"]

    # Handle different repository types
    repo_url = repo_config.get("path", "")
    if repo_config.get("type") == "sftp":
        host = repo_config.get("host", "")
        path = repo_url
        env["RESTIC_REPOSITORY"] = f"sftp:{host}:{path}"
    elif repo_config.get("type") == "rest":
        env["RESTIC_REPOSITORY"] = repo_url
    else:
        env["RESTIC_REPOSITORY"] = repo_url

    # Extra env vars
    for key, value in repo_config.get("extraEnv", {}).items():
        env[key] = value

    return env


def ensure_repository(repo_config: dict[str, Any]) -> bool:
    """Initialize a restic repository if it doesn't exist."""
    env = get_backup_env(repo_config)
    result = run_restic(["snapshots", "--limit", "1"], env=env, timeout=30)
    if result.returncode == 0:
        return True
    # Try to init
    result = run_restic(["init"], env=env, timeout=60)
    return result.returncode == 0


def cmd_run(repo_name: str | None = None) -> dict[str, Any]:
    """Run backups for all configured repositories, or a specific one."""
    config = load_config()
    backups_cfg = config.get("backups", {})
    repos = backups_cfg.get("repositories", {})

    if not repos:
        return {"status": "error", "message": "No backup repositories configured"}

    results: dict[str, Any] = {}
    for name, repo_cfg in repos.items():
        if repo_name and name != repo_name:
            continue

        print(f"[backup] Starting backup to {name}...", file=sys.stderr)
        start_time = datetime.now(timezone.utc)

        env = get_backup_env(repo_cfg)
        paths = repo_cfg.get("paths", [])

        if not paths:
            results[name] = {"status": "skipped", "message": "No backup paths configured"}
            continue

        # Ensure repo exists
        if not ensure_repository(repo_cfg):
            results[name] = {"status": "error", "message": "Failed to init repository"}
            append_event({
                "type": "backup",
                "repository": name,
                "status": "error",
                "message": "Repository init failed",
            })
            continue

        # Exclude patterns
        exclude_args = []
        for pattern in repo_cfg.get("exclude", []):
            exclude_args.extend(["--exclude", pattern])

        # Run restic backup
        try:
            # Build path args: each path is a positional arg
            path_args = paths if isinstance(paths, list) else [paths]
            result = run_restic(
                ["backup", "--verbose"] + exclude_args + path_args,
                env=env,
                timeout=repo_cfg.get("timeout", 3600),
            )

            duration = (datetime.now(timezone.utc) - start_time).total_seconds()

            if result.returncode == 0:
                # Parse snapshot ID from output
                snap_id = ""
                for line in result.stdout.split("\n"):
                    if "snapshot" in line.lower() and "saved" in line.lower():
                        parts = line.strip().split()
                        if parts:
                            snap_id = parts[-1]
                            break

                results[name] = {
                    "status": "success",
                    "duration_sec": round(duration, 1),
                    "snapshot": snap_id,
                    "message": f"Backup completed in {duration:.1f}s",
                }
                append_event({
                    "type": "backup",
                    "repository": name,
                    "status": "success",
                    "duration_sec": round(duration, 1),
                })
            else:
                results[name] = {
                    "status": "error",
                    "duration_sec": round(duration, 1),
                    "message": result.stderr.strip() or f"Exit code {result.returncode}",
                }
                append_event({
                    "type": "backup",
                    "repository": name,
                    "status": "error",
                    "message": result.stderr.strip()[:500],
                })

        except subprocess.TimeoutExpired:
            results[name] = {"status": "error", "message": "Backup timed out"}
            append_event({"type": "backup", "repository": name, "status": "error", "message": "Timed out"})
        except FileNotFoundError:
            results[name] = {"status": "error", "message": "restic binary not found"}
            append_event({"type": "backup", "repository": name, "status": "error", "message": "restic not found"})

    # Update state with backup metadata
    state = load_state()
    state.setdefault("backups", {})
    state["backups"]["last_run"] = utc_now()
    state["backups"]["last_results"] = results
    repos_state = state["backups"].setdefault("repositories", {})
    for name, result in results.items():
        if result.get("status") == "success":
            repos_state[name] = {
                "last_success": utc_now(),
                "status": "ok",
            }
        elif result.get("status") == "error":
            repos_state[name] = repos_state.get(name, {})
            repos_state[name]["last_error"] = utc_now()
            repos_state[name]["status"] = "error"
    save_state(state)

    return results


def cmd_status() -> dict[str, Any]:
    """Show backup status from state."""
    state = load_state()
    backups = state.get("backups", {})
    return {
        "last_run": backups.get("last_run", ""),
        "repositories": backups.get("repositories", {}),
        "last_results": backups.get("last_results", {}),
    }


def cmd_snapshots(repo_name: str | None = None) -> dict[str, Any]:
    """List snapshots from one or all repositories."""
    config = load_config()
    repos = config.get("backups", {}).get("repositories", {})
    results: dict[str, Any] = {}

    for name, repo_cfg in repos.items():
        if repo_name and name != repo_name:
            continue
        env = get_backup_env(repo_cfg)
        try:
            result = run_restic(["snapshots"], env=env, timeout=30)
            if result.returncode == 0:
                results[name] = {"status": "ok", "output": result.stdout}
            else:
                results[name] = {"status": "error", "message": result.stderr.strip()}
        except Exception as e:
            results[name] = {"status": "error", "message": str(e)}

    return results


def cmd_check(repo_name: str | None = None) -> dict[str, Any]:
    """Run integrity check on one or all repositories."""
    config = load_config()
    repos = config.get("backups", {}).get("repositories", {})
    results: dict[str, Any] = {}

    for name, repo_cfg in repos.items():
        if repo_name and name != repo_name:
            continue
        print(f"[backup] Checking {name}...", file=sys.stderr)
        env = get_backup_env(repo_cfg)
        try:
            result = run_restic(["check", "--read-data-subset", "5%"], env=env, timeout=3600)
            if result.returncode == 0:
                results[name] = {"status": "ok", "message": "Integrity check passed"}
                append_event({"type": "backup", "repository": name, "status": "check_ok"})
            else:
                results[name] = {"status": "error", "message": result.stderr.strip()[:500]}
                append_event({"type": "backup", "repository": name, "status": "check_failed", "message": result.stderr.strip()[:500]})
        except subprocess.TimeoutExpired:
            results[name] = {"status": "error", "message": "Check timed out"}
        except FileNotFoundError:
            results[name] = {"status": "error", "message": "restic not found"}

    return results


def cmd_list_repos() -> list[dict[str, Any]]:
    """List configured backup repositories."""
    config = load_config()
    repos = config.get("backups", {}).get("repositories", {})
    return [
        {
            "name": name,
            "type": repo.get("type", "local"),
            "path": repo.get("path", ""),
            "schedule": repo.get("schedule", ""),
            "paths": len(repo.get("paths", [])),
        }
        for name, repo in repos.items()
    ]


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Warden backup runner")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run backup")
    run_parser.add_argument("--repository", "-r", help="Repository name (omit for all)")

    subparsers.add_parser("status", help="Show backup status")

    snap_parser = subparsers.add_parser("snapshots", help="List snapshots")
    snap_parser.add_argument("--repository", "-r", help="Repository name")

    check_parser = subparsers.add_parser("check", help="Run integrity check")
    check_parser.add_argument("--repository", "-r", help="Repository name")

    subparsers.add_parser("list-repos", help="List configured repositories")

    parser.add_argument("--json", action="store_true", help="JSON output")

    args = parser.parse_args()

    if args.command == "run":
        result = cmd_run(args.repository)
    elif args.command == "status":
        result = cmd_status()
    elif args.command == "snapshots":
        result = cmd_snapshots(args.repository)
    elif args.command == "check":
        result = cmd_check(args.repository)
    elif args.command == "list-repos":
        result = cmd_list_repos()
    else:
        parser.print_help()
        return

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        if isinstance(result, list):
            for r in result:
                print(f"  {r['name']}: {r['type']} at {r['path']} ({r['paths']} paths)")
        elif isinstance(result, dict):
            if "repositories" in result:
                repos = result["repositories"]
                print(f"Last backup run: {result.get('last_run', 'never')[:19]}")
                for name, repo in repos.items():
                    last = (repo.get("last_success", "") or "never")[:19]
                    print(f"  {name}: {repo.get('status', '?')} (last success: {last})")
            elif "message" in result:
                print(result["message"])
            else:
                for name, res in result.items():
                    status = res.get("status", "?")
                    msg = res.get("message", res.get("output", ""))[:120]
                    print(f"  {name}: {status} — {msg}")
        sys.exit(0 if all(
            isinstance(r, dict) and (r.get("status") == "success" or r.get("status") == "ok")
            for r in (result.values() if isinstance(result, dict) else result)
        ) else 1)


if __name__ == "__main__":
    main()
