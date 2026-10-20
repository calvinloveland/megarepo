#!/usr/bin/env python3
"""Verify the calnix cross-host SSH mesh.

The mesh is assured in two layers:

1. Static (offline, default) — the shared ``modules/base.nix`` authorizes every
   host's client key and every host imports that module, so a rebuild cannot
   silently drop SSH access. This is what makes "1337book can SSH into haswell
   and thinker" durable rather than an accident of a hand-edited
   ``~/.ssh/authorized_keys``.
2. Live (opt-in, ``--live``) — actually hop through each source host and run a
   command on each target, proving the keys work end-to-end right now.

Usage:
    python3 scripts/verify_ssh_mesh.py                 # static checks only
    python3 scripts/verify_ssh_mesh.py --live          # static + live SSH hops
    python3 scripts/verify_ssh_mesh.py --live \
        --from 1337book --to haswell thinker           # narrow the check
"""

from __future__ import annotations

import argparse
import re
import shlex
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SSH_USER = "calvin"

# Client key each host presents when it initiates SSH. These are the public
# halves of ``~/.ssh/id_ed25519.pub`` on each host. Rotate here and in
# ``modules/base.nix`` together.
HOST_CLIENT_KEYS: dict[str, str] = {
    "haswell": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICDpCMmZqccnMEQ+S4Gl9vR9y6Gfxi6dqUteuECefOsS calvin@haswell",
    "1337book": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDwix44A6TqqGOokU/gIpaf3shN0Pad+S08M36flhBZv calvin@loveland.dev",
    "thinker": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEtQPcJzTpW1SkWCrxmtju0HEIuyvppXCVnvNscLgbgT calvin@loveland.dev",
}

HOSTS = tuple(HOST_CLIENT_KEYS)

# Default reachability expectations (source -> targets).
DEFAULT_MESH: dict[str, list[str]] = {
    "1337book": ["haswell", "thinker"],
    "haswell": ["1337book", "thinker"],
    "thinker": ["1337book", "haswell"],
}

SSH_OPTS = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
]


def parse_declared_keys(base_nix: Path | None = None) -> set[str]:
    """Return the public keys declared in the shared base module."""
    base_nix = base_nix or (ROOT / "modules" / "base.nix")
    text = base_nix.read_text()
    match = re.search(r"openssh\.authorizedKeys\.keys\s*=\s*\[(.*?)\];", text, re.S)
    if not match:
        raise ValueError(f"no openssh.authorizedKeys.keys block found in {base_nix}")
    return set(re.findall(r'"(ssh-[^"]+)"', match.group(1)))


def host_imports_base(host: str) -> bool:
    config = ROOT / "hosts" / host / "configuration.nix"
    return config.exists() and "../../modules/base.nix" in config.read_text()


def static_checks(mesh: dict[str, list[str]]) -> list[tuple[bool, str]]:
    """Offline checks that the flake source keeps the mesh reachable."""
    results: list[tuple[bool, str]] = []
    declared = parse_declared_keys()

    for host, key in HOST_CLIENT_KEYS.items():
        results.append((key in declared, f"base.nix authorizes {host} client key"))

    for host in HOSTS:
        results.append(
            (host_imports_base(host), f"hosts/{host}/configuration.nix imports modules/base.nix")
        )

    for source, targets in mesh.items():
        key = HOST_CLIENT_KEYS.get(source)
        if key is None:
            results.append((False, f"no known client key for source host {source!r}"))
            continue
        for target in targets:
            ok = key in declared and host_imports_base(target)
            results.append((ok, f"{source} -> {target} authorized via shared base module"))

    return results


def _build_inner_script(source: str, targets: list[str], timeout: int) -> str:
    lines = ["set +e"]
    for target in targets:
        remote = f"{SSH_USER}@{target}"
        opts = " ".join(SSH_OPTS + ["-o", f"ConnectTimeout={timeout}"])
        lines.append(
            f"if out=$(ssh {opts} {shlex.quote(remote)} hostname 2>&1); then "
            f"echo {shlex.quote(f'OK {target}')} \"$out\"; "
            f"else echo {shlex.quote(f'FAIL {target}')} \"$out\"; fi"
        )
    return "\n".join(lines) + "\n"


def live_hop(source: str, targets: list[str], timeout: int = 12) -> list[tuple[bool, str]]:
    """SSH to *source*, then from there SSH to each target and read its hostname."""
    inner = _build_inner_script(source, targets, timeout)
    local = socket.gethostname().split(".")[0]

    if source == local:
        cmd = ["bash", "-s"]
    else:
        cmd = ["ssh", *SSH_OPTS, "-o", f"ConnectTimeout={timeout}", f"{SSH_USER}@{source}", "bash -s"]

    proc = subprocess.run(
        cmd,
        input=inner,
        text=True,
        capture_output=True,
        timeout=timeout * (len(targets) + 2),
    )

    if proc.returncode != 0 and not proc.stdout.strip():
        detail = proc.stderr.strip() or f"ssh to {source} failed (exit {proc.returncode})"
        return [(False, f"{source} -> (ssh transport) {detail}")]

    results: list[tuple[bool, str]] = []
    for line in proc.stdout.splitlines():
        parts = line.split(" ", 2)
        if not parts or parts[0] not in {"OK", "FAIL"}:
            continue
        status, target = parts[0], parts[1]
        detail = parts[2] if len(parts) > 2 else ""
        results.append(
            (status == "OK", f"{source} -> {target}: {detail or 'no output'}")
        )

    if not results:
        results.append((False, f"{source} -> (no results) {proc.stdout.strip() or proc.stderr.strip()}"))
    return results


def _print_results(results: list[tuple[bool, str]]) -> int:
    failures = 0
    for ok, message in results:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {message}")
        if not ok:
            failures += 1
    return failures


def _parse_selection(values: list[str] | None, default: list[str]) -> list[str]:
    return values if values else list(default)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="also perform live SSH hops")
    parser.add_argument("--from", dest="sources", nargs="+", help="source hosts to test (default: all)")
    parser.add_argument("--to", dest="targets", nargs="+", help="target hosts to test (default: per mesh)")
    parser.add_argument("--timeout", type=int, default=12, help="per-hop SSH timeout in seconds")
    args = parser.parse_args(argv)

    if args.sources or args.targets:
        sources = _parse_selection(args.sources, list(DEFAULT_MESH))
        mesh = {
            source: _parse_selection(args.targets, DEFAULT_MESH.get(source, []))
            for source in sources
        }
    else:
        mesh = {source: list(targets) for source, targets in DEFAULT_MESH.items()}

    print("Static checks (flake source):")
    static_failures = _print_results(static_checks(mesh))

    live_failures = 0
    if args.live:
        print("\nLive checks (SSH hops):")
        for source, targets in mesh.items():
            live_failures += _print_results(live_hop(source, targets, timeout=args.timeout))

    total = static_failures + live_failures
    print()
    if total:
        print(f"SSH mesh verification FAILED ({total} issue(s)).")
        return 1
    scope = "static + live" if args.live else "static"
    print(f"SSH mesh verification passed ({scope}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
