from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .logging_utils import write_json

DEFAULT_CEO_MODEL = "openrouter/free"
DEFAULT_HIRING_BUDGET_USD = 0.18


@dataclass(frozen=True)
class AgentRunConfig:
    project_root: Path
    run_dir: Path
    harness_dir: Path
    ceo_model: str = DEFAULT_CEO_MODEL
    budget_usd: float = DEFAULT_HIRING_BUDGET_USD
    mode: str = "shadow"


def _parse_json_object(text: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    for marker in ("```json", "```"):
        if marker in text:
            parts = text.split(marker)
            for part in parts:
                candidate = part.strip()
                if not candidate:
                    continue
                try:
                    value, _ = decoder.raw_decode(candidate)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    return value
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _build_phase_one_payload(*, trace_path: Path, budget_usd: float, project_root: Path) -> dict[str, Any]:
    trace = str(trace_path.resolve())
    cwd = str(project_root.resolve())
    return {
        "budgetUsd": budget_usd,
        "mode": "run",
        "workerScope": "project",
        "confirmProjectWorkers": False,
        "persistLedger": True,
        "reviewMode": "none",
        "cwd": cwd,
        "workerNames": ["market-researcher", "risk-manager"],
        "maxCandidatesPerJob": 1,
        "jobs": [
            {
                "id": "market-research",
                "objective": (
                    f"Read the market trace at {trace}. Understand the market question, comments, market probability, and likely resolution criteria. "
                    "Return only one JSON object with keys: verdict, resolutionClarity, fairValueLow, fairValueHigh, reasons, unknowns, noveltyRisk, creatorControlRisk."
                ),
                "acceptanceCriteria": "Valid JSON only. noveltyRisk and creatorControlRisk must each be low, medium, or high.",
                "preferredRole": "researcher",
                "maxBudgetUsd": round(budget_usd * 0.45, 3),
            },
            {
                "id": "risk-screen",
                "objective": (
                    f"Read the market trace at {trace}. Act as the trading risk manager. Focus on ambiguity, creator control, novelty/game mechanics, and bankroll protection. "
                    "Return only one JSON object with keys: verdict, maxBetSize, riskFlags, reasons, allowLive. verdict must be one of no-trade, shadow-only, tradable."
                ),
                "acceptanceCriteria": "Valid JSON only. novelty/game-like or creator-controlled markets should usually be no-trade or shadow-only.",
                "preferredRole": "risk-manager",
                "maxBudgetUsd": round(budget_usd * 0.55, 3),
            },
        ],
    }


def _extract_job_outputs(ledger_payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    details = ledger_payload.get("details", {})
    outputs: dict[str, dict[str, Any]] = {}
    for job in details.get("jobs", []):
        job_id = job.get("job", {}).get("id")
        if not job_id:
            continue
        execution = job.get("execution") or {}
        output_text = execution.get("output") or ""
        parsed = _parse_json_object(output_text) or {}
        outputs[job_id] = {
            "selectedWorker": (job.get("selectedApplication") or {}).get("workerName"),
            "selectedModel": (job.get("selectedApplication") or {}).get("workerModel"),
            "rawOutput": output_text,
            "parsed": parsed,
            "review": (job.get("review") or {}).get("output"),
        }
    return outputs


def _build_phase_two_payload(*, phase_one_outputs: dict[str, dict[str, Any]], budget_usd: float, project_root: Path) -> dict[str, Any]:
    cwd = str(project_root.resolve())
    digest = json.dumps({key: value.get("parsed") or {"rawOutput": value.get("rawOutput", "")[:1200]} for key, value in phase_one_outputs.items()}, indent=2)
    return {
        "budgetUsd": budget_usd,
        "mode": "run",
        "workerScope": "project",
        "confirmProjectWorkers": False,
        "persistLedger": True,
        "reviewMode": "none",
        "cwd": cwd,
        "workerNames": ["reviewer", "execution-planner"],
        "maxCandidatesPerJob": 1,
        "jobs": [
            {
                "id": "final-review",
                "objective": (
                    "You are the final skeptic. Review this prior agent evidence and decide whether the trade case survives review. "
                    "Return only one JSON object with keys: verdict, reasons, confidenceAdjustment. verdict must be block, caution, or pass.\n\n"
                    f"Evidence:\n{digest}"
                ),
                "acceptanceCriteria": "Valid JSON only.",
                "preferredRole": "reviewer",
                "maxBudgetUsd": round(budget_usd * 0.42, 3),
            },
            {
                "id": "final-execution-plan",
                "objective": (
                    "You are the final execution planner. Review this prior agent evidence and produce a bounded trade recommendation. "
                    "Return only one JSON object with keys: action, outcome, maxBetSize, targetProbability, reasons, invalidationTriggers. "
                    "action must be skip, shadow, or live. outcome must be YES, NO, or NONE.\n\n"
                    f"Evidence:\n{digest}"
                ),
                "acceptanceCriteria": "Valid JSON only.",
                "preferredRole": "execution-planner",
                "maxBudgetUsd": round(budget_usd * 0.58, 3),
            },
        ],
    }


def _build_ceo_prompt(payload: dict[str, Any], *, phase_name: str) -> str:
    return (
        "You are the CEO for a Manifold trading workflow. "
        "Call hire_workers exactly once with the payload below. "
        "Do not answer from your own judgment without running the workers. "
        "After the tool call, give a short summary of what happened.\n\n"
        f"Phase: {phase_name}\n\n"
        f"{json.dumps(payload, indent=2)}"
    )


def _latest_ledger_path(project_root: Path, started_at: float) -> Path | None:
    ledger_dir = project_root / ".pi" / "hiring-runs"
    if not ledger_dir.exists():
        return None
    ledgers = [path for path in ledger_dir.glob("*.json") if path.is_file() and path.stat().st_mtime >= started_at - 1]
    if not ledgers:
        ledgers = [path for path in ledger_dir.glob("*.json") if path.is_file()]
    return max(ledgers, key=lambda path: path.stat().st_mtime, default=None)


def _run_hiring_round(*, project_root: Path, harness_dir: Path, ceo_model: str, payload: dict[str, Any], phase_name: str) -> dict[str, Any]:
    prompt = _build_ceo_prompt(payload, phase_name=phase_name)
    started_at = time.time()
    proc = subprocess.run(
        [
            "pi",
            "-e",
            str(harness_dir.resolve()),
            "--model",
            ceo_model,
            "--no-builtin-tools",
            "--tools",
            "hire_workers",
            "--mode",
            "json",
            "-p",
            "--no-session",
            prompt,
        ],
        cwd=project_root,
        capture_output=True,
        text=True,
        timeout=420,
    )
    ledger_path = _latest_ledger_path(project_root, started_at)
    ledger_payload = None
    if ledger_path is not None:
        ledger_payload = json.loads(ledger_path.read_text(encoding="utf-8"))
    if proc.returncode != 0:
        raise RuntimeError(f"Pi hiring round failed for {phase_name}: {proc.stderr[-2000:]}")
    if ledger_payload is None:
        raise RuntimeError(f"No hiring ledger was produced for {phase_name}.")
    return {
        "phase": phase_name,
        "prompt": prompt,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "ledgerPath": str(ledger_path),
        "ledger": ledger_payload,
        "outputs": _extract_job_outputs(ledger_payload),
    }


def _normalize_recommendation(*, market_id: str, requested_mode: str, phase_one: dict[str, Any], phase_two: dict[str, Any]) -> dict[str, Any]:
    phase_one_outputs = phase_one["outputs"]
    phase_two_outputs = phase_two["outputs"]
    risk_initial = (phase_one_outputs.get("risk-screen") or {}).get("parsed") or {}
    review_final = (phase_two_outputs.get("final-review") or {}).get("parsed") or {}
    execution_plan = (phase_two_outputs.get("final-execution-plan") or {}).get("parsed") or {}

    reasons: list[str] = []
    risk_flags: list[str] = []
    for source in (risk_initial,):
        for reason in source.get("reasons", []) or []:
            reasons.append(str(reason))
        for flag in source.get("riskFlags", []) or []:
            risk_flags.append(str(flag))

    blocked = False
    shadow_only = False
    if risk_initial.get("verdict") in {"no-trade", "shadow-only"}:
        blocked = risk_initial.get("verdict") == "no-trade"
        shadow_only = shadow_only or risk_initial.get("verdict") == "shadow-only"
    if review_final.get("verdict") == "block":
        blocked = True

    action = str(execution_plan.get("action", "skip"))
    outcome = str(execution_plan.get("outcome", "NONE")).upper()
    bet_amount = float(execution_plan.get("maxBetSize") or 0.0)
    target_probability = execution_plan.get("targetProbability")
    target_probability = float(target_probability) if target_probability is not None else None

    if blocked:
        action = "skip"
        outcome = "NONE"
        bet_amount = 0.0
        reasons.append("A risk or review agent blocked the trade.")
    elif shadow_only and action == "live":
        action = "shadow"
        reasons.append("Risk manager downgraded the trade to shadow-only.")

    final_mode = "shadow"
    if action == "live" and requested_mode == "live":
        final_mode = "live"
    elif action in {"shadow", "live"}:
        final_mode = "shadow"
    else:
        final_mode = requested_mode

    return {
        "marketId": market_id,
        "requestedMode": requested_mode,
        "finalMode": final_mode,
        "action": action,
        "outcome": outcome,
        "betAmount": round(max(0.0, bet_amount), 4),
        "targetProbability": round(target_probability, 6) if target_probability is not None else None,
        "reasons": reasons + [str(reason) for reason in execution_plan.get("reasons", []) or []],
        "riskFlags": risk_flags,
        "phaseOneRiskVerdict": risk_initial.get("verdict"),
        "phaseTwoRiskVerdict": None,
        "phaseTwoReviewVerdict": review_final.get("verdict"),
        "rawExecutionPlan": execution_plan,
    }


def execute_agent_recommendation(adapter: Any, recommendation: dict[str, Any]) -> dict[str, Any]:
    action = recommendation.get("action")
    bet_amount = float(recommendation.get("betAmount") or 0.0)
    if action == "skip" or bet_amount <= 0:
        return {
            "status": "hold",
            "mode": recommendation.get("finalMode"),
            "betAmount": 0.0,
            "marketId": recommendation.get("marketId"),
        }
    if recommendation.get("finalMode") == "shadow":
        return {
            "status": "shadow",
            "mode": "shadow",
            "marketId": recommendation.get("marketId"),
            "action": action,
            "outcome": recommendation.get("outcome"),
            "betAmount": bet_amount,
            "targetProbability": recommendation.get("targetProbability"),
        }
    response = adapter.place_order(
        recommendation["marketId"],
        amount=bet_amount,
        outcome=str(recommendation.get("outcome", "NONE")),
        limit_prob=recommendation.get("targetProbability"),
    )
    return {
        "status": "live",
        "mode": "live",
        "marketId": recommendation.get("marketId"),
        "action": action,
        "outcome": recommendation.get("outcome"),
        "betAmount": bet_amount,
        "targetProbability": recommendation.get("targetProbability"),
        "response": response,
    }


def run_agent_market_review(*, adapter: Any, market_id: str, trace_path: Path, config: AgentRunConfig) -> dict[str, Any]:
    phase_one_payload = _build_phase_one_payload(trace_path=trace_path, budget_usd=round(config.budget_usd * 0.5, 3), project_root=config.project_root)
    phase_one = _run_hiring_round(
        project_root=config.project_root,
        harness_dir=config.harness_dir,
        ceo_model=config.ceo_model,
        payload=phase_one_payload,
        phase_name="market-scan",
    )
    phase_two_payload = _build_phase_two_payload(
        phase_one_outputs=phase_one["outputs"],
        budget_usd=round(config.budget_usd * 0.5, 3),
        project_root=config.project_root,
    )
    phase_two = _run_hiring_round(
        project_root=config.project_root,
        harness_dir=config.harness_dir,
        ceo_model=config.ceo_model,
        payload=phase_two_payload,
        phase_name="decision-gate",
    )
    recommendation = _normalize_recommendation(
        market_id=market_id,
        requested_mode=config.mode,
        phase_one=phase_one,
        phase_two=phase_two,
    )
    execution_result = execute_agent_recommendation(adapter, recommendation)
    artifact = {
        "kind": "agent-run",
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "marketId": market_id,
        "tracePath": str(trace_path),
        "phaseOne": {
            "ledgerPath": phase_one["ledgerPath"],
            "outputs": phase_one["outputs"],
        },
        "phaseTwo": {
            "ledgerPath": phase_two["ledgerPath"],
            "outputs": phase_two["outputs"],
        },
        "recommendation": recommendation,
        "execution_result": execution_result,
    }
    output = config.run_dir / f"agent-run-{market_id}-{int(time.time() * 1000)}.json"
    write_json(output, artifact)
    artifact["saved"] = str(output)
    return artifact
