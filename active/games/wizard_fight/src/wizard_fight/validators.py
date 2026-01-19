from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from jsonschema import Draft7Validator

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCHEMA_PATH = _REPO_ROOT / "docs" / "dsl_v1.json"


def load_schema() -> dict[str, Any]:
    with _SCHEMA_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_spell(spell: dict[str, Any]) -> list[str]:
    schema = load_schema()
    validator = Draft7Validator(schema)
    errors: Iterable[str] = (
        f"{'.'.join(str(part) for part in error.path)}: {error.message}"
        for error in sorted(validator.iter_errors(spell), key=lambda err: err.path)
    )
    return [message for message in errors]
