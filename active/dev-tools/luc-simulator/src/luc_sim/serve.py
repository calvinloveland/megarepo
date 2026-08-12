"""LUC Link Explorer: a small self-contained web UI for the simulator.

``luc-sim serve`` runs a stdlib ``http.server`` that serves a static page
(``web/index.html``) and a JSON API backed by the simulator:

* ``GET /api/codes``           -- code registry audit
* ``GET /api/sim``             -- run the adaptive (or fixed) link and return the
                                  full per-frame timeline + aggregates
* ``GET /api/curves``          -- BLER sweep per code across an SNR grid

Profiles are measured on demand and cached (``profiles.py``), so first requests
are slower and repeats are instant.
"""

from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from luc_sim.channel import DynamicChannel
from luc_sim.codec import UniversalCodec
from luc_sim.profiles import predict_bler
from luc_sim.sim import run_link

WEB_DIR = Path(__file__).parent / "web"

_GENTLE = [(0, 12.0), (150, 4.0), (300, 9.0), (450, 1.5), (600, 10.0)]
_HARSH = [(0, 8.0), (120, 2.0), (240, 6.0), (360, 0.5), (480, 9.0), (600, 3.0)]


def _codec(args: dict) -> UniversalCodec:
    return UniversalCodec(
        mission=args.get("mission", "throughput"),
        target_bler=float(args.get("target_bler", 0.05)),
        max_queries=int(args.get("max_queries", 4096)),
        profile_frames=int(args.get("profile_frames", 300)),
        cache=True,
    )


def api_codes(args: dict) -> dict:
    codec = _codec(args)
    return {
        "codes": [
            {
                "name": c.name, "family": c.family, "n": c.n, "k": c.k,
                "rate": round(c.rate, 4), "d": c.d,
            }
            for c in codec.registry.values()
        ],
        "families": sorted(codec.family_counts),
        "header_len": codec.header_len,
        "frame_bits": codec.payload_bits + codec.header_len,
    }


def api_sim(args: dict) -> dict:
    frames = int(args.get("frames", 600))
    seed = int(args.get("seed", 7))
    scenario = args.get("scenario", "gentle")
    mission = args.get("mission", "throughput")
    adaptive = args.get("adaptive", "1") != "0"
    codec = _codec(args)
    schedule = _GENTLE if scenario == "gentle" else _HARSH
    channel = DynamicChannel(schedule, burst_prob=0.03, burst_penalty_db=8.0)

    if adaptive:
        report = run_link(codec, channel, frames, seed=seed, adaptive=True)
        switches = [
            {"t": s.t, "old": s.old, "new": s.new,
             "est_snr_db": round(s.est_snr_db, 2)}
            for s in codec.switches
        ]
    else:
        from luc_sim.sim import best_fixed_code

        fixed = best_fixed_code(codec, channel.mean_snr_db(frames))
        report = run_link(codec, channel, frames, seed=seed, adaptive=False,
                          fixed_code=fixed)
        switches = []

    from luc_sim.sim import switch_latencies_ms

    lat = switch_latencies_ms(report, channel, report.frame_ms)
    records = [
        {
            "t": r.t, "true_snr_db": round(r.true_snr_db, 2),
            "est_snr_db": round(r.est_snr_db, 2),
            "code_name": r.code_name, "family": r.family,
            "queries": r.queries, "ok": r.ok, "outage": r.outage,
            "info_bits": r.info_bits,
        }
        for r in report.records
    ]
    return {
        "meta": {
            "frames": frames, "seed": seed, "scenario": scenario, "mission": mission,
            "adaptive": adaptive,
            "schedule": [list(s) for s in schedule],
            "frame_ms": report.frame_ms,
        },
        "stats": {
            "bler": round(report.bler(), 5),
            "outage": round(report.outage_rate(), 5),
            "goodput": round(report.goodput(), 5),
            "avg_queries": round(report.avg_queries(), 1),
            "queries_per_info_bit": round(report.queries_per_info_bit(), 2),
            "switches": len(switches),
            "switch_latency_ms": {
                "median": round(sorted(lat)[len(lat) // 2], 1) if lat else None,
                "max": round(max(lat), 1) if lat else None,
            },
            "usage": report.code_usage(),
        },
        "switches": switches,
        "records": records,
    }


def api_curves(args: dict) -> dict:
    codec = _codec(args)
    snr_points = [float(x) for x in args.get("snr", "0,2,4,6,8,10,12").split(",")]
    n_frames = int(args.get("frames", 300))
    curves: dict[str, dict] = {}
    for name in codec.by_id:
        c = codec.registry[name]
        pts = []
        for s in snr_points:
            bler, _ = predict_bler(c, s, n_frames=n_frames,
                                   max_queries=codec.max_queries, cache=True)
            pts.append([s, round(bler, 6)])
        curves[name] = {"family": c.family, "points": pts}
    return {"snr_points": snr_points, "target_bler": codec.target_bler, "curves": curves}


class Handler(BaseHTTPRequestHandler):
    server_version = "LUCExplorer/0.1"

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        args = {k: v[0] for k, v in query.items()}
        try:
            if path in ("/", "/index.html"):
                self._send_file(WEB_DIR / "index.html", "text/html")
            elif path == "/api/codes":
                self._send_json(api_codes(args))
            elif path == "/api/sim":
                self._send_json(api_sim(args))
            elif path == "/api/curves":
                self._send_json(api_curves(args))
            else:
                candidate = (WEB_DIR / path.lstrip("/")).resolve()
                if candidate.is_relative_to(WEB_DIR) and candidate.is_file():
                    self._send_file(candidate, "text/javascript" if candidate.suffix == ".js" else "text/plain")
                else:
                    self._send_json({"error": "not found"}, status=404)
        except Exception as exc:  # keep the page alive on sim errors
            self._send_json({"error": str(exc)}, status=500)

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *fmt_args) -> None:  # quiet by default
        print("[luc-sim serve] " + (fmt % fmt_args))


def serve(port: int = 8080, frames: int = 600, seed: int = 7,
          mission: str = "throughput", scenario: str = "gentle",
          no_browser: bool = False, open_browser: bool = False) -> None:
    """Run the HTTP server until interrupted. Default params are warm-up defaults."""
    defaults = {
        "frames": frames, "seed": seed, "mission": mission, "scenario": scenario,
    }
    # warm the profile cache with the requested defaults so the first page load
    # is not dominated by Monte-Carlo measurement
    def warm() -> None:
        try:
            api_sim({**defaults, "profile_frames": "150", "frames": str(min(frames, 200))})
            api_curves({"snr": "2,4,6,8,10,12", "frames": "150", "profile_frames": "150"})
            print("[luc-sim serve] profile cache warmed")
        except Exception as exc:  # warming is best-effort
            print(f"[luc-sim serve] warm-up incomplete: {exc}")

    threading.Thread(target=warm, daemon=True).start()

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print("LUC Link Explorer")
    print(f"  serving : {url}")
    print(f"  default : frames={frames} seed={seed} mission={mission} scenario={scenario}")
    print("  press Ctrl-C to stop")
    if open_browser and not no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="luc-sim serve", description="LUC Link Explorer web UI")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--frames", type=int, default=600)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--mission", choices=["throughput", "latency", "robust"], default="throughput")
    p.add_argument("--scenario", choices=["gentle", "harsh"], default="gentle")
    p.add_argument("--no-browser", action="store_true", help="do not try to open a browser")
    args = p.parse_args(argv)
    serve(port=args.port, frames=args.frames, seed=args.seed,
          mission=args.mission, scenario=args.scenario,
          no_browser=args.no_browser, open_browser=True)
    return 0
