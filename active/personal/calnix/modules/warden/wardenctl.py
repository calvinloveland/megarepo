#!/usr/bin/env python3
"""
wardenctl — Warden CLI for querying host health, running checks,
managing backups, and interacting with peer wardens.

Works with or without the wardend daemon by reading state files directly.

Usage:
  wardenctl status              Show host health summary
  wardenctl status --json       Machine-readable output
  wardenctl check <name>        Run a specific check now
  wardenctl checks              List all checks and their status
  wardenctl tail [-f]           Follow events
  wardenctl history <check>     Show recent check results
  wardenctl remediate [check]   Trigger remediation
  wardenctl identify            Show host identity

  wardenctl peer list           List known peers
  wardenctl peer status <name>  Query peer health
  wardenctl peer alert <name>   Send alert to peer

  wardenctl config show         Show current config
  wardenctl config set key val  Set config override

  wardenctl help                Show this message
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time

WARDEN_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(WARDEN_DIR))

from warden_state import (
    append_event,
    detect_last_boot,
    ensure_state_layout,
    follow_events,
    get_hostname,
    get_or_create_host_id,
    load_check_history,
    load_config,
    load_peer_status,
    load_state,
    list_peers,
    read_events,
    save_config,
    save_state,
    utc_now,
)

from runner import discover_checks, run_all_checks


def cmd_status(args: argparse.Namespace) -> None:
    state = load_state()

    if args.json:
        print(json.dumps(state, indent=2, default=str))
        return

    print(f"Hostname:        {state.get('hostname', 'unknown')}")
    print(f"Host ID:         {state.get('host_id', 'unknown')}")
    print(f"Warden version:  {state.get('warden_version', '?')}")
    print(f"Last boot:       {state.get('last_boot', 'unknown')}")
    print(f"Warden started:  {state.get('warden_started', 'unknown')}")
    print()

    # Checks
    checks = state.get("checks", {})
    if checks:
        print("Health checks:")
        for name, check in sorted(checks.items()):
            status_sym = {"pass": "✓", "warn": "⚠", "fail": "✗"}.get(check.get("status", ""), "?")
            last_run = check.get("last_run", "")[0:19] if check.get("last_run") else "never"
            print(f"  {status_sym} {name}: {check.get('status', 'unknown')} ({last_run})")
            if check.get("message"):
                print(f"     {check['message']}")
    else:
        print("No health checks have run yet. Run: wardenctl check all")

    # Generation
    gen = state.get("generation", {})
    if gen:
        print(f"\nNixOS generation: {gen.get('current', '?')}")
        last_rebuild = gen.get("last_rebuild", {})
        if last_rebuild:
            print(f"  Last rebuild: {last_rebuild.get('result', '?')} at {last_rebuild.get('timestamp', '?')}")

    # Backups
    backups = state.get("backups", {})
    if backups:
        last_run = backups.get("last_run", "")
        print(f"\nLast backup: {last_run[0:19] if last_run else 'never'}")
        repos = backups.get("repositories", {})
        if repos:
            print("  Repositories:")
            for name, repo in sorted(repos.items()):
                last = repo.get("last_success", "")[0:19] if repo.get("last_success") else "never"
                print(f"    {name}: last success {last}, {repo.get('snapshots', 0)} snapshots")

    # Peers
    peers = state.get("peers", {})
    if peers:
        print("\nPeers:")
        for name, peer in sorted(peers.items()):
            last = peer.get("last_seen", "")[0:19] if peer.get("last_seen") else "never"
            print(f"  {name}: {peer.get('status', 'unknown')} (last seen: {last})")


def cmd_check(args: argparse.Namespace) -> None:
    """Run a specific check or all checks."""
    if args.check_name and args.check_name != "all":
        check_names = [args.check_name]
        # Verify the check exists
        checks = discover_checks()
        if args.check_name not in checks:
            print(f"Unknown check: {args.check_name}")
            print(f"Available: {', '.join(sorted(checks.keys()))}")
            sys.exit(1)
    else:
        check_names = None

    print(f"Running checks...")
    results = run_all_checks(check_names=check_names)

    from runner import print_summary
    print_summary(results)

    if args.json:
        print(json.dumps(results, indent=2))


def cmd_tail(args: argparse.Namespace) -> None:
    """Tail events from the event log."""
    if args.follow:
        for event in follow_events():
            event_type = event.get("type", "?")
            check = event.get("check", "")
            status = event.get("status", "")
            ts = event.get("timestamp", "")[0:19]
            msg = event.get("message", "")
            print(f"[{ts}] {event_type}/{check}: {status} — {msg}")
    else:
        events = read_events(tail=args.tail or 20)
        for event in reversed(events):
            event_type = event.get("type", "?")
            check = event.get("check", "")
            status = event.get("status", "")
            ts = event.get("timestamp", "")[0:19]
            msg = event.get("message", "")
            print(f"[{ts}] {event_type}/{check}: {status} — {msg}")


def cmd_history(args: argparse.Namespace) -> None:
    """Show history for a specific check."""
    check_name = args.check_name
    history = load_check_history(check_name, tail=args.tail or 10)

    if not history:
        print(f"No history for check: {check_name}")
        return

    for entry in reversed(history):
        ts = entry.get("timestamp", "")[0:19]
        status = entry.get("status", "?")
        msg = entry.get("message", "")
        print(f"[{ts}] {status}: {msg}")


def cmd_identify(_args: argparse.Namespace) -> None:
    """Show host identity information."""
    hostname = get_hostname()
    host_id = get_or_create_host_id()
    print(f"Hostname: {hostname}")
    print(f"Host ID:  {host_id}")

    # Try to get Tailscale IP
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            self_info = data.get("Self", {})
            ips = self_info.get("TailscaleIPs", [])
            if ips:
                print(f"Tailnet:  {', '.join(ips)}")
    except Exception:
        pass


def cmd_config(args: argparse.Namespace) -> None:
    """Show or set config."""
    if args.action == "show":
        config = load_config()
        if config:
            print(json.dumps(config, indent=2))
        else:
            print("No local config overrides. Using Nix defaults.")
    elif args.action == "set":
        if not args.key or not args.value:
            print("Usage: wardenctl config set <key> <value>")
            return
        config = load_config()
        # Support dot-notation: "checks.disk-usage.thresholds.warn" → nested dict
        keys = args.key.split(".")
        target = config
        for k in keys[:-1]:
            if k not in target:
                target[k] = {}
            target = target[k]
        # Try to parse value as JSON
        try:
            target[keys[-1]] = json.loads(args.value)
        except (json.JSONDecodeError, TypeError):
            target[keys[-1]] = args.value
        save_config(config)
        print(f"Set {args.key} = {json.dumps(target[keys[-1]])}")


def cmd_peer(args: argparse.Namespace) -> None:
    """Peer operations."""
    if args.action == "list":
        peers = list_peers()
        if peers:
            print("Known peers:")
            for name in peers:
                status = load_peer_status(name)
                if status:
                    last = status.get("timestamp", "")[0:19] if status.get("timestamp") else "?"
                    print(f"  {name}: {status.get('status', '?')} (last: {last})")
                else:
                    print(f"  {name}: no cached status")
        else:
            print("No peers known. Configure peers in Nix module.")

    elif args.action == "status":
        if not args.peer_name:
            print("Usage: wardenctl peer status <peer_name>")
            return
        status = load_peer_status(args.peer_name)
        if status:
            if args.json:
                print(json.dumps(status, indent=2))
            else:
                print(f"Peer: {args.peer_name}")
                print(f"  Status: {status.get('status', '?')}")
                print(f"  Last seen: {(status.get('timestamp', '') or '?')[:19]}")
                if status.get('summary'):
                    print(f"  Summary: {status['summary']}")
        else:
            print(f"No cached status for peer: {args.peer_name}")
            print("Try: wardenctl peer query --host <hostname> <peer_name>")

    elif args.action == "query":
        """Query a peer Warden directly via its HTTP API."""
        if not args.peer_name or not args.host:
            print("Usage: wardenctl peer query <peer_name> --host <host> [--port <port>]")
            print("  Peer hostname defaults to the name from peer config.")
            return
        host = args.host
        port = args.port or 9090
        url = f"http://{host}:{port}/warden/status"
        print(f"Querying peer {args.peer_name} at {url}...", file=sys.stderr)
        try:
            import urllib.request
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
                # Cache the result
                save_peer_status(args.peer_name, {
                    "status": data.get("summary", {}).get("overall", "unknown"),
                    "summary": data.get("summary", {}),
                    "timestamp": data.get("warden_started", utc_now()),
                    "checks": data.get("checks", {}),
                    "hostname": data.get("hostname", host),
                    "source": "http_query",
                })
                if args.json:
                    print(json.dumps(data, indent=2, default=str))
                else:
                    hostname = data.get("hostname", args.peer_name)
                    overall = data.get("summary", {}).get("overall", "?")
                    print(f"Peer: {hostname}")
                    print(f"Overall: {overall}")
                    checks = data.get("checks", {})
                    if checks:
                        print("\nChecks:")
                        for name, check in sorted(checks.items()):
                            sym = {"pass": "\u2713", "warn": "\u26a0", "fail": "\u2717"}.get(check.get("status", ""), "?")
                            print(f"  {sym} {name}: {check.get('status', '?')}")
                            if check.get("message"):
                                print(f"     {check['message']}")
        except Exception as e:
            print(f"Failed to query peer {args.peer_name} at {url}: {e}")
            sys.exit(1)

    elif args.action == "alert":
        if not args.peer_name:
            print("Usage: wardenctl peer alert <peer_name>")
            return
        # Load peer config and send alert via HTTP
        config = load_config()
        peer_config = config.get("peers", {}).get(args.peer_name, {})
        host = peer_config.get("host", args.peer_name)
        port = peer_config.get("port", 9090)
        url = f"http://{host}:{port}/warden/alert"
        state = load_state()
        payload = {
            "hostname": get_hostname(),
            "host_id": get_or_create_host_id(),
            "status": "alert",
            "summary": state.get("summary", {}),
        }
        print(f"Alerting {args.peer_name} at {url}...", file=sys.stderr)
        try:
            import urllib.request
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "X-Warden-Host": get_hostname()},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read())
                print(f"Alert sent: {result}")
                append_event({
                    "type": "peer",
                    "peer": args.peer_name,
                    "event": "alert_outbound",
                    "payload": payload,
                })
        except Exception as e:
            print(f"Failed to alert peer {args.peer_name}: {e}")
            # Log locally anyway
            append_event({
                "type": "peer",
                "peer": args.peer_name,
                "event": "alert_outbound_failed",
                "error": str(e),
            })


def cmd_remediate(args: argparse.Namespace) -> None:
    """List or trigger remediation for checks."""
    warden_dir = Path(__file__).resolve().parent
    remediate_py = warden_dir / "remediation.py"

    if args.check_name:
        # Run remediation for this check via the engine
        import subprocess
        result = subprocess.run(
            [sys.executable, str(remediate_py), "run", args.check_name],
            capture_output=True,
            text=True,
            timeout=300,
        )
        print(result.stdout)
        if result.stderr.strip():
            print(result.stderr, file=sys.stderr)
    else:
        # List recent remediations
        state = load_state()
        remediation_history = state.get("remediation_history", [])
        if remediation_history:
            print("Recent remediations:")
            for entry in reversed(remediation_history[-10:]):
                ts = entry.get("timestamp", "")[0:19]
                check = entry.get("check", "?")
                action = entry.get("action", "?")
                status = entry.get("status", "?")
                print(f"  [{ts}] {check}: {action} → {status}")
        else:
            print("No remediation history.")


def cmd_backup(args: argparse.Namespace) -> None:
    """Backup operations."""
    cmd = args.backup_command
    if not cmd:
        print("Usage: wardenctl backup [run|status|snapshots|check|list-repos]")
        return

    runner_args = ["--json", cmd]
    if hasattr(args, 'repository') and args.repository:
        runner_args.extend(["--repository", args.repository])

    import subprocess
    warden_dir = Path(__file__).resolve().parent
    result = subprocess.run(
        [sys.executable, str(warden_dir / "backup_runner.py")] + runner_args,
        capture_output=True,
        text=True,
        timeout=7200,
    )

    if result.stdout.strip():
        try:
            data = json.loads(result.stdout)
            if isinstance(data, dict):
                if "repositories" in data:
                    print(f"Last backup run: {data.get('last_run', 'never')[:19]}")
                    for name, repo in data["repositories"].items():
                        last = (repo.get("last_success", "") or "never")[:19]
                        print(f"  {name}: {repo.get('status', '?')} (last: {last})")
                elif "message" in data:
                    print(data["message"])
                elif "error" in data:
                    print(f"Error: {data['message']}")
                else:
                    for name, res in data.items():
                        status = res.get("status", "?")
                        msg = res.get("message", res.get("output", ""))[:120]
                        print(f"  {name}: {status} \u2014 {msg}")
            elif isinstance(data, list):
                for r in data:
                    print(f"  {r['name']}: {r['type']} at {r['path']} ({r['paths']} paths)")
        except json.JSONDecodeError:
            print(result.stdout)
    if result.stderr.strip():
        print(result.stderr, file=sys.stderr)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Warden — per-host monitoring and management agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  wardenctl status
  wardenctl status --json
  wardenctl check disk-usage
  wardenctl tail -f
  wardenctl history temperature
  wardenctl peer list
  wardenctl config set checks.disk-usage.thresholds.warn 85
        """,
    )
    parser.add_argument("--state-dir", help="Override Warden state directory")

    subparsers = parser.add_subparsers(dest="command")

    # status
    status_parser = subparsers.add_parser("status", help="Show host health summary")
    status_parser.add_argument("--json", action="store_true", help="JSON output")

    # check
    check_parser = subparsers.add_parser("check", help="Run a health check")
    check_parser.add_argument("check_name", nargs="?", help="Check name (omit for all)")
    check_parser.add_argument("--json", action="store_true", help="JSON output")

    # checks (list)
    subparsers.add_parser("checks", help="List all checks and their status")

    # tail
    tail_parser = subparsers.add_parser("tail", help="Show recent events")
    tail_parser.add_argument("-f", "--follow", action="store_true", help="Follow new events")
    tail_parser.add_argument("-n", "--tail", type=int, default=20, help="Number of recent events")

    # history
    history_parser = subparsers.add_parser("history", help="Show check history")
    history_parser.add_argument("check_name", help="Check name")
    history_parser.add_argument("-n", "--tail", type=int, default=10, help="Number of entries")

    # identify
    subparsers.add_parser("identify", help="Show host identity")

    # config
    config_parser = subparsers.add_parser("config", help="Show or set configuration")
    config_parser.add_argument("action", choices=["show", "set"])
    config_parser.add_argument("key", nargs="?", help="Config key (dot notation)")
    config_parser.add_argument("value", nargs="?", help="Config value")

    # peer
    peer_parser = subparsers.add_parser("peer", help="Peer operations")
    peer_parser.add_argument("action", choices=["list", "status", "query", "alert"])
    peer_parser.add_argument("peer_name", nargs="?", help="Peer hostname")
    peer_parser.add_argument("--host", help="Peer hostname/IP for direct queries")
    peer_parser.add_argument("--port", type=int, help="Peer port")
    peer_parser.add_argument("--json", action="store_true", help="JSON output")

    # remediate
    remediate_parser = subparsers.add_parser("remediate", help="Trigger remediation")
    remediate_parser.add_argument("check_name", nargs="?", help="Check to remediate")

    # backup
    backup_parser = subparsers.add_parser("backup", help="Backup operations")
    backup_subparsers = backup_parser.add_subparsers(dest="backup_command")

    backup_run = backup_subparsers.add_parser("run", help="Run backup")
    backup_run.add_argument("--repository", "-r", help="Repository name (omit for all)")

    backup_subparsers.add_parser("status", help="Show backup status")

    backup_snap = backup_subparsers.add_parser("snapshots", help="List snapshots")
    backup_snap.add_argument("--repository", "-r", help="Repository name")

    backup_check = backup_subparsers.add_parser("check", help="Run integrity check")
    backup_check.add_argument("--repository", "-r", help="Repository name")

    backup_subparsers.add_parser("list-repos", help="List configured repositories")

    return parser


def main():
    ensure_state_layout()

    # Set state dir from env or arg
    state_dir = os.environ.get("WARDEN_STATE_DIR")
    if state_dir:
        os.environ["WARDEN_STATE_DIR"] = state_dir

    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # Dispatch
    dispatch = {
        "status": cmd_status,
        "check": cmd_check,
        "checks": lambda a: cmd_check(argparse.Namespace(check_name=None, json=a.json if hasattr(a, 'json') else False)),
        "tail": cmd_tail,
        "history": cmd_history,
        "identify": cmd_identify,
        "config": cmd_config,
        "peer": cmd_peer,
        "remediate": cmd_remediate,
        "backup": cmd_backup,
    }

    handler = dispatch.get(args.command)
    if handler:
        handler(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
