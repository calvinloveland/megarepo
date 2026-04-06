from __future__ import annotations

from typing import Any

from tci_framework.config import TCIConfig
from tci_framework.models import ActionType, Decision, ExecutionMode


def execute_decision(adapter: Any, decision: Decision, config: TCIConfig) -> dict[str, Any]:
    if decision.action == ActionType.HOLD or decision.bet_amount <= 0:
        return {"status": "hold", "mode": decision.mode.value, "betAmount": 0.0}
    if decision.bet_amount > config.risk.max_bet_size + 1e-9:
        raise ValueError("Decision exceeds configured max bet size")
    if decision.mode == ExecutionMode.SHADOW:
        return {
            "status": "shadow",
            "mode": decision.mode.value,
            "marketId": decision.market_id,
            "action": decision.action.value,
            "betAmount": decision.bet_amount,
            "targetProbability": decision.target_probability,
        }
    outcome = "YES" if decision.action == ActionType.BUY_YES else "NO"
    response = adapter.place_order(
        decision.market_id,
        amount=decision.bet_amount,
        outcome=outcome,
        limit_prob=decision.target_probability,
    )
    return {
        "status": "live",
        "mode": decision.mode.value,
        "marketId": decision.market_id,
        "action": decision.action.value,
        "betAmount": decision.bet_amount,
        "targetProbability": decision.target_probability,
        "response": response,
    }
