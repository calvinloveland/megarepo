from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os

@dataclass(frozen=True)
class RuntimeConfig:
    api_base_url: str = "https://api.manifold.markets"
    api_key: str | None = None
    timeout_seconds: float = 10.0
    default_capital: float = 100.0
    default_run_dir: Path = Path("data/runs")

    @classmethod
    def from_env(cls) -> "RuntimeConfig":
        api_key = os.environ.get("MANIFOLD_API_KEY")
        run_dir = Path(os.environ.get("MANIFOLD_TRADING_FRAMEWORK_RUN_DIR", "data/runs"))
        return cls(api_key=api_key, default_run_dir=run_dir)
