from __future__ import annotations

import json

from manifold_trading_framework.dashboard import create_app
from manifold_trading_framework.dashboard_data import build_overview, list_artifact_summaries, load_worker_profiles


def _write_json(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_dashboard_data_summarizes_runs_and_workers(tmp_path):
    run_dir = tmp_path / "data" / "runs"
    worker_dir = tmp_path / ".pi" / "workers"
    worker_dir.mkdir(parents=True)

    _write_json(
        run_dir / "run-v4-market-1.json",
        {
            "bundle": {
                "captured_time_ms": 1710000000000,
                "market": {
                    "market_id": "market-1",
                    "question": "Will it rain?",
                    "probability": 0.42,
                    "volume": 250,
                    "total_liquidity": 90,
                },
                "comments": [{"id": "c1"}],
                "actors": {"u1": {"username": "alice"}},
            },
            "decision": {
                "variant": "v4",
                "action": "buy_yes",
                "mode": "shadow",
                "bet_amount": 12.5,
                "market_question": "Will it rain?",
                "market_probability": 0.42,
                "target_probability": 0.57,
                "confidence": 0.31,
                "policy": {"allowed_bet_size": 12.5, "capability_scale": 0.31, "adversarial_pressure": 0.12, "should_trade": True},
                "evaluated_inputs": [],
                "rationale": ["variant=v4"],
            },
            "metrics": {"expected_edge": 0.15, "exploitability": 0.08, "brier_score": 0.17},
            "execution_result": {"status": "shadow"},
        },
    )
    _write_json(
        run_dir / "trace-market-2.json",
        {
            "captured_time_ms": 1710000005000,
            "market": {
                "market_id": "market-2",
                "question": "Will it snow?",
                "probability": 0.23,
                "volume": 180,
                "total_liquidity": 55,
            },
            "comments": [{"id": "c2"}, {"id": "c3"}],
            "actors": {"u2": {"username": "bob"}, "u3": {"username": "cora"}},
        },
    )
    (worker_dir / "risk-manager.md").write_text(
        "---\nname: risk-manager\ndescription: Finds trade blow-up paths\nrole: risk-manager\ntools: read,bash\ninput_price_per_million: 0\noutput_price_per_million: 0\n---\n\nRisk body.",
        encoding="utf-8",
    )

    artifacts = list_artifact_summaries(run_dir)
    overview = build_overview(artifacts)
    workers = load_worker_profiles(worker_dir)

    assert [artifact["kind"] for artifact in artifacts] == ["trace", "run"]
    run_artifact = next(artifact for artifact in artifacts if artifact["kind"] == "run")
    assert run_artifact["action"] == "buy_yes"
    assert run_artifact["expectedEdge"] == 0.15
    assert overview["runCount"] == 1
    assert overview["traceCount"] == 1
    assert overview["averageConfidence"] == 0.31
    assert workers[0]["name"] == "risk-manager"
    assert workers[0]["tools"] == ["read", "bash"]


def test_dashboard_app_serves_html_and_api(tmp_path):
    run_dir = tmp_path / "data" / "runs"
    project_root = tmp_path
    _write_json(
        run_dir / "run-v4-market-1.json",
        {
            "bundle": {
                "captured_time_ms": 1710000000000,
                "market": {
                    "market_id": "market-1",
                    "question": "Will it rain?",
                    "probability": 0.42,
                    "volume": 250,
                    "total_liquidity": 90,
                },
                "comments": [],
                "actors": {},
            },
            "decision": {
                "variant": "v4",
                "action": "hold",
                "mode": "shadow",
                "bet_amount": 0,
                "market_question": "Will it rain?",
                "market_probability": 0.42,
                "target_probability": 0.42,
                "confidence": 0.02,
                "policy": {"allowed_bet_size": 0, "capability_scale": 0.02, "adversarial_pressure": 0.0, "should_trade": False},
                "evaluated_inputs": [],
                "rationale": ["hold"],
            },
            "metrics": {"expected_edge": 0.0, "exploitability": 0.0, "brier_score": 0.25},
            "execution_result": {"status": "hold"},
        },
    )
    worker_dir = project_root / ".pi" / "workers"
    worker_dir.mkdir(parents=True)
    (worker_dir / "market-researcher.md").write_text(
        "---\nname: market-researcher\ndescription: Reads one market well\nrole: researcher\ntools: read,bash\n---\n\nBody.",
        encoding="utf-8",
    )
    docs_dir = project_root / "docs"
    docs_dir.mkdir()
    (docs_dir / "multi-agent-hiring-plan.md").write_text("# Plan\n", encoding="utf-8")

    app = create_app(run_dir=run_dir, project_root=project_root)
    client = app.test_client()

    html_response = client.get("/")
    api_response = client.get("/api/dashboard")
    detail_response = client.get("/api/artifacts/run-v4-market-1")

    assert html_response.status_code == 200
    assert b"Manifold Trading Dashboard" in html_response.data
    assert api_response.status_code == 200
    assert api_response.json["overview"]["runCount"] == 1
    assert api_response.json["workers"][0]["name"] == "market-researcher"
    assert detail_response.status_code == 200
    assert detail_response.json["summary"]["id"] == "run-v4-market-1"
