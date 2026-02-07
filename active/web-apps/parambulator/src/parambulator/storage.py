from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List


def storage_dir(base_dir: Path) -> Path:
    path = base_dir / "data" / "saves"
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_saves(base_dir: Path) -> List[str]:
    path = storage_dir(base_dir)
    return sorted(file.stem for file in path.glob("*.json"))


def save_payload(base_dir: Path, name: str, payload: Dict[str, object]) -> Path:
    safe_name = _sanitize_name(name)
    if not safe_name:
        raise ValueError("Save name cannot be empty.")
    payload = dict(payload)
    payload["saved_at"] = datetime.now(timezone.utc).isoformat()
    path = storage_dir(base_dir) / f"{safe_name}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def load_payload(base_dir: Path, name: str) -> Dict[str, object]:
    safe_name = _sanitize_name(name)
    path = storage_dir(base_dir) / f"{safe_name}.json"
    try:
        path.resolve().relative_to(storage_dir(base_dir).resolve())
    except ValueError as exc:
        raise ValueError("Invalid save path") from exc
    if not path.exists():
        raise FileNotFoundError(f"Save '{safe_name}' not found.")
    return json.loads(path.read_text(encoding="utf-8"))


def _sanitize_name(name: str) -> str:
    if not name or not isinstance(name, str):
        raise ValueError("Invalid save name")
    cleaned = re.sub(r"[^a-zA-Z0-9\-_]", "", name).strip()
    if not cleaned:
        raise ValueError("Save name must contain at least one valid character")
    return cleaned[:60]
