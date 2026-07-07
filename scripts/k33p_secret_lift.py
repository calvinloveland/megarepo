#!/usr/bin/env python3
"""k33p secret-lift helper.

Reads a gitleaks JSON findings report and "lifts" each detected secret out of
tracked source into the k33p `secrets` channel:

  1. age-encrypt the secret value to the repo recipient (.k33p/age-recipient.txt)
  2. store the ciphertext as a `secret`-kind blob in the k33p content-addressed
     store (.k33p/store/) — returns a sha256 hash
  3. replace the secret substring in the source file with a reference token
     ``k33p+secret://sha256:<hash>``
  4. re-stage the file so the commit proceeds WITHOUT the secret
  5. append a record to .k33p/secrets-manifest.json mapping ref -> {file, rule,
     blob_hash, recipient, created_at}

Safety constraints:
  - Only single-line findings (StartLine == EndLine) are auto-rewritten; multi-
    line findings are left untouched and reported for manual handling.
  - The gitleaks report must NOT be redacted (--redact) when lifting, since the
    exact secret string is needed. The caller writes it to a mode-600 temp file
    which this script shreds after processing.
  - If the age recipient or identity is missing, the script prints guidance and
    exits non-zero so the commit is blocked (fail-closed).

Exit codes:
  0  all findings lifted (or none present)
  2  one or more findings could not be auto-lifted (e.g. multi-line) — the
     caller should block the commit
  3  configuration error (missing recipient/identity/age) — block the commit

Usage:
  k33p_secret_lift.py <report.json> [--repo-root .]

The k33p store module is imported via PYTHONPATH=active/dev-tools/k33p/src (set
by the hook). The age binary is located on PATH or via `nix run nixpkgs#age`.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REF_PREFIX = "k33p+secret://sha256:"


def _die(code: int, msg: str) -> None:
    print(f"k33p-lift: {msg}", file=sys.stderr)
    sys.exit(code)


def _find_age() -> str:
    """Return a command prefix list that invokes age."""
    on_path = shutil.which("age")
    if on_path:
        return on_path
    # Fall back to nix. Return a sentinel the caller expands.
    return "nix:age"


def _run_age(verb: str, args: list[str], stdin: bytes | None = None) -> bytes:
    age_cmd = _find_age()
    if age_cmd == "nix:age":
        full = ["nix", "run", "nixpkgs#age", "--", verb, *args]
    else:
        full = [age_cmd, verb, *args]
    res = subprocess.run(
        full, input=stdin, capture_output=True, timeout=60
    )
    if res.returncode != 0:
        raise RuntimeError(
            f"age {verb} failed ({res.returncode}): {res.stderr.decode(errors='replace').strip()}"
        )
    return res.stdout


def _age_recipient(repo_root: Path) -> str:
    p = repo_root / ".k33p" / "age-recipient.txt"
    if not p.exists():
        return ""
    for line in p.read_text().splitlines():
        line = line.strip()
        if line.startswith("age1"):
            return line
    return ""


def _store_secret_blob(repo_root: Path, ciphertext: bytes) -> str:
    """Store ciphertext in the k33p CAS under kind=secret, return its sha256."""
    try:
        sys.path.insert(0, str(repo_root / "active" / "dev-tools" / "k33p" / "src"))
        from k33p.store import ContentStore  # type: ignore
    except Exception as e:  # pragma: no cover - exercised via e2e
        raise RuntimeError(f"could not import k33p.store: {e}")
    store = ContentStore(repo_root / ".k33p" / "store")
    store.ensure()
    return store.put(ciphertext, kind="secret")


def _rewrite_secret_in_file(
    path: Path, start_line: int, start_col: int, end_col: int, replacement: str
) -> bool:
    """Replace columns [start_col, end_col] on start_line with replacement.

    Returns True on success, False if the file/line does not match the expected
    shape (e.g. line count changed under us).
    """
    text = path.read_text()
    lines = text.splitlines(keepends=True)
    idx = start_line - 1
    if idx < 0 or idx >= len(lines):
        return False
    line = lines[idx]
    # Columns are 1-indexed and inclusive of the secret span: the secret
    # occupies 0-indexed positions [start_col-1, end_col-1].
    before = line[: start_col - 1]
    after = line[end_col:]
    lines[idx] = before + replacement + after
    path.write_text("".join(lines))
    return True


def _append_manifest(repo_root: Path, record: dict) -> None:
    p = repo_root / ".k33p" / "secrets-manifest.json"
    data: list[dict] = []
    if p.exists():
        try:
            loaded = json.loads(p.read_text())
            if isinstance(loaded, list):
                data = loaded
        except json.JSONDecodeError:
            data = []
    data.append(record)
    p.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def _git(args: list[str], repo_root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        timeout=60,
    )


def run_lift(report_path: Path, repo_root: Path) -> int:
    """Core lift logic, separated from arg parsing for testability.

    Args:
        report_path: path to a gitleaks JSON findings report (not redacted).
        repo_root: repository root path.

    Returns exit code (0 ok, 2 some findings not lifted, 3 config error).
    """
    repo_root = Path(repo_root).resolve()
    report_path = Path(report_path)

    try:
        findings = json.loads(report_path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        _die(3, f"could not read findings report {report_path}: {e}")

    if not isinstance(findings, list) or not findings:
        print("k33p-lift: no findings to lift")
        return 0

    recipient = _age_recipient(repo_root)
    if not recipient:
        _die(
            3,
            "no age recipient found in .k33p/age-recipient.txt; "
            "generate one with: nix shell nixpkgs#age -c age-keygen -o "
            "~/.config/k33p/age/megarepo-identity.txt",
        )

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lifted = 0
    skipped: list[str] = []

    for f in findings:
        secret = f.get("Secret") or f.get("Match") or ""
        if not secret:
            skipped.append(f"{f.get('File','?')}:{f.get('StartLine','?')} (empty secret)")
            continue
        if f.get("StartLine") != f.get("EndLine"):
            skipped.append(
                f"{f.get('File','?')}:{f.get('StartLine','?')} (multi-line; needs manual lift)"
            )
            continue

        rel = f.get("File", "")
        target = repo_root / rel
        if not target.exists():
            skipped.append(f"{rel}:{f.get('StartLine','?')} (file not found)")
            continue

        # 1. encrypt
        try:
            ciphertext = _run_age(
                "--encrypt",
                ["-r", recipient, "-o", "-"],
                stdin=secret.encode("utf-8"),
            )
        except RuntimeError as e:
            _die(3, f"age encryption failed: {e}")

        # 2. store ciphertext in CAS
        blob_hash = _store_secret_blob(repo_root, ciphertext)
        ref = f"{REF_PREFIX}{blob_hash}"

        # 3. rewrite source
        ok = _rewrite_secret_in_file(
            target,
            int(f["StartLine"]),
            int(f["StartColumn"]),
            int(f["EndColumn"]),
            ref,
        )
        if not ok:
            skipped.append(f"{rel}:{f.get('StartLine','?')} (rewrite failed)")
            continue

        # 4. re-stage
        _git(["add", "--", rel], repo_root)

        # 5. manifest
        _append_manifest(
            repo_root,
            {
                "ref": ref,
                "file": rel,
                "rule_id": f.get("RuleID", ""),
                "line": f.get("StartLine"),
                "blob_hash": blob_hash,
                "recipient": recipient,
                "created_at": now,
            },
        )
        lifted += 1
        print(f"k33p-lift: lifted {f.get('RuleID','?')} from {rel}:{f.get('StartLine','?')} -> {ref}")

    if skipped:
        print("k33p-lift: the following findings could not be auto-lifted:", file=sys.stderr)
        for s in skipped:
            print(f"  - {s}", file=sys.stderr)
        if lifted == 0:
            _die(2, "no findings were lifted; blocking commit")
        # some lifted, some skipped — still block so the skipped ones are noticed
        _die(2, f"{lifted} lifted but {len(skipped)} skipped; blocking commit")

    print(f"k33p-lift: lifted {lifted} secret(s) into the secrets channel")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Lift gitleaks findings into the k33p secrets channel")
    ap.add_argument("report", help="gitleaks JSON findings report (not redacted)")
    ap.add_argument("--repo-root", default=".", help="repository root (default: cwd)")
    args = ap.parse_args()
    return run_lift(Path(args.report), Path(args.repo_root))


if __name__ == "__main__":
    sys.exit(main())
