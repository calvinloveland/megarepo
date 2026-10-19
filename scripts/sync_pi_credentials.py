#!/usr/bin/env python3
"""Propagate a pi API key to remote hosts that run the pi coding agent.

The key is read from a local file (never from argv, so it stays out of shell
history and process listings), merged into each host's `~/.pi/agent/auth.json`
without disturbing other providers, and verified by re-reading the file.

Remote hosts are reached over ssh. Their login shell may be `fish`, so every
remote command is run as `bash -s` with the script on stdin and the payload
uploaded separately; a key is never interpolated into a remote command line.

Usage:
    python scripts/sync_pi_credentials.py --key-file opencodekey.txt \
        --hosts haswell,thinker [--dry-run]

Provider is inferred from the key prefix (see PROVIDERS). Only the named
provider's entry is written; other providers' credentials are preserved.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

AUTH_PATH = ".pi/agent/auth.json"

# Longest prefix first so `sk-or-v1-` is not mistaken for a bare `sk-` key.
PROVIDERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("opencode-go", re.compile(r"^oc_sk_[A-Za-z0-9_-]{20,}$")),
    ("openrouter", re.compile(r"^sk-or-v1-[A-Za-z0-9]{20,}$")),
)

REMOTE_APPLY = r"""
set -eu
cd "$HOME/.pi/agent"
payload=/tmp/pi-auth-payload.json
backup="auth.json.bak.$(date +%Y%m%d-%H%M%S)"

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$payload"

cp -p auth.json "$backup"
cat "$payload" > auth.json.tmp
chmod --reference=auth.json auth.json.tmp
chown --reference=auth.json auth.json.tmp
if command -v getfacl >/dev/null 2>&1; then
  getfacl -p auth.json 2>/dev/null | setfacl --set-file=- auth.json.tmp 2>/dev/null || true
fi
mv auth.json.tmp auth.json
echo "backup=$backup"
"""


@dataclass
class Result:
    host: str
    status: str  # applied | unchanged | failed
    detail: str = ""


def fingerprint(secret: str) -> str:
    """Short, non-reversible fingerprint so logs never contain the key."""
    return hashlib.sha256(secret.encode()).hexdigest()[:12]


def detect_provider(key: str) -> str:
    for name, pattern in PROVIDERS:
        if pattern.match(key):
            return name
    raise ValueError(
        "unrecognised key format; expected one of: "
        + ", ".join(name for name, _ in PROVIDERS)
    )


def read_key(path: Path) -> str:
    key = path.read_text(encoding="utf-8").strip()
    if not key or any(ch.isspace() for ch in key):
        raise ValueError(f"{path} must contain exactly one key on one line")
    return key


def merge_credential(
    remote_auth: dict, provider: str, key: str
) -> dict:
    """Set `provider` to an api_key credential, keeping every other provider."""
    existing = remote_auth.get(provider)
    entry = dict(existing) if isinstance(existing, dict) else {}
    entry.update({"type": "api_key", "key": key})
    merged = dict(remote_auth)
    merged[provider] = entry
    return merged


def ssh(host: str, command: str, stdin: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command],
        input=stdin,
        capture_output=True,
    )


def read_remote_auth(host: str) -> dict:
    proc = ssh(host, f"cat ~/{AUTH_PATH} 2>/dev/null || true")
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode().strip() or "ssh failed")
    raw = proc.stdout.decode().strip()
    if not raw:
        return {}
    return json.loads(raw)


def write_remote_auth(host: str, auth: dict) -> str:
    payload = (json.dumps(auth, indent=2) + "\n").encode()
    # Upload base64-encoded JSON with coreutils `base64 -d` (node exists on
    # every pi host, python3 does not), then apply it with a fixed script.
    # The secret never appears in a remote command line.
    upload = ssh(
        host,
        "base64 -d > /tmp/pi-auth-payload.json && chmod 600 /tmp/pi-auth-payload.json",
        stdin=base64.b64encode(payload),
    )
    if upload.returncode != 0:
        raise RuntimeError(upload.stderr.decode().strip() or "payload upload failed")
    proc = ssh(host, "bash -s", stdin=REMOTE_APPLY.encode())
    ssh(host, "rm -f /tmp/pi-auth-payload.json")
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode().strip() or "apply failed")
    return proc.stdout.decode().strip()


def sync_host(host: str, provider: str, key: str, dry_run: bool) -> Result:
    try:
        remote = read_remote_auth(host)
    except Exception as exc:  # noqa: BLE001 - reported per host
        return Result(host, "failed", f"read: {exc}")

    current = remote.get(provider)
    if isinstance(current, dict) and current.get("key") == key:
        return Result(host, "unchanged", f"{provider} already set")

    merged = merge_credential(remote, provider, key)
    detail = f"{provider} -> {fingerprint(key)}"
    if dry_run:
        return Result(host, "planned", detail)

    try:
        backup = write_remote_auth(host, merged)
        verify = read_remote_auth(host)
    except Exception as exc:  # noqa: BLE001 - reported per host
        return Result(host, "failed", f"write: {exc}")

    if verify.get(provider, {}).get("key") != key:
        return Result(host, "failed", "verification mismatch after write")
    return Result(host, "applied", f"{detail}; {backup}")


def self_test() -> int:
    key = "oc_sk_" + "a" * 44
    assert detect_provider(key) == "opencode-go"
    assert detect_provider("sk-or-v1-" + "b" * 32) == "openrouter"
    try:
        detect_provider("garbage")
    except ValueError:
        pass
    else:
        raise AssertionError("garbage key should be rejected")

    remote = {"github-copilot": {"type": "oauth", "access": "x"}}
    merged = merge_credential(remote, "opencode-go", key)
    assert merged["github-copilot"] == remote["github-copilot"], "copilot clobbered"
    assert merged["opencode-go"] == {"type": "api_key", "key": key}
    assert merge_credential(merged, "opencode-go", key) == merged, "not idempotent"
    assert fingerprint(key) != key
    print("self-test: ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--key-file", type=Path, help="file containing the key")
    parser.add_argument("--provider", help="provider id (default: infer from key)")
    parser.add_argument("--hosts", default="haswell,thinker", help="comma-separated ssh hosts")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.key_file:
        parser.error("--key-file is required (use --self-test to run checks)")

    key = read_key(args.key_file)
    provider = args.provider or detect_provider(key)
    hosts = [h.strip() for h in args.hosts.split(",") if h.strip()]

    results = [sync_host(host, provider, key, args.dry_run) for host in hosts]
    for result in results:
        print(f"{result.host:<12} {result.status:<10} {result.detail}")
    return 0 if all(r.status != "failed" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
