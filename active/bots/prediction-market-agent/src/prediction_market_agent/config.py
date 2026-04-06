from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import os


@dataclass(frozen=True)
class RiskConfig:
    max_bet_size: float = 25.0
    max_exposure_per_market: float = 75.0
    max_total_risk: float = 150.0
    min_edge_to_trade: float = 0.03
    min_confidence_to_trade: float = 0.08


@dataclass(frozen=True)
class TCIConfig:
    market_anchor_weight: float = 4.0
    low_trust_threshold: float = 0.35
    suspicious_intelligence_threshold: float = 0.72
    low_trust_influence_cap: float = 0.25
    trust_gain_rate: float = 0.10
    trust_decay_per_day: float = 0.02
    betrayal_penalty: float = 0.30
    intelligence_penalty_weight: float = 0.55
    uncertainty_penalty_weight: float = 0.40
    opposing_pressure_weight: float = 0.75
    max_comment_length: int = 2000
    risk: RiskConfig = field(default_factory=RiskConfig)


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
        run_dir = Path(os.environ.get("PREDICTION_MARKET_AGENT_RUN_DIR", "data/runs"))
        return cls(api_key=api_key, default_run_dir=run_dir)
