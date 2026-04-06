from __future__ import annotations

import math

from .config import TCIConfig
from .models import ActorProfile, clamp


def score_actor(profile: ActorProfile, now_ms: int, config: TCIConfig) -> float:
    age_days = profile.account_age_days(now_ms)
    age_score = min(1.0, math.log1p(age_days) / math.log1p(365.0))
    activity_basis = max(profile.total_deposits, profile.balance, 0.0)
    activity_score = min(1.0, math.log1p(activity_basis) / math.log1p(10_000.0))
    historical_accuracy = profile.historical_accuracy if profile.historical_accuracy is not None else 0.5
    consistency = clamp(profile.consistency)
    trust_score = (
        0.15
        + 0.30 * historical_accuracy
        + 0.20 * consistency
        + 0.20 * age_score
        + 0.15 * activity_score
        + (0.10 if profile.is_trustworthy else 0.0)
        - (0.12 if profile.is_bot else 0.0)
    )
    return clamp(trust_score, 0.01, 0.99)


def update_trust_score(
    previous_trust: float,
    realized_accuracy: float,
    elapsed_days: float,
    config: TCIConfig,
    betrayal_factor: float = 0.0,
) -> float:
    decayed = clamp(previous_trust * max(0.0, 1.0 - config.trust_decay_per_day * elapsed_days))
    gain = config.trust_gain_rate * max(0.0, realized_accuracy - decayed)
    loss = (config.trust_gain_rate * 2.5) * max(0.0, decayed - realized_accuracy)
    betrayal_penalty = config.betrayal_penalty * clamp(betrayal_factor)
    return clamp(decayed + gain - loss - betrayal_penalty, 0.01, 0.99)
