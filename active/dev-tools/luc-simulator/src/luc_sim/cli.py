"""Command-line interface: ``luc-sim {codes|sweep|metrics|demo|plot}``."""

from __future__ import annotations

import argparse
import json
import random
import sys

from luc_sim import __version__
from luc_sim.channel import DynamicChannel
from luc_sim.codec import UniversalCodec
from luc_sim.codes import registry_summary
from luc_sim.metrics import code_bler_table, format_report, luc_metrics
from luc_sim.plot import bler_curves_svg
from luc_sim.sim import best_fixed_code, run_link

GENTLE_SCHEDULE = [(0, 12.0), (150, 4.0), (300, 9.0), (450, 1.5), (600, 10.0)]
HARSH_SCHEDULE = [(0, 8.0), (120, 2.0), (240, 6.0), (360, 0.5), (480, 9.0), (600, 3.0)]


def _make_codec(args) -> UniversalCodec:
    return UniversalCodec(
        target_bler=args.target_bler,
        max_queries=args.max_queries,
        mission=args.mission,
        profile_frames=args.profile_frames,
        cache=not args.no_cache,
    )


def cmd_codes(args) -> int:
    codec = _make_codec(args)
    for line in registry_summary(codec.registry):
        print(line)
    print()
    for code in codec.registry.values():
        print(" ", code.describe())
    return 0


def _predict(codec, name, snr_points, args):
    from luc_sim.profiles import predict_bler
    return [
        predict_bler(codec.registry[name], s, n_frames=args.frames,
                     max_queries=args.max_queries, cache=not args.no_cache)[0]
        for s in snr_points
    ]


def cmd_sweep(args) -> int:
    codec = _make_codec(args)
    snr_points = [float(x) for x in args.snr.split(",")]
    codes = [args.code] if (args.code and args.code != "all") else codec.by_id
    table: dict[str, list] = {}
    print(f"{'code':14s} " + "  ".join(f"{s:6.1f}" for s in snr_points))
    for name in codes:
        bler = _predict(codec, name, snr_points, args)
        table[name] = bler
        print(f"{name:14s} " + "  ".join(f"{b:6.4f}" for b in bler))
    if args.json:
        with open(args.json, "w") as f:
            json.dump({k: dict(zip([f"{s:g}" for s in snr_points], v)) for k, v in table.items()}, f, indent=2)
        print(f"\nwrote {args.json}")
    return 0


def cmd_metrics(args) -> int:
    codec = _make_codec(args)
    if args.static:
        channel = DynamicChannel([(0, args.mean_snr)] * 1)
    else:
        channel = DynamicChannel(GENTLE_SCHEDULE)
    m = luc_metrics(
        codec, channel, n_frames=args.frames, seed=args.seed,
        target_bler=args.target_bler, max_queries=args.max_queries,
        cache=not args.no_cache, frame_ms=args.frame_ms,
    )
    print(format_report(m))
    if args.json:
        with open(args.json, "w") as f:
            json.dump(m, f, indent=2)
        print(f"\nwrote {args.json}")
    return 0


def _print_timeline(report, stride: int = 5) -> None:
    print(f"\n{'fr':>4} {'true':>5} {'est':>5}  {'code':<16} {'fam':<11} {'q':>5} {'st':>3}")
    prev_code = None
    for r in report.records:
        if r.t % stride != 0 and r.code_name == prev_code and not (r.outage or not r.ok):
            prev_code = r.code_name
            continue
        prev_code = r.code_name
        status = "OUT" if r.outage else ("ERR" if not r.ok else "ok ")
        print(f"{r.t:>4} {r.true_snr_db:>5.1f} {r.est_snr_db:>5.1f}  {r.code_name:<16} "
              f"{r.family:<11} {r.queries:>5} {status}")
    print()


