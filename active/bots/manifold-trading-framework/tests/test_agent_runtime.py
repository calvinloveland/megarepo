from __future__ import annotations

from pathlib import Path

from manifold_trading_framework.agent_runtime import _normalize_recommendation, _parse_json_object


def test_parse_json_object_finds_fenced_json():
    text = "Summary first.\n```json\n{\"verdict\": \"shadow-only\", \"maxBetSize\": 1.5}\n```"

    parsed = _parse_json_object(text)

    assert parsed == {"verdict": "shadow-only", "maxBetSize": 1.5}


def test_normalize_recommendation_blocks_when_risk_or_review_blocks():
    phase_one = {
        "outputs": {
            "risk-screen": {"parsed": {"verdict": "shadow-only", "reasons": ["novelty market"], "riskFlags": ["novelty"]}},
            "red-team": {"parsed": {"verdict": "pass"}},
        }
    }
    phase_two = {
        "outputs": {
            "final-risk-veto": {"parsed": {"verdict": "no-trade", "reasons": ["creator-controlled"], "riskFlags": ["creator-control"]}},
            "final-review": {"parsed": {"verdict": "block"}},
            "final-execution-plan": {
                "parsed": {
                    "action": "live",
                    "outcome": "YES",
                    "maxBetSize": 3.0,
                    "targetProbability": 0.61,
                    "reasons": ["looks good"],
                }
            },
        }
    }

    recommendation = _normalize_recommendation(
        market_id="m1",
        requested_mode="live",
        phase_one=phase_one,
        phase_two=phase_two,
    )

    assert recommendation["action"] == "skip"
    assert recommendation["betAmount"] == 0.0
    assert recommendation["phaseOneRiskVerdict"] == "shadow-only"
    assert recommendation["phaseTwoRiskVerdict"] == "no-trade"
    assert "creator-control" in recommendation["riskFlags"]


def test_normalize_recommendation_downgrades_live_to_shadow():
    phase_one = {
        "outputs": {
            "risk-screen": {"parsed": {"verdict": "tradable", "reasons": [], "riskFlags": []}},
            "red-team": {"parsed": {"verdict": "caution"}},
        }
    }
    phase_two = {
        "outputs": {
            "final-risk-veto": {"parsed": {"verdict": "shadow-only", "reasons": ["needs more calibration"], "riskFlags": ["calibration"]}},
            "final-review": {"parsed": {"verdict": "pass"}},
            "final-execution-plan": {
                "parsed": {
                    "action": "live",
                    "outcome": "NO",
                    "maxBetSize": 2.25,
                    "targetProbability": 0.22,
                    "reasons": ["edge survives"],
                }
            },
        }
    }

    recommendation = _normalize_recommendation(
        market_id="m2",
        requested_mode="live",
        phase_one=phase_one,
        phase_two=phase_two,
    )

    assert recommendation["action"] == "shadow"
    assert recommendation["finalMode"] == "shadow"
    assert recommendation["outcome"] == "NO"
    assert recommendation["betAmount"] == 2.25
