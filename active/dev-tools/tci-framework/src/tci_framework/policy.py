from __future__ import annotations

from .config import TCIConfig
from .models import EvaluatedInput, PolicySnapshot, clamp


def evaluate_policy(
    *,
    market_probability: float,
    target_probability: float,
    confidence: float,
    uncertainty: float,
    evaluated_inputs: list[EvaluatedInput],
    config: TCIConfig,
    available_capital: float,
    current_exposure: float,
) -> PolicySnapshot:
    direction = 1 if target_probability > market_probability else -1 if target_probability < market_probability else 0
    suspicious_inputs = [
        item for item in evaluated_inputs if item.trust_score < config.low_trust_threshold and item.intelligence_score >= config.suspicious_intelligence_threshold
    ]
    opposing_suspicion = [
        item for item in suspicious_inputs
        if item.signal_probability is not None and ((item.signal_probability > market_probability) - (item.signal_probability < market_probability)) == -direction
    ]
    support_inputs = [
        item for item in evaluated_inputs
        if item.signal_probability is not None and ((item.signal_probability > market_probability) - (item.signal_probability < market_probability)) == direction
    ]
    support_intelligence = sum(item.intelligence_score * item.trust_score for item in support_inputs)
    opposing_pressure = sum(item.intelligence_score * (1.0 - item.trust_score) for item in opposing_suspicion)
    asymmetry_penalty = 0.0
    if opposing_pressure > 0 and support_intelligence < opposing_pressure:
        asymmetry_penalty = clamp(opposing_pressure - support_intelligence)
    adversarial_pressure = clamp(
        config.opposing_pressure_weight * opposing_pressure
        + config.uncertainty_penalty_weight * uncertainty
        + 0.35 * asymmetry_penalty
    )

    reasons: list[str] = []
    if suspicious_inputs:
        reasons.append("high-intelligence low-trust input detected")
    if asymmetry_penalty > 0:
        reasons.append("untrusted intelligence exceeds trusted support")
    if uncertainty > 0.60:
        reasons.append("market uncertainty is elevated")

    exposure_room = max(0.0, config.risk.max_exposure_per_market - current_exposure)
    total_risk_room = max(0.0, config.risk.max_total_risk - current_exposure)
    budget = min(config.risk.max_bet_size, exposure_room, total_risk_room, available_capital)
    capability_scale = clamp((1.0 - adversarial_pressure) * max(confidence, 0.05))
    allowed_bet_size = round(budget * capability_scale, 4)
    should_trade = (
        direction != 0
        and abs(target_probability - market_probability) >= config.risk.min_edge_to_trade
        and confidence >= config.risk.min_confidence_to_trade
        and allowed_bet_size > 0
    )
    if not should_trade:
        reasons.append("capability policy blocked or minimized trade")
    return PolicySnapshot(
        allowed_bet_size=allowed_bet_size,
        capability_scale=round(capability_scale, 6),
        adversarial_pressure=round(adversarial_pressure, 6),
        should_trade=should_trade,
        reasons=reasons,
    )
