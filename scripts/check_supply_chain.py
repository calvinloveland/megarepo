#!/usr/bin/env python3
"""Lightweight repository guardrails for common supply-chain regressions."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, List

REPO_ROOT = Path(__file__).resolve().parent.parent
PINNED_ACTION_REF = re.compile(r"uses:\s*[^@\s]+@(?!(?:[0-9a-f]{40})\b)([^\s#]+)")
DIRECT_GIT_DEP = re.compile(r"git\+https://[^\s\"]+\.git(?!@[0-9a-f]{7,40})")
RUNTIME_FETCH_MARKERS = (
    "archive/refs/heads/main.tar.gz",
    "pip install --no-cache-dir",
    "npm install",
    "apt-get install",
)
DEPLOYABLE_WEB_APPS = (
    Path("active/web-apps/parambulator"),
    Path("active/web-apps/momos"),
    Path("active/web-apps/sub-day-generator"),
)
IGNORED_PARTS = {"node_modules", ".venv", ".next", ".vscode-test"}


def repo_paths(pattern: str) -> Iterable[Path]:
    for path in sorted(REPO_ROOT.glob(pattern)):
        if any(part in IGNORED_PARTS for part in path.parts):
            continue
        yield path


def git_ls_files(pattern: str) -> List[str]:
    completed = subprocess.run(
        ["git", "ls-files", pattern],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in completed.stdout.splitlines() if line]


def check_actions(violations: list[str]) -> None:
    for workflow in list(repo_paths(".github/workflows/*.yml")) + list(
        repo_paths("active/**/.github/workflows/*.yml")
    ):
        text = workflow.read_text(encoding="utf-8")
        for match in PINNED_ACTION_REF.finditer(text):
            ref = match.group(1)
            if ref in {"main", "master"} or re.fullmatch(r"v\d+(?:\.\d+)*", ref):
                violations.append(f"{workflow.relative_to(REPO_ROOT)}: unpinned action ref {ref}")


def check_tracked_vendor_dirs(violations: list[str]) -> None:
    for pattern in ("*/node_modules/*", "*/.venv/*", "*/.next/*", "*/.vscode-test/*"):
        matches = git_ls_files(pattern)
        if matches:
            preview = ", ".join(matches[:3])
            suffix = "..." if len(matches) > 3 else ""
            violations.append(f"tracked vendored files for {pattern}: {preview}{suffix}")


def check_web_app_k8s_runtime_fetches(violations: list[str]) -> None:
    for manifest in repo_paths("active/web-apps/*/k8s/*.y*ml"):
        text = manifest.read_text(encoding="utf-8")
        for marker in RUNTIME_FETCH_MARKERS:
            if marker in text:
                violations.append(
                    f"{manifest.relative_to(REPO_ROOT)}: runtime install/fetch marker {marker!r}"
                )


def check_python_lockfiles(violations: list[str]) -> None:
    for app_dir in DEPLOYABLE_WEB_APPS:
        if not (REPO_ROOT / app_dir / "requirements.lock").exists():
            violations.append(f"{app_dir}/requirements.lock is missing")


def check_direct_git_dependencies(violations: list[str]) -> None:
    for pyproject in repo_paths("active/**/pyproject.toml"):
        text = pyproject.read_text(encoding="utf-8")
        for match in DIRECT_GIT_DEP.finditer(text):
            violations.append(
                f"{pyproject.relative_to(REPO_ROOT)}: git dependency must pin a commit SHA ({match.group(0)})"
            )


def main() -> int:
    violations: list[str] = []
    check_actions(violations)
    check_tracked_vendor_dirs(violations)
    check_web_app_k8s_runtime_fetches(violations)
    check_python_lockfiles(violations)
    check_direct_git_dependencies(violations)

    if violations:
        print("Supply-chain guard failed:\n")
        for violation in violations:
            print(f"- {violation}")
        return 1

    print("Supply-chain guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
