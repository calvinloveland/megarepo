from __future__ import annotations

import os
import signal
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))


def _stop_pid(pid: int) -> None:
    try:
        os.kill(pid, 0)
    except OSError:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return


def pytest_sessionstart(session) -> None:  # type: ignore[unused-argument]
    pid_file = REPO_ROOT / ".wizard_fight_dev.pids"
    if not pid_file.exists():
        return
    try:
        contents = pid_file.read_text(encoding="utf-8").strip().split()
    except OSError:
        return
    for value in contents:
        if not value.isdigit():
            continue
        _stop_pid(int(value))
    try:
        pid_file.unlink()
    except OSError:
        pass
