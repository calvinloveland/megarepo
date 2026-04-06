from __future__ import annotations

from pathlib import Path

from tci_framework.config import TCIConfig
from tci_framework.decision import run_agent_variant
from tci_framework.models import ActorProfile, AgentVariant, ExecutionMode, MarketBundle, MarketSnapshot, CommentSignal
from tci_framework.replay import load_bundle


def make_bundle() -> MarketBundle:
    market = MarketSnapshot(
        market_id="m1",
        question="Will the launch happen?",
        probability=0.55,
        volume=1000.0,
        total_liquidity=500.0,
        creator_id="creator",
        created_time_ms=1,
        resolution_probability=0.0,
    )
    comments = [
        CommentSignal("c1", "m1", "u1", "trusted", "YES because official docs show 80% readiness and published timelines.", 2, signal_probability=0.8),
        CommentSignal("c2", "m1", "u2", "attacker", "NO because insiders know this is doomed and I am certain 5% chance.", 3, signal_probability=0.05),
    ]
    actors = {
        "u1": ActorProfile("u1", "trusted", created_time_ms=1, total_deposits=4000, consistency=0.9, historical_accuracy=0.8, is_trustworthy=True),
        "u2": ActorProfile("u2", "attacker", created_time_ms=1, total_deposits=20, consistency=0.2, historical_accuracy=0.3),
    }
    return MarketBundle(market=market, comments=comments, actors=actors, captured_time_ms=2_000_000_000_000, source="test")


def test_v4_is_more_conservative_than_v1_under_adversarial_pressure():
    config = TCIConfig()
    bundle = make_bundle()

    naive = run_agent_variant(bundle, AgentVariant.V1, config, mode=ExecutionMode.SHADOW)
    tci = run_agent_variant(bundle, AgentVariant.V4, config, mode=ExecutionMode.SHADOW)

    assert naive.decision.bet_amount >= tci.decision.bet_amount
    assert tci.metrics["exploitability"] <= naive.metrics["exploitability"]


def test_uncorroborated_suspicious_input_is_zero_weight_in_v4():
    config = TCIConfig()
    scenario_path = Path(__file__).resolve().parent.parent / "data/scenarios/high-intel-low-trust.json"
    bundle = load_bundle(scenario_path)

    v3 = run_agent_variant(bundle, AgentVariant.V3, config, mode=ExecutionMode.SHADOW)
    v4 = run_agent_variant(bundle, AgentVariant.V4, config, mode=ExecutionMode.SHADOW)

    v3_attacker = next(item for item in v3.decision.evaluated_inputs if item.username == "attacker")
    v4_attacker = next(item for item in v4.decision.evaluated_inputs if item.username == "attacker")

    assert v3_attacker.effective_weight > 0.0
    assert v4_attacker.effective_weight == 0.0
    assert v4.decision.bet_amount <= v3.decision.bet_amount


def test_betrayal_scenario_shows_progressive_capability_reduction():
    config = TCIConfig()
    scenario_path = Path(__file__).resolve().parent.parent / "data/scenarios/reputation-betrayal.json"
    bundle = load_bundle(scenario_path)

    results = {
        variant: run_agent_variant(bundle, variant, config, mode=ExecutionMode.SHADOW)
        for variant in AgentVariant
    }

    assert results[AgentVariant.V1].decision.bet_amount >= results[AgentVariant.V2].decision.bet_amount
    assert results[AgentVariant.V2].decision.bet_amount >= results[AgentVariant.V3].decision.bet_amount
    assert results[AgentVariant.V3].decision.bet_amount >= results[AgentVariant.V4].decision.bet_amount
    assert results[AgentVariant.V4].metrics["exploitability"] <= results[AgentVariant.V1].metrics["exploitability"]
