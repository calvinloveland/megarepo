from __future__ import annotations

import json
from pathlib import Path

from .config import TCIConfig
from .decision import run_agent_variant
from .models import AgentRunResult, AgentVariant, ExecutionMode, MarketBundle, to_jsonable


def save_bundle(bundle: MarketBundle, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(to_jsonable(bundle), handle, indent=2, sort_keys=True)
        handle.write("\n")


def load_bundle(path: Path) -> MarketBundle:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return MarketBundle.from_dict(data)


def save_run_result(result: AgentRunResult, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(to_jsonable(result), handle, indent=2, sort_keys=True)
        handle.write("\n")


def rerun_trace(
    path: Path,
    variant: AgentVariant,
    config: TCIConfig,
    *,
    mode: ExecutionMode = ExecutionMode.SHADOW,
    available_capital: float = 100.0,
    current_exposure: float = 0.0,
) -> AgentRunResult:
    bundle = load_bundle(path)
    return run_agent_variant(
        bundle,
        variant,
        config,
        mode=mode,
        available_capital=available_capital,
        current_exposure=current_exposure,
    )


def compare_variants(
    path: Path,
    config: TCIConfig,
    *,
    available_capital: float = 100.0,
    current_exposure: float = 0.0,
) -> dict[str, dict[str, float | None]]:
    bundle = load_bundle(path)
    results: dict[str, dict[str, float | None]] = {}
    for variant in AgentVariant:
        run = run_agent_variant(
            bundle,
            variant,
            config,
            mode=ExecutionMode.SHADOW,
            available_capital=available_capital,
            current_exposure=current_exposure,
        )
        results[variant.value] = {
            "target_probability": run.decision.target_probability,
            "bet_amount": run.decision.bet_amount,
            "exploitability": run.metrics["exploitability"],
            "expected_edge": run.metrics["expected_edge"],
            "brier_score": run.metrics["brier_score"],
        }
    return results
