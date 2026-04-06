from __future__ import annotations

from prediction_market_agent.config import TCIConfig
from prediction_market_agent.models import EvaluatedInput
from prediction_market_agent.policy import evaluate_policy


def test_policy_scales_capability_down_under_suspicious_opposition():
    config = TCIConfig()
    inputs = [
        EvaluatedInput("c1", "u1", "trusted", "support", 0.65, 0.8, 0.4, 0.1, 0.6, True),
        EvaluatedInput("c2", "u2", "attacker", "attack", 0.10, 0.1, 0.95, 0.85, 0.02, False),
    ]

    policy = evaluate_policy(
        market_probability=0.5,
        target_probability=0.62,
        confidence=0.5,
        uncertainty=0.4,
        evaluated_inputs=inputs,
        config=config,
        available_capital=100.0,
        current_exposure=0.0,
    )

    assert policy.allowed_bet_size < config.risk.max_bet_size
    assert policy.adversarial_pressure > 0.3
    assert "high-intelligence low-trust input detected" in policy.reasons
