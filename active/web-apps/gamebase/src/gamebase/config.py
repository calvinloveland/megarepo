"""Runtime configuration for Gamebase.

Everything is overridable with environment variables so the platform can run
from the repo tree during development or from a mounted volume in production.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _path_env(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


@dataclass(frozen=True)
class Settings:
    """Resolved settings for a Gamebase process."""

    project_root: Path
    registry_dir: Path
    database_path: Path
    template_dir: Path
    static_dir: Path
    score_rate_limit_seconds: float = 3.0
    theme: str = "default"
    auto_rescan: bool = True
    state_max_bytes: int = 8 * 1024 * 1024
    comment_rate_limit_seconds: float = 15.0
    max_content_bytes: int = 16 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            project_root=PROJECT_ROOT,
            registry_dir=_path_env("GAMEBASE_REGISTRY_DIR", PROJECT_ROOT / "registry"),
            database_path=_path_env("GAMEBASE_DB_PATH", PROJECT_ROOT / "instance" / "gamebase.sqlite3"),
            template_dir=PROJECT_ROOT / "templates",
            static_dir=PROJECT_ROOT / "static",
            score_rate_limit_seconds=float(os.environ.get("GAMEBASE_SCORE_RATE_LIMIT", "3")),
            theme=os.environ.get("GAMEBASE_THEME", "default"),
            auto_rescan=os.environ.get("GAMEBASE_AUTO_RESCAN", "1").lower() not in ("0", "false", "no", "off"),
            state_max_bytes=int(os.environ.get("GAMEBASE_STATE_MAX_BYTES", str(8 * 1024 * 1024))),
            comment_rate_limit_seconds=float(os.environ.get("GAMEBASE_COMMENT_RATE_LIMIT", "15")),
            max_content_bytes=int(os.environ.get("GAMEBASE_MAX_CONTENT_BYTES", str(16 * 1024 * 1024))),
        )
