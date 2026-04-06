from __future__ import annotations

from dataclasses import dataclass, field


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
