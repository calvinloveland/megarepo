from __future__ import annotations

from pathlib import Path

from prediction_market_agent.config import TCIConfig
from prediction_market_agent.models import ActorProfile, AgentVariant, MarketBundle, MarketSnapshot, CommentSignal
from prediction_market_agent.replay import compare_variants, load_bundle, rerun_trace, save_bundle


def test_save_load_and_replay_round_trip(tmp_path: Path):
    bundle = MarketBundle(
        market=MarketSnapshot(
            market_id="m1",
            question="Will it rain?",
            probability=0.42,
            volume=100.0,
            total_liquidity=50.0,
            creator_id="creator",
            created_time_ms=10,
        ),
        comments=[
            CommentSignal("c1", "m1", "u1", "alice", "YES because radar data shows 70% likelihood.", 11, signal_probability=0.7),
        ],
        actors={"u1": ActorProfile("u1", "alice", created_time_ms=1, total_deposits=1000, consistency=0.8)},
        captured_time_ms=20,
        source="fixture",
        scenario_name="test-scenario",
    )
    path = tmp_path / "trace.json"
    save_bundle(bundle, path)

    loaded = load_bundle(path)
    replay_result = rerun_trace(path, AgentVariant.V4, TCIConfig())
    comparison = compare_variants(path, TCIConfig())

    assert loaded.scenario_name == "test-scenario"
    assert replay_result.decision.market_id == "m1"
    assert set(comparison) == {"v1", "v2", "v3", "v4"}
