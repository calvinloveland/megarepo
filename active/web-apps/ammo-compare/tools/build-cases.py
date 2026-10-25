#!/usr/bin/env python3
"""Generate the precomputed "make the case" weightings.

For every load and every comparison scope we look for a non-negative weighting
of the eight numeric columns that puts the selected load first. When a strict
win exists, the weights are the maximum-entropy point inside a safety-margin
region, so the case is not just "sort by one column". When it does not, a
deterministic search finds a low-rank "closest found" weighting.

The app is dependency-free; this generator is not run at runtime. Regenerate it
after changing the load data or the criteria:

    nix-shell -p python3Packages.scipy python3Packages.numpy --run \
      "python3 tools/build-cases.py"
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import linprog, minimize

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cases.js"

# Keep this order in sync with CASE_CRITERIA in lib/case.js.
CRITERIA = [
    ("introduced", "Newer design", "Newer", +1),
    ("bulletGr", "Heavier bullet", "Heavier", +1),
    ("velocityFps", "Velocity", "Velocity", +1),
    ("energyFtLb", "Energy", "Energy", +1),
    ("effectiveRangeYd", "Eff. range", "Range", +1),
    ("powerFactor", "Power factor", "Power factor", +1),
    ("recoil", "Low recoil", "Low recoil", -1),
    ("costPerRound", "Low cost", "Low cost", -1),
]

SCOPES = {
    "all": ("All loads", lambda row: True),
    "centerfire": ("Centerfire loads", lambda row: row["category"] != "rimfire"),
    "rimfire": ("Rimfire loads", lambda row: row["category"] == "rimfire"),
    "pistol": ("Pistol loads", lambda row: row["category"] == "pistol"),
    "rifle": ("Rifle loads", lambda row: row["category"] == "rifle"),
    "shotgun": ("Shotgun loads", lambda row: row["category"] == "shotgun"),
}

# A strict win needs a real gap, not a floating-point accident. This is below
# one percentile step for the largest scope (1/294 ≈ 0.0034), so it still lets
# a carefully chosen weighting separate near-ties.
FEASIBLE_EPS = 1e-4
ROUND_DIGITS = 8


def load_rows() -> list[dict]:
    raw = subprocess.check_output(
        ["node", "tools/export-case-rows.mjs"], cwd=ROOT, text=True
    )
    return json.loads(raw)


def percentile_matrix(rows: list[dict], indices: list[int]) -> np.ndarray:
    """Percentile score (0 = worst, 1 = best) for each scope member."""
    m = len(indices)
    out = np.zeros((m, len(CRITERIA)), dtype=float)
    for j, (key, _label, _short, direction) in enumerate(CRITERIA):
        values = []
        for i in indices:
            value = rows[i].get(key)
            if value is None:
                value = -math.inf if direction > 0 else math.inf
            values.append(value)
        order = sorted(range(m), key=lambda p: values[p])
        ranks = [0.0] * m
        p = 0
        while p < m:
            q = p
            while q + 1 < m and values[order[q + 1]] == values[order[p]]:
                q += 1
            # 1-based average rank for ties.
            avg = (p + q) / 2.0 + 1.0
            for t in range(p, q + 1):
                ranks[order[t]] = avg
            p = q + 1
        if m == 1:
            out[:, j] = 0.5
        else:
            values_pct = [(rank - 1.0) / (m - 1.0) for rank in ranks]
            if direction < 0:
                values_pct = [1.0 - v for v in values_pct]
            out[:, j] = values_pct
    return out


def max_margin(
    pct: np.ndarray, selected: int, competitors: list[int]
) -> tuple[float, np.ndarray] | None:
    k = pct.shape[1]
    c = np.zeros(k + 1)
    c[-1] = -1.0
    a_ub = []
    for j in competitors:
        d = pct[selected] - pct[j]
        row = np.zeros(k + 1)
        row[:k] = -d
        row[-1] = 1.0
        a_ub.append(row)
    a_eq = np.zeros((1, k + 1))
    a_eq[0, :k] = 1.0
    result = linprog(
        c,
        A_ub=np.array(a_ub),
        b_ub=np.zeros(len(a_ub)),
        A_eq=a_eq,
        b_eq=np.array([1.0]),
        bounds=[(0.0, None)] * k + [(None, None)],
        method="highs",
    )
    if not result.success:
        return None
    return float(result.x[-1]), np.asarray(result.x[:k], dtype=float)


def max_min_weight(
    pct: np.ndarray, selected: int, competitors: list[int], eps: float
) -> np.ndarray | None:
    """Most even feasible weights in the max-min sense (LP fallback)."""
    k = pct.shape[1]
    c = np.zeros(k + 1)
    c[-1] = -1.0
    a_ub = []
    b_ub = []
    for j in competitors:
        d = pct[selected] - pct[j]
        a_ub.append(np.r_[-d, 0.0])
        b_ub.append(-eps)
    for column in range(k):
        row = np.zeros(k + 1)
        row[column] = -1.0
        row[-1] = 1.0
        a_ub.append(row)
        b_ub.append(0.0)
    a_eq = np.zeros((1, k + 1))
    a_eq[0, :k] = 1.0
    result = linprog(
        c,
        A_ub=np.array(a_ub),
        b_ub=np.array(b_ub),
        A_eq=a_eq,
        b_eq=np.array([1.0]),
        bounds=[(0.0, None)] * k + [(None, None)],
        method="highs",
    )
    if not result.success:
        return None
    return np.asarray(result.x[:k], dtype=float)


def entropy_weights(
    pct: np.ndarray, selected: int, competitors: list[int], start: np.ndarray, eps: float
) -> np.ndarray | None:
    """Maximum-entropy point in the feasible region."""
    k = pct.shape[1]
    constraints = []
    for j in competitors:
        d = pct[selected] - pct[j]
        constraints.append(
            {"type": "ineq", "fun": lambda w, d=d: float(np.dot(d, w) - eps)}
        )
    constraints.append({"type": "eq", "fun": lambda w: float(np.sum(w) - 1.0)})

    def objective(w: np.ndarray) -> float:
        w = np.clip(w, 1e-12, 1.0)
        return float(np.sum(w * np.log(w)))

    result = minimize(
        objective,
        start,
        method="SLSQP",
        bounds=[(0.0, 1.0)] * k,
        constraints=constraints,
        options={"maxiter": 1200, "ftol": 1e-12},
    )
    if not result.success:
        return None
    weights = np.clip(np.asarray(result.x, dtype=float), 0.0, 1.0)
    total = float(weights.sum())
    if total <= 0.0:
        return None
    return weights / total


def normalized(weights: np.ndarray) -> list[float]:
    weights = np.clip(np.asarray(weights, dtype=float), 0.0, 1.0)
    total = float(weights.sum())
    if total <= 0.0:
        return [1.0 / len(weights)] * len(weights)
    weights = weights / total
    return [round(float(w), ROUND_DIGITS) for w in weights]


def scores(pct: np.ndarray, weights: list[float]) -> np.ndarray:
    return pct @ np.asarray(weights, dtype=float)


def rank_of(pct: np.ndarray, selected: int, competitors: list[int], weights: list[float]) -> int:
    s = scores(pct, weights)
    above = sum(1 for j in competitors if s[j] > s[selected] + 1e-9)
    return above + 1


def margin_of(
    pct: np.ndarray, selected: int, competitors: list[int], weights: list[float]
) -> float:
    d = pct[selected] - pct[competitors]
    return float(np.min(d @ np.asarray(weights, dtype=float))) if competitors else 0.0


def best_effort_weights(
    pct: np.ndarray,
    selected: int,
    competitors: list[int],
    base: np.ndarray,
    seed: int,
) -> np.ndarray:
    """Find a low-rank weighting when no weighting can put the load first.

    Rank is a step function, so this cannot be solved with one linear program.
    A deterministic Dirichlet search over the weight simplex gets much closer
    than the max-margin corner, then a local perturbation pass refines it.
    The UI calls the result "closest found", not an exact optimum.
    """
    rng = np.random.default_rng(seed)
    k = pct.shape[1]
    batches = [base.reshape(1, -1), np.eye(k)]
    for alpha, count in ((1.0, 8000), (0.5, 4000), (2.0, 4000)):
        batches.append(rng.dirichlet(np.full(k, alpha), size=count))
    weights = np.vstack(batches)

    competitor_pct = pct[competitors]
    selected_pct = pct[selected]

    def evaluate(candidates: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        scores = candidates @ competitor_pct.T
        selected_scores = candidates @ selected_pct
        above = (scores > selected_scores[:, None] + 1e-9).sum(axis=1)
        best_other = scores.max(axis=1)
        return above + 1, selected_scores - best_other

    ranks, margins = evaluate(weights)
    order = np.lexsort((-margins, ranks))
    centers = weights[order[:3]]
    extra = [weights]
    for center in centers:
        noise = rng.normal(0.0, 0.06, size=(3000, k))
        batch = np.clip(center + noise, 1e-6, None)
        batch /= batch.sum(axis=1, keepdims=True)
        extra.append(batch)
    weights = np.vstack(extra)
    ranks, margins = evaluate(weights)
    order = np.lexsort((-margins, ranks))
    return weights[order[0]]


def build_scope(rows: list[dict], scope: str, predicate) -> dict[int, dict]:
    indices = [i for i, row in enumerate(rows) if predicate(row)]
    pct = percentile_matrix(rows, indices)
    results: dict[int, dict] = {}
    total = len(indices)
    for p, selected in enumerate(indices):
        competitors = [q for q in range(total) if q != p]
        best = max_margin(pct, p, competitors)
        if best is None:
            continue
        margin, weights = best
        feasible = margin >= FEASIBLE_EPS
        chosen = weights
        if feasible:
            # Keep a real safety margin instead of settling for the thinnest
            # numerical win: aim for half the maximum margin, capped at one
            # percentile point, then maximize entropy inside that region.
            entropy_eps = max(FEASIBLE_EPS, min(0.01, margin * 0.5))
            start = weights + 1.0 / (len(weights) * 1000.0)
            start = start / start.sum()
            entropy = entropy_weights(pct, p, competitors, start, entropy_eps)
            if entropy is None:
                entropy = entropy_weights(pct, p, competitors, start, FEASIBLE_EPS)
            if entropy is not None:
                chosen = entropy
            else:
                fallback = max_min_weight(pct, p, competitors, entropy_eps)
                if fallback is not None:
                    chosen = fallback
        else:
            chosen = best_effort_weights(
                pct,
                p,
                competitors,
                weights,
                seed=100003 * (list(SCOPES).index(scope) + 1) + selected,
            )
        rounded = normalized(chosen)
        rounded_margin = margin_of(pct, p, competitors, rounded)
        rounded_rank = rank_of(pct, p, competitors, rounded)
        if feasible and rounded_margin < FEASIBLE_EPS / 2.0:
            # Rounding occasionally shaves a very thin win; fall back to the
            # max-margin point, which is the safest strict separator.
            rounded = normalized(weights)
            rounded_margin = margin_of(pct, p, competitors, rounded)
            rounded_rank = rank_of(pct, p, competitors, rounded)
        results[selected] = {
            "weights": rounded,
            "margin": round(rounded_margin, ROUND_DIGITS),
            "rank": rounded_rank,
            "feasible": bool(feasible and rounded_rank == 1),
        }
    return results


def main() -> None:
    rows = load_rows()
    scope_meta = {}
    scope_results = {}
    for scope, (label, predicate) in SCOPES.items():
        indices = [i for i, row in enumerate(rows) if predicate(row)]
        scope_meta[scope] = {"label": label, "count": len(indices)}
        print(f"building {scope}: {len(indices)} rows", file=sys.stderr)
        scope_results[scope] = build_scope(rows, scope, predicate)

    cases = {}
    for i, row in enumerate(rows):
        ignition = "rimfire" if row["category"] == "rimfire" else "centerfire"
        order = ["all", ignition, row["category"]]
        available = []
        for scope in order:
            if scope not in available and i in scope_results.get(scope, {}):
                available.append(scope)
        feasible = [scope for scope in available if scope_results[scope][i]["feasible"]]
        if feasible:
            auto = feasible[0]
        elif available:
            auto = min(
                available,
                key=lambda scope: (
                    scope_results[scope][i]["rank"],
                    scope_meta[scope]["count"],
                    available.index(scope),
                ),
            )
        else:
            auto = "all"
        cases[row["id"]] = {
            "auto": auto,
            "scopes": {
                scope: scope_results[scope][i] for scope in available if i in scope_results[scope]
            },
        }

    payload = {
        "criteria": [
            {"key": key, "label": label, "short": short, "direction": direction}
            for key, label, short, direction in CRITERIA
        ],
        "scopes": scope_meta,
        "cases": cases,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// Generated by tools/build-cases.py. Do not edit by hand.\n"
        "// Regenerate with: nix-shell -p python3Packages.scipy python3Packages.numpy "
        '--run "python3 tools/build-cases.py"\n'
        f"export const CASE_CRITERIA = {json.dumps(payload['criteria'], separators=(',', ':'))};\n"
        f"export const CASE_SCOPES = {json.dumps(payload['scopes'], separators=(',', ':'))};\n"
        f"export const CASES = {json.dumps(payload['cases'], separators=(',', ':'))};\n"
    )
    feasible = sum(
        1
        for case in cases.values()
        if case["scopes"].get(case["auto"], {}).get("feasible")
    )
    print(f"wrote {OUT} — {feasible}/{len(rows)} loads have a strict case", file=sys.stderr)


if __name__ == "__main__":
    main()
