from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _artifact_kind(payload: dict[str, Any]) -> str:
    if payload.get("kind") == "agent-run" or "recommendation" in payload:
        return "agent-run"
    if "decision" in payload and "bundle" in payload:
        return "run"
    if "market" in payload and "comments" in payload:
        return "trace"
    return "unknown"


def _market_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("kind") == "agent-run":
        recommendation = payload.get("recommendation", {})
        return {
            "market_id": payload.get("marketId") or recommendation.get("marketId"),
            "question": payload.get("question") or payload.get("marketQuestion"),
            "probability": payload.get("marketProbability"),
            "volume": None,
            "total_liquidity": None,
        }
    if "bundle" in payload:
        return payload.get("bundle", {}).get("market", {})
    return payload.get("market", {})


def _captured_time_ms(payload: dict[str, Any]) -> int | None:
    if payload.get("kind") == "agent-run":
        return None
    if "bundle" in payload:
        return payload.get("bundle", {}).get("captured_time_ms")
    return payload.get("captured_time_ms")


def _comments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if payload.get("kind") == "agent-run":
        return []
    if "bundle" in payload:
        return list(payload.get("bundle", {}).get("comments", []))
    return list(payload.get("comments", []))


def _actors(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("kind") == "agent-run":
        return {}
    if "bundle" in payload:
        return dict(payload.get("bundle", {}).get("actors", {}))
    return dict(payload.get("actors", {}))


def _execution_status(payload: dict[str, Any]) -> str | None:
    execution = payload.get("execution_result")
    if not isinstance(execution, dict):
        return None
    status = execution.get("status")
    return str(status) if status is not None else None


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def summarize_artifact(path: Path) -> dict[str, Any]:
    payload = _load_json(path)
    kind = _artifact_kind(payload)
    market = _market_payload(payload)
    decision = payload.get("decision", {}) if isinstance(payload.get("decision"), dict) else {}
    recommendation = payload.get("recommendation", {}) if isinstance(payload.get("recommendation"), dict) else {}
    metrics = payload.get("metrics", {}) if isinstance(payload.get("metrics"), dict) else {}
    comments = _comments(payload)
    actors = _actors(payload)
    summary = {
        "id": path.stem,
        "fileName": path.name,
        "path": str(path),
        "kind": kind,
        "capturedTimeMs": _captured_time_ms(payload),
        "marketId": market.get("market_id"),
        "question": market.get("question") or decision.get("market_question") or payload.get("marketQuestion") or path.stem,
        "marketProbability": _coerce_float(market.get("probability") or decision.get("market_probability") or payload.get("marketProbability")),
        "volume": _coerce_float(market.get("volume")),
        "liquidity": _coerce_float(market.get("total_liquidity")),
        "commentCount": len(comments),
        "actorCount": len(actors),
        "variant": decision.get("variant") or payload.get("kind"),
        "action": decision.get("action") or recommendation.get("action"),
        "mode": decision.get("mode") or recommendation.get("finalMode"),
        "betAmount": _coerce_float(decision.get("bet_amount") or recommendation.get("betAmount")),
        "targetProbability": _coerce_float(decision.get("target_probability") or recommendation.get("targetProbability")),
        "confidence": _coerce_float(decision.get("confidence")),
        "expectedEdge": _coerce_float(metrics.get("expected_edge")),
        "exploitability": _coerce_float(metrics.get("exploitability")),
        "brierScore": _coerce_float(metrics.get("brier_score")),
        "executionStatus": _execution_status(payload),
        "source": payload.get("source") or payload.get("bundle", {}).get("source") or ("agent" if kind == "agent-run" else "local"),
    }
    return summary


def load_artifact_detail(path: Path) -> dict[str, Any]:
    payload = _load_json(path)
    return {
        "summary": summarize_artifact(path),
        "payload": payload,
    }


def list_artifact_paths(run_dir: Path) -> list[Path]:
    if not run_dir.exists():
        return []
    return sorted((path for path in run_dir.glob("*.json") if path.is_file()), key=lambda item: item.stat().st_mtime, reverse=True)


def list_artifact_summaries(run_dir: Path) -> list[dict[str, Any]]:
    return [summarize_artifact(path) for path in list_artifact_paths(run_dir)]


def build_overview(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    runs = [artifact for artifact in artifacts if artifact["kind"] == "run"]
    traces = [artifact for artifact in artifacts if artifact["kind"] == "trace"]
    action_counts: dict[str, int] = {}
    execution_counts: dict[str, int] = {}
    expected_edges = [value for artifact in runs if (value := artifact.get("expectedEdge")) is not None]
    confidences = [value for artifact in runs if (value := artifact.get("confidence")) is not None]
    for artifact in runs:
        action = artifact.get("action") or "unknown"
        action_counts[action] = action_counts.get(action, 0) + 1
        execution = artifact.get("executionStatus") or artifact.get("mode") or "unknown"
        execution_counts[execution] = execution_counts.get(execution, 0) + 1
    latest_capture = max((artifact.get("capturedTimeMs") or 0 for artifact in artifacts), default=0) or None
    return {
        "totalArtifacts": len(artifacts),
        "runCount": len(runs),
        "traceCount": len(traces),
        "actionCounts": action_counts,
        "executionCounts": execution_counts,
        "averageExpectedEdge": round(sum(expected_edges) / len(expected_edges), 4) if expected_edges else None,
        "averageConfidence": round(sum(confidences) / len(confidences), 4) if confidences else None,
        "latestCaptureTimeMs": latest_capture,
    }


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    lines = text.splitlines()
    frontmatter: dict[str, str] = {}
    for index in range(1, len(lines)):
        line = lines[index]
        if line.strip() == "---":
            body = "\n".join(lines[index + 1 :]).strip()
            return frontmatter, body
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        frontmatter[key.strip()] = value.strip()
    return frontmatter, text


def load_worker_profiles(worker_dir: Path) -> list[dict[str, Any]]:
    if not worker_dir.exists():
        return []
    workers: list[dict[str, Any]] = []
    for path in sorted(worker_dir.glob("*.md")):
        if path.name.upper() == "README.md":
            continue
        frontmatter, body = _parse_frontmatter(path.read_text(encoding="utf-8"))
        workers.append(
            {
                "id": path.stem,
                "path": str(path),
                "name": frontmatter.get("name", path.stem),
                "description": frontmatter.get("description", ""),
                "role": frontmatter.get("role", "worker"),
                "tools": [part.strip() for part in frontmatter.get("tools", "").split(",") if part.strip()],
                "inputPricePerMillion": _coerce_float(frontmatter.get("input_price_per_million")),
                "outputPricePerMillion": _coerce_float(frontmatter.get("output_price_per_million")),
                "body": body,
            }
        )
    return workers


def load_dashboard_snapshot(run_dir: Path, worker_dir: Path, plan_path: Path) -> dict[str, Any]:
    artifacts = list_artifact_summaries(run_dir)
    workers = load_worker_profiles(worker_dir)
    return {
        "overview": build_overview(artifacts),
        "artifacts": artifacts,
        "workers": workers,
        "plan": {
            "path": str(plan_path),
            "exists": plan_path.exists(),
        },
        "runDir": str(run_dir),
        "workerDir": str(worker_dir),
    }
