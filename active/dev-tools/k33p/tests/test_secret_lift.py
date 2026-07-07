"""Tests for the repo-level secret-lift helper (scripts/k33p_secret_lift.py).

These guard the orchestration that the pre-commit hook depends on: parsing a
gitleaks findings report, age-encrypting the secret, storing the ciphertext in
the k33p CAS, rewriting the source in place with a reference token, and
appending to the secrets manifest. The age binary is mocked so the tests don't
require network/nix access.

Run with:
  nix-shell -p 'python3.withPackages(ps: [ps.pyyaml ps.textual ps.pytest ps.pytest-asyncio])' \\
    --run "PYTHONPATH=src:../../../../scripts python -m pytest tests/test_secret_lift.py -q"
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# The lift script lives at repo root scripts/, four levels up from this file.
REPO_ROOT = Path(__file__).resolve().parents[4]
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import k33p_secret_lift as lift  # type: ignore  # noqa: E402
from k33p.store import ContentStore  # noqa: E402


def _make_report(tmp_path: Path, findings: list[dict]) -> Path:
    p = tmp_path / "report.json"
    p.write_text(json.dumps(findings))
    return p


def _single_line_finding(file: str, secret: str, line: int = 1, col: int = 1) -> dict:
    return {
        "RuleID": "github-pat",
        "StartLine": line,
        "EndLine": line,
        "StartColumn": col,
        "EndColumn": col + len(secret) - 1,
        "Secret": secret,
        "Match": secret,
        "File": file,
    }


def test_rewrite_replaces_exact_secret_span(tmp_path: Path) -> None:
    """Regression: EndColumn is inclusive; the last secret char must not leak.

    Earlier the slice kept the final character of the secret in the file
    (e.g. ``...e17f0eT`` instead of ``...e17f0e``).
    """
    f = tmp_path / "cfg.py"
    secret = "ghp_9b8X7c6D5e4F3g2H1i0J9k8L7m6N5o4PqRsT"
    original = f'GITHUB_TOKEN="{secret}"\n'
    f.write_text(original)

    finding = _single_line_finding("cfg.py", secret, col=15)
    ref = "k33p+secret://sha256:abc"
    ok = lift._rewrite_secret_in_file(
        f, finding["StartLine"], finding["StartColumn"], finding["EndColumn"], ref
    )

    assert ok
    rewritten = f.read_text()
    assert secret not in rewritten
    assert ref in rewritten
    # The closing quote must immediately follow the reference — no stray chars.
    assert f'{ref}"' in rewritten
    assert rewritten == f'GITHUB_TOKEN="{ref}"\n'


def test_rewrite_multi_byte_safe(tmp_path: Path) -> None:
    """Rewrite must operate on the whole line, preserving surrounding text."""
    f = tmp_path / "cfg.py"
    secret = "ghp_" + "a" * 36
    original = f'  LEAD = "x{secret}y"  # trailing comment\n'
    f.write_text(original)
    finding = _single_line_finding("cfg.py", secret, col=12)
    lift._rewrite_secret_in_file(f, finding["StartLine"], finding["StartColumn"], finding["EndColumn"], "REF")
    rewritten = f.read_text()
    assert secret not in rewritten
    assert rewritten.startswith('  LEAD = "x')
    assert rewritten.rstrip().endswith('# trailing comment')


def test_lift_full_flow_with_mocked_age(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """End-to-end lift with age mocked: encrypt -> CAS -> rewrite -> manifest."""
    repo = tmp_path
    (repo / ".k33p" / "store").mkdir(parents=True)
    # recipient file
    (repo / ".k33p" / "age-recipient.txt").write_text(
        "# comment\nage1fakerecipient\n"
    )
    # a source file with a secret
    secret = "ghp_9b8X7c6D5e4F3g2H1i0J9k8L7m6N5o4PqRsT"
    src = repo / "config.py"
    src.write_text(f'GITHUB_TOKEN="{secret}"\n')
    finding = _single_line_finding("config.py", secret, col=15)
    report = _make_report(tmp_path, [finding])

    # Mock age encryption to return deterministic ciphertext.
    encrypted_ciphertext = b"FAKE-CIPHERTEXT"
    calls: list[bytes] = []

    def fake_run_age(verb: str, args: list[str], stdin: bytes | None = None) -> bytes:
        assert verb == "--encrypt"
        assert "-r" in args and "age1fakerecipient" in args
        assert stdin is not None
        calls.append(stdin)
        return encrypted_ciphertext

    monkeypatch.setattr(lift, "_run_age", fake_run_age)
    # Avoid touching real git; capture restage calls.
    restaged: list[list[str]] = []
    monkeypatch.setattr(
        lift,
        "_git",
        lambda args, root: restaged.append(args) or type(
            "R", (), {"returncode": 0, "stdout": "", "stderr": ""}
        )(),
    )

    rc = lift.run_lift(report, repo)

    assert rc == 0
    # secret was passed to age
    assert calls == [secret.encode()]

    # ciphertext stored in CAS under kind=secret
    store = ContentStore(repo / ".k33p" / "store")
    blob_hash = store.put(encrypted_ciphertext, kind="secret")
    assert store.has(blob_hash)
    assert store.get_kind(blob_hash) == "secret"

    # source rewritten with the ref token
    rewritten = src.read_text()
    assert secret not in rewritten
    assert f"k33p+secret://sha256:{blob_hash}" in rewritten

    # manifest appended
    manifest = json.loads((repo / ".k33p" / "secrets-manifest.json").read_text())
    assert len(manifest) == 1
    assert manifest[0]["blob_hash"] == blob_hash
    assert manifest[0]["file"] == "config.py"
    assert manifest[0]["rule_id"] == "github-pat"
    assert manifest[0]["recipient"] == "age1fakerecipient"

    # file was re-staged
    assert restaged == [["add", "--", "config.py"]]


def test_lift_skips_multiline_finding(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path
    (repo / ".k33p" / "store").mkdir(parents=True)
    (repo / ".k33p" / "age-recipient.txt").write_text("age1fakerecipient\n")
    src = repo / "multi.py"
    secret = "ghp_" + "a" * 36
    src.write_text(f'"""\n{secret}\n"""\n')
    finding = _single_line_finding("multi.py", secret, line=2, col=1)
    finding["EndLine"] = 2  # single line still — but test a real multi-line below
    # make it genuinely multi-line
    finding["EndLine"] = 3
    report = _make_report(tmp_path, [finding])

    monkeypatch.setattr(lift, "_git", lambda a, r: type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})())
    monkeypatch.setattr(lift, "_run_age", lambda v, a, stdin=None: b"ct")

    # multi-line -> skipped, no lift -> exit 2
    with pytest.raises(SystemExit) as exc:
        lift.run_lift(report, repo)
    assert exc.value.code == 2
    # source untouched
    assert secret in src.read_text()


def test_lift_blocks_without_recipient(tmp_path: Path) -> None:
    repo = tmp_path
    (repo / ".k33p" / "store").mkdir(parents=True)
    src = repo / "config.py"
    src.write_text('GITHUB_TOKEN="ghp_' + "a" * 36 + '"\n')
    report = _make_report(tmp_path, [_single_line_finding("config.py", "ghp_" + "a" * 36, col=15)])
    with pytest.raises(SystemExit) as exc:
        lift.run_lift(report, repo)
    assert exc.value.code == 3  # configuration error
