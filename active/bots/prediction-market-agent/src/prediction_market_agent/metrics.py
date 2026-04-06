from __future__ import annotations

from .models import ActionType, EvaluatedInput, MarketSnapshot


def compute_run_metrics(
    *,
    market: MarketSnapshot,
    target_probability: float,
    action: ActionType,
    bet_amount: float,
    confidence: float,
    adversarial_pressure: float,
    counterfactual_probability: float,
    max_bet_size: float,
    evaluated_inputs: list[EvaluatedInput],
) -> dict[str, float | None]:
    belief_shift = target_probability - market.probability
    exploitability = adversarial_pressure * (bet_amount / max(max_bet_size, 1.0))
    suspicious_count = sum(1 for item in evaluated_inputs if item.trust_score < 0.35 and item.intelligence_score > 0.72)
    metrics: dict[str, float | None] = {
        "market_probability": round(market.probability, 6),
        "target_probability": round(target_probability, 6),
        "belief_shift": round(belief_shift, 6),
        "confidence": round(confidence, 6),
        "expected_edge": round(abs(belief_shift) * bet_amount, 6),
        "exploitability": round(exploitability, 6),
        "counterfactual_shift": round(target_probability - counterfactual_probability, 6),
        "suspicious_input_count": float(suspicious_count),
    }
    if market.resolution_probability is not None:
        outcome = market.resolution_probability
        direction = 1.0 if action == ActionType.BUY_YES else -1.0 if action == ActionType.BUY_NO else 0.0
        brier_score = (target_probability - outcome) ** 2
        market_brier_score = (market.probability - outcome) ** 2
        realized_pnl_proxy = bet_amount * direction * (outcome - market.probability)
        metrics.update(
            {
                "brier_score": round(brier_score, 6),
                "market_brier_score": round(market_brier_score, 6),
                "regret": round(max(0.0, brier_score - market_brier_score), 6),
                "realized_pnl_proxy": round(realized_pnl_proxy, 6),
            }
        )
    else:
        metrics.update(
            {
                "brier_score": None,
                "market_brier_score": None,
                "regret": None,
                "realized_pnl_proxy": None,
            }
        )
    return metrics