def cmd_demo(args) -> int:
    codec = _make_codec(args)
    schedule = GENTLE_SCHEDULE if args.scenario == "gentle" else HARSH_SCHEDULE
    channel = DynamicChannel(
        schedule, burst_prob=args.burst_prob, burst_penalty_db=args.burst_penalty,
    )

    print("=" * 78)
    print("LUC adaptive link demo")
    print("=" * 78)
    print(f"Scenario: {args.scenario}  frames={args.frames}  seed={args.seed}  "
          f"mission={args.mission}  target_BLER={args.target_bler}")
    print(f"Channel schedule (frame, Eb/N0 dB): {schedule}")
    print(f"Registry: {len(codec.registry)} codes across "
          f"{len(codec.family_counts)} families "
          f"({', '.join(f'{f}x{c}' for f, c in sorted(codec.family_counts.items()))})")

    if args.update:
        from luc_sim.codes import polar

        codec.register(polar(16, 8, name="polar16-8-updated"))
        print(f"Field update: registered polar16-8-updated -> registry now "
              f"{len(codec.registry)} codes ({len(codec.family_counts)} families)")

    if args.fixed:
        fixed = best_fixed_code(codec, channel.mean_snr_db(args.frames))
        print(f"SoTA baseline: fixed code = {fixed}")
        report = run_link(codec, channel, args.frames, seed=args.seed, adaptive=False,
                          fixed_code=fixed, frame_ms=args.frame_ms)
    else:
        report = run_link(codec, channel, args.frames, seed=args.seed, adaptive=True,
                          frame_ms=args.frame_ms)

    print(f"\n{'frame':>5} {'old':<16} -> {'new':<16} {'estSNR':>6}  reason")
    for s in codec.switches:
        print(f"{s.t:>5} {str(s.old):<16} -> {s.new:<16} {s.est_snr_db:>6.1f}  {s.reason}")

    _print_timeline(report, stride=max(1, args.frames // 60))

    print(f"BLER          : {report.bler():.4f}   (outage {report.outage_rate():.4f})")
    print(f"Goodput       : {report.goodput():.4f} info bits / transmitted bit")
    print(f"Avg queries   : {report.avg_queries():.1f} / frame  ({report.queries_per_info_bit():.2f} / info bit)")
    print(f"Code switches : {len(codec.switches)}")
    usage = report.code_usage()
    print(f"Codes used    : {', '.join(f'{k}={v}' for k, v in sorted(usage.items()))}")
    if args.update:
        print("Field update  : polar16-8-updated registered mid-run (used if selected)")
    return 0


def cmd_missions(args) -> int:
    """Compare the adaptive link under the three mission modes on one channel."""
    schedule = GENTLE_SCHEDULE if args.scenario == "gentle" else HARSH_SCHEDULE
    channel = DynamicChannel(schedule, burst_prob=args.burst_prob, burst_penalty_db=args.burst_penalty)
    print("=" * 78)
    print("LUC mission comparison (same dynamic channel, adaptive codec)")
    print("=" * 78)
    print(f"Channel schedule (frame, Eb/N0 dB): {schedule}")
    print(f"{'mission':<12} {'BLER':>8} {'goodput':>9} {'q/frame':>9} {'switches':>9}  codes used")
    rows = []
    for mission in ("throughput", "latency", "robust"):
        codec = UniversalCodec(
            mission=mission, target_bler=args.target_bler,
            max_queries=args.max_queries, profile_frames=args.profile_frames,
            cache=not args.no_cache,
        )
        rep = run_link(codec, channel, args.frames, seed=args.seed, adaptive=True,
                       frame_ms=args.frame_ms)
        usage = rep.code_usage()
        rows.append((mission, rep.bler(), rep.goodput(), rep.avg_queries(),
                     len(codec.switches), ", ".join(f"{k}={v}" for k, v in sorted(usage.items()))))
    for mission, bler, gp, q, sw, used in rows:
        print(f"{mission:<12} {bler:>8.4f} {gp:>9.4f} {q:>9.1f} {sw:>9d}  {used}")
    print()
    print("throughput: maximize info bits delivered; latency: reward low-query (low-power)")
    print("codes; robust: minimize error rate first. All subject to the BLER target.")
    return 0


def cmd_plot(args) -> int:
    codec = _make_codec(args)
    snr_points = [float(x) for x in args.snr.split(",")]
    names = codec.by_id if args.all else [args.code]
    curves: dict[str, list] = {}
    for name in names:
        points = []
        for s in snr_points:
            from luc_sim.profiles import predict_bler
            bler, _ = predict_bler(codec.registry[name], s, n_frames=args.frames,
                                   max_queries=args.max_queries, cache=not args.no_cache)
            points.append((s, bler))
        curves[name] = points
    bler_curves_svg(curves, args.out, title=args.title, target_bler=args.target_bler)
    print(f"wrote {args.out} ({len(names)} curves, {len(snr_points)} SNR points)")
    return 0

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="luc-sim",
        description="LUC (Lightweight Universal Codec) simulator + prototype: "
                    "GRAND-based universal codec with adaptive code-class switching.",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--max-queries", type=int, default=4096)
    common.add_argument("--target-bler", type=float, default=0.05)
    common.add_argument("--mission", choices=["throughput", "latency", "robust"], default="throughput")
    common.add_argument("--profile-frames", type=int, default=500)
    common.add_argument("--no-cache", action="store_true", help="do not read/write profile cache")

    sp = sub.add_parser("codes", parents=[common], help="list the code registry")
    sp.set_defaults(fn=cmd_codes)

    sp = sub.add_parser("sweep", parents=[common], help="BLER sweep over Eb/N0")
    sp.add_argument("--code", default=None, help="code name or 'all'")
    sp.add_argument("--snr", default="0,2,4,6,8,10,12")
    sp.add_argument("--frames", type=int, default=800)
    sp.add_argument("--json", default=None)
    sp.set_defaults(fn=cmd_sweep)

    sp = sub.add_parser("metrics", parents=[common], help="LUC Table-1 style metrics report")
    sp.add_argument("--frames", type=int, default=600)
    sp.add_argument("--seed", type=int, default=7)
    sp.add_argument("--mean-snr", type=float, default=6.0,
                    help="static-channel Eb/N0 (dB); used with --static")
    sp.add_argument("--static", action="store_true",
                    help="measure on a static channel instead of the dynamic schedule")
    sp.add_argument("--frame-ms", type=float, default=1.0)
    sp.add_argument("--json", default=None)
    sp.set_defaults(fn=cmd_metrics)

    sp = sub.add_parser("missions", parents=[common],
                        help="compare the adaptive link under all three mission modes")
    sp.add_argument("--frames", type=int, default=500)
    sp.add_argument("--seed", type=int, default=7)
    sp.add_argument("--scenario", choices=["gentle", "harsh"], default="gentle")
    sp.add_argument("--burst-prob", type=float, default=0.03)
    sp.add_argument("--burst-penalty", type=float, default=8.0)
    sp.add_argument("--frame-ms", type=float, default=1.0)
    sp.set_defaults(fn=cmd_missions)

    sp = sub.add_parser("demo", parents=[common], help="run the adaptive streaming demo")
    sp.add_argument("--frames", type=int, default=800)
    sp.add_argument("--seed", type=int, default=7)
    sp.add_argument("--scenario", choices=["gentle", "harsh"], default="gentle")
    sp.add_argument("--burst-prob", type=float, default=0.03)
    sp.add_argument("--burst-penalty", type=float, default=8.0)
    sp.add_argument("--frame-ms", type=float, default=1.0)
    sp.add_argument("--fixed", action="store_true", help="SoTA baseline: fixed code, no adaptation")
    sp.add_argument("--update", action="store_true", help="register a new code mid-run (field update)")
    sp.set_defaults(fn=cmd_demo)

    sp = sub.add_parser("plot", parents=[common], help="render BLER curves as SVG")
    sp.add_argument("--code", default=None)
    sp.add_argument("--all", action="store_true")
    sp.add_argument("--snr", default="0,2,4,6,8,10,12")
    sp.add_argument("--frames", type=int, default=800)
    sp.add_argument("--out", default="bler.svg")
    sp.add_argument("--title", default="BLER vs Eb/N0 (LUC codes)")
    sp.set_defaults(fn=cmd_plot)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
