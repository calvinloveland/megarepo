from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import RuntimeConfig
from .dashboard import run_dashboard
from .logging_utils import timestamp_slug


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Agent-first Manifold trading framework")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ingest = subparsers.add_parser("ingest", help="Capture a live market trace")
    ingest.add_argument("market_id")
    ingest.add_argument("--output", type=Path)

    run_agent = subparsers.add_parser("run-agent", help="Run the CEO + hired specialist workflow for one live market")
    run_agent.add_argument("market_id")
    run_agent.add_argument("--mode", choices=["shadow", "live"], default="shadow")
    run_agent.add_argument("--budget-usd", type=float, default=0.18)
    run_agent.add_argument("--ceo-model", default="openrouter/free")
    run_agent.add_argument("--project-root", type=Path, default=Path.cwd())
    run_agent.add_argument("--harness-dir", type=Path)

    replay = subparsers.add_parser("replay", help="Replay a stored trace or scenario with the deterministic baseline")
    replay.add_argument("trace_path", type=Path)
    replay.add_argument("--variant", choices=["v1", "v2", "v3", "v4"], default="v4")
    replay.add_argument("--mode", choices=["shadow", "live"], default="shadow")
    replay.add_argument("--capital", type=float, default=100.0)
    replay.add_argument("--exposure", type=float, default=0.0)
    replay.add_argument("--output", type=Path)

    compare = subparsers.add_parser("compare-agents", help="Compare deterministic v1-v4 baselines on one trace")
    compare.add_argument("trace_path", type=Path)
    compare.add_argument("--capital", type=float, default=100.0)
    compare.add_argument("--exposure", type=float, default=0.0)

    dashboard = subparsers.add_parser("dashboard", help="Serve a local web dashboard for run artifacts and worker roles")
    dashboard.add_argument("--host", default="127.0.0.1")
    dashboard.add_argument("--port", type=int, default=5050)
    dashboard.add_argument("--run-dir", type=Path)
    dashboard.add_argument("--project-root", type=Path, default=Path.cwd())
    dashboard.add_argument("--debug", action="store_true")

    return parser


def _default_output_path(runtime: RuntimeConfig, prefix: str, suffix: str = ".json") -> Path:
    return runtime.default_run_dir / f"{prefix}-{timestamp_slug()}{suffix}"


def _print(payload: object) -> None:
    from tci_framework.models import to_jsonable

    sys.stdout.write(json.dumps(to_jsonable(payload), indent=2, sort_keys=True))
    sys.stdout.write("\n")


def _default_harness_dir(project_root: Path) -> Path:
    return (project_root / ".." / ".." / "dev-tools" / "pi-hiring-harness").resolve()


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    runtime = RuntimeConfig.from_env()

    if args.command == "dashboard":
        run_dashboard(
            run_dir=args.run_dir or runtime.default_run_dir,
            project_root=args.project_root,
            host=args.host,
            port=args.port,
            debug=args.debug,
        )
        return 0

    from .adapters.manifold import ManifoldAdapter
    from .manifold_api import ManifoldClient
    from tci_framework.config import TCIConfig
    from tci_framework.models import AgentVariant, ExecutionMode
    from tci_framework.replay import compare_variants, rerun_trace, save_bundle, save_run_result

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
        from .agent_runtime import AgentRunConfig, run_agent_market_review

        project_root = args.project_root.resolve()
        run_dir = (project_root / runtime.default_run_dir).resolve() if not runtime.default_run_dir.is_absolute() else runtime.default_run_dir
        harness_dir = args.harness_dir.resolve() if args.harness_dir else _default_harness_dir(project_root)
        bundle = adapter.load_market_bundle(args.market_id)
        trace_output = run_dir / f"trace-{args.market_id}-{timestamp_slug()}.json"
        save_bundle(bundle, trace_output)
        artifact = run_agent_market_review(
            adapter=adapter,
            market_id=args.market_id,
            trace_path=trace_output,
            config=AgentRunConfig(
                project_root=project_root,
                run_dir=run_dir,
                harness_dir=harness_dir,
                ceo_model=args.ceo_model,
                budget_usd=args.budget_usd,
                mode=args.mode,
            ),
        )
        _print({
            "saved": artifact["saved"],
            "trace": str(trace_output),
            "recommendation": artifact["recommendation"],
            "execution": artifact["execution_result"],
            "phaseOneLedger": artifact["phaseOne"]["ledgerPath"],
            "phaseTwoLedger": artifact["phaseTwo"]["ledgerPath"],
        })
        return 0

    config = TCIConfig()

    if args.command == "replay":
        variant = AgentVariant(args.variant)
        mode = ExecutionMode(args.mode)
        result = rerun_trace(
            args.trace_path,
            variant,
            config,
            mode=mode,
            available_capital=args.capital,
            current_exposure=args.exposure,
        )
        output = args.output or _default_output_path(runtime, f"replay-{variant.value}-{args.trace_path.stem}")
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
