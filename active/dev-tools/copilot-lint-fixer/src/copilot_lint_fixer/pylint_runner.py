"""Pylint runner and issue parsing."""
from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class PylintIssue:
    path: str
    line: int
    column: int
    message: str
    message_id: str
    symbol: str
    issue_type: str
    obj: str

    def to_payload(self) -> dict:
        return {
            "path": self.path,
            "line": self.line,
            "column": self.column,
            "message": self.message,
            "message_id": self.message_id,
            "symbol": self.symbol,
            "type": self.issue_type,
            "object": self.obj,
        }


def run_pylint(file_path: Path, extra_args: Optional[Iterable[str]] = None) -> List[PylintIssue]:
    command = _build_pylint_command(file_path, extra_args)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )

    raw = _decode_pylint_output(result.stdout, file_path)
    if raw is None:
        if result.returncode not in (0,):
            logger.debug("pylint returned %s with no output", result.returncode)
        return []

    issues: List[PylintIssue] = []
    for entry in raw:
        issue = _to_issue(entry, file_path)
        if issue is not None:
            issues.append(issue)
    return issues


def _build_pylint_command(file_path: Path, extra_args: Optional[Iterable[str]]) -> list[str]:
    command = [
        "pylint",
        "--output-format=json",
        "--reports=n",
        "--score=n",
        str(file_path),
    ]
    if extra_args:
        command.extend(extra_args)
    return command


def _decode_pylint_output(stdout: str, file_path: Path) -> Optional[list[dict]]:
    content = (stdout or "").strip()
    if not content:
        return None
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        logger.warning("Failed to decode pylint JSON output for %s", file_path)
        return []
    return parsed if isinstance(parsed, list) else []


def _to_issue(entry: dict, file_path: Path) -> Optional[PylintIssue]:
    try:
        return PylintIssue(
            path=entry.get("path", str(file_path)),
            line=int(entry.get("line") or 0),
            column=int(entry.get("column") or 0),
            message=str(entry.get("message") or ""),
            message_id=str(entry.get("message-id") or ""),
            symbol=str(entry.get("symbol") or ""),
            issue_type=str(entry.get("type") or ""),
            obj=str(entry.get("obj") or ""),
        )
    except Exception:
        return None
