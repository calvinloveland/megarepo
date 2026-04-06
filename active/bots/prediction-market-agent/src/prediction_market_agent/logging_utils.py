from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .models import to_jsonable


def timestamp_slug(now_ms: int | None = None) -> str:
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    return str(now_ms)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(to_jsonable(payload), handle, indent=2, sort_keys=True)
        handle.write("\n")


def append_jsonl(path: Path, payload: Any) -> None:
    ensure_parent(path)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(to_jsonable(payload), sort_keys=True))
        handle.write("\n")
