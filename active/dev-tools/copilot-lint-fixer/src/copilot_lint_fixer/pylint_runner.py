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
    command = [
        "pylint",
        "--output-format=json",
        "--reports=n",
        "--score=n",
        str(file_path),
    ]
    if extra_args:
        command.extend(extra_args)

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )

    stdout = (result.stdout or "").strip()
    if not stdout:
        if result.returncode not in (0,):
            logger.debug("pylint returned %s with no output", result.returncode)
        return []

    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError:
        logger.warning("Failed to decode pylint JSON output for %s", file_path)
        return []

    issues: List[PylintIssue] = []
    for entry in raw:
        try:
            issues.append(
                PylintIssue(
                    path=entry.get("path", str(file_path)),
                    line=int(entry.get("line") or 0),
                    column=int(entry.get("column") or 0),
                    message=str(entry.get("message") or ""),
                    message_id=str(entry.get("message-id") or ""),
                    symbol=str(entry.get("symbol") or ""),
                    issue_type=str(entry.get("type") or ""),
                    obj=str(entry.get("obj") or ""),
                )
            )
        except Exception:
            continue

    return issues
