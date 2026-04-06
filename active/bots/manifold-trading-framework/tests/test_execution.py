from __future__ import annotations

from manifold_trading_framework.execution import execute_decision
from tci_framework.config import TCIConfig
from tci_framework.models import ActionType, AgentVariant, Decision, EvaluatedInput, ExecutionMode, PolicySnapshot


class FakeAdapter:
    def __init__(self) -> None:
        self.calls = []

    def place_order(self, market_id, *, amount, outcome, limit_prob=None):
        self.calls.append((market_id, amount, outcome, limit_prob))
        return {"betId": "bet-1"}


def make_decision(mode: ExecutionMode) -> Decision:
    return Decision(
        variant=AgentVariant.V4,
        action=ActionType.BUY_YES,
        market_id="m1",
        market_question="Question?",
        market_probability=0.5,
        target_probability=0.62,
        confidence=0.4,
        bet_amount=10.0,
        mode=mode,
        rationale=[],
        evaluated_inputs=[EvaluatedInput("c1", "u1", "name", "text", 0.7, 0.8, 0.4, 0.1, 0.4, True)],
        policy=PolicySnapshot(10.0, 0.4, 0.2, True, []),
    )


def test_shadow_mode_does_not_place_order():
    adapter = FakeAdapter()
    result = execute_decision(adapter, make_decision(ExecutionMode.SHADOW), TCIConfig())

    assert result["status"] == "shadow"
    assert adapter.calls == []


def test_live_mode_places_order():
    adapter = FakeAdapter()
    result = execute_decision(adapter, make_decision(ExecutionMode.LIVE), TCIConfig())

    assert result["status"] == "live"
    assert adapter.calls == [("m1", 10.0, "YES", 0.62)]
