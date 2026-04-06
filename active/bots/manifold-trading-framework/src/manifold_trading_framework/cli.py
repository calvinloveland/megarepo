from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .adapters.manifold import ManifoldAdapter
from .config import RuntimeConfig
from .execution import execute_decision
from .logging_utils import timestamp_slug
from .manifold_api import ManifoldClient
from tci_framework.config import TCIConfig
from tci_framework.decision import run_agent_variant
from tci_framework.models import AgentVariant, ExecutionMode, to_jsonable
from tci_framework.replay import compare_variants, rerun_trace, save_bundle, save_run_result


def _variant(value: str) -> AgentVariant:
    return AgentVariant(value)


def _mode(value: str) -> ExecutionMode:
    return ExecutionMode(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Trading framework for Manifold powered by the TCI framework")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="Capture a live market trace")
    ingest.add_argument("market_id")
    ingest.add_argument("--output", type=Path)

    run_agent = subparsers.add_parser("run-agent", help="Run a variant against live market data")
    run_agent.add_argument("market_id")
    run_agent.add_argument("--variant", type=_variant, default=AgentVariant.V4)
    run_agent.add_argument("--mode", type=_mode, default=ExecutionMode.SHADOW)
    run_agent.add_argument("--capital", type=float, default=100.0)
    run_agent.add_argument("--exposure", type=float, default=0.0)
    run_agent.add_argument("--output", type=Path)

    replay = subparsers.add_parser("replay", help="Replay a stored trace or scenario")
    replay.add_argument("trace_path", type=Path)
    replay.add_argument("--variant", type=_variant, default=AgentVariant.V4)
    replay.add_argument("--mode", type=_mode, default=ExecutionMode.SHADOW)
    replay.add_argument("--capital", type=float, default=100.0)
    replay.add_argument("--exposure", type=float, default=0.0)
    replay.add_argument("--output", type=Path)

    compare = subparsers.add_parser("compare-agents", help="Compare v1-v4 on one trace")
    compare.add_argument("trace_path", type=Path)
    compare.add_argument("--capital", type=float, default=100.0)
    compare.add_argument("--exposure", type=float, default=0.0)

    return parser


def _default_output_path(runtime: RuntimeConfig, prefix: str, suffix: str = ".json") -> Path:
    return runtime.default_run_dir / f"{prefix}-{timestamp_slug()}{suffix}"


def _print(payload: object) -> None:
    sys.stdout.write(json.dumps(to_jsonable(payload), indent=2, sort_keys=True))
    sys.stdout.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    runtime = RuntimeConfig.from_env()
    config = TCIConfig()
    client = ManifoldClient(
        base_url=runtime.api_base_url,
        api_key=runtime.api_key,
        timeout_seconds=runtime.timeout_seconds,
    )
    adapter = ManifoldAdapter(client)

    if args.command == "ingest":
        bundle = adapter.load_market_bundle(args.market_id)
        output = args.output or _default_output_path(runtime, f"trace-{args.market_id}")
        save_bundle(bundle, output)
        _print({"saved": str(output), "market_id": bundle.market.market_id, "comments": len(bundle.comments)})
        return 0

    if args.command == "run-agent":
        bundle = adapter.load_market_bundle(args.market_id)
        result = run_agent_variant(
            bundle,
            args.variant,
            config,
            mode=args.mode,
            available_capital=args.capital,
            current_exposure=args.exposure,
        )
        execution_result = execute_decision(adapter, result.decision, config)
        result = result.__class__(
            bundle=result.bundle,
            decision=result.decision,
            metrics=result.metrics,
            execution_result=execution_result,
        )
        output = args.output or _default_output_path(runtime, f"run-{args.variant.value}-{args.market_id}")
        save_run_result(result, output)
        _print({"saved": str(output), "decision": result.decision, "metrics": result.metrics, "execution": execution_result})
        return 0

    if args.command == "replay":
        result = rerun_trace(
            args.trace_path,
            args.variant,
            config,
            mode=args.mode,
            available_capital=args.capital,
            current_exposure=args.exposure,
        )
        output = args.output or _default_output_path(runtime, f"replay-{args.variant.value}-{args.trace_path.stem}")
        save_run_result(result, output)
        _print({"saved": str(output), "decision": result.decision, "metrics": result.metrics})
        return 0

    if args.command == "compare-agents":
        results = compare_variants(
            args.trace_path,
            config,
            available_capital=args.capital,
            current_exposure=args.exposure,
        )
        _print({"trace": str(args.trace_path), "results": results})
        return 0

    parser.error("Unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
