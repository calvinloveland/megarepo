"""Cached Monte-Carlo performance profiles: (BLER, avg queries) per code per SNR.

The adaptive policy and the metrics report both need to know, for any code, how it
performs at a given Eb/N0.  Measuring that from scratch every call would be slow, so
results are cached in memory and persisted to a JSON file (``$LUC_SIM_CACHE`` or
``~/.cache/luc-sim/profiles.json``).  An analytic feasibility filter skips
Monte-Carlo entirely for hopeless SNRs.
"""

from __future__ import annotations

import json
import math
import os
import random
from pathlib import Path

from luc_sim.channel import qfunc, transmit_bpsk_awgn
from luc_sim.grand import grand_decode
from luc_sim.linear import LinearCode

_CACHE: dict[str, dict] = {}
_CACHE_FILE: Path | None = None


def cache_path() -> Path:
    global _CACHE_FILE
    if _CACHE_FILE is None:
        base = Path(os.environ.get("LUC_SIM_CACHE", Path.home() / ".cache"))
        _CACHE_FILE = base / "luc-sim" / "profiles.json"
    return _CACHE_FILE


def load_cache() -> dict:
    if not _CACHE:
        p = cache_path()
        if p.exists():
            try:
                _CACHE.update(json.loads(p.read_text()))
            except Exception:
                pass  # corrupt/stale cache: rebuild lazily
    return _CACHE


def save_cache() -> None:
    p = cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        p.write_text(json.dumps(_CACHE))
    except OSError:
        pass


def clear_cache() -> None:
    _CACHE.clear()


def _key(code: LinearCode, ebn0_db: float, n_frames: int, max_queries: int) -> str:
    return f"{code.name}@{ebn0_db:.2f}@{n_frames}@{max_queries}"


def _analytic_hope(code: LinearCode, ebn0_db: float) -> float:
    """Crude union-bound estimate of codeword error probability at this Eb/N0."""
    ber = qfunc(math.sqrt(2.0 * 10 ** (ebn0_db / 10.0)))  # uncoded BPSK, per info bit
    return min(1.0, code.n * ber)


def measure_code(
    code: LinearCode, ebn0_db: float, n_frames: int, max_queries: int, seed: int = 0
) -> tuple[float, float, float]:
    """Monte-Carlo (bler, avg queries/frame, avg queries on OK frames)."""
    rng = random.Random(seed)
    n_ok = 0
    tot_q = 0
    ok_q = 0
    for _ in range(n_frames):
        msg = rng.getrandbits(code.k)
        cw = code.encode(msg)
        _, llrs, _ = transmit_bpsk_awgn(cw, code.n, code.rate, ebn0_db, rng)
        cand, q = grand_decode(llrs, code, max_queries)
        if cand is not None and code.extract(cand) == msg:
            n_ok += 1
            ok_q += q
        tot_q += q
    bler = 1.0 - n_ok / n_frames
    return bler, tot_q / n_frames, (ok_q / n_ok if n_ok else 0.0)


def predict_bler(
    code: LinearCode,
    ebn0_db: float,
    n_frames: int = 500,
    max_queries: int = 4096,
    cache: bool = True,
    seed: int = 0,
) -> tuple[float, float]:
    """Predicted (bler, avg queries per frame) for `code` at `ebn0_db` dB."""
    key = _key(code, ebn0_db, n_frames, max_queries)
    if cache:
        hit = load_cache().get(key)
        if hit is not None:
            return hit["bler"], hit["avg_queries"]
    if _analytic_hope(code, ebn0_db) > 0.95:
        result = (1.0, float(max_queries))
    else:
        bler, avg_q, _ = measure_code(code, ebn0_db, n_frames, max_queries, seed=seed)
        result = (bler, avg_q)
    if cache:
        load_cache()[key] = {"bler": result[0], "avg_queries": result[1], "n_frames": n_frames}
        save_cache()
    return result
