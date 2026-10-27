#!/usr/bin/env python3
"""Generate the precomputed "make the case" weightings.

For every load and every comparison scope we look for a non-negative weighting
of the numeric columns that puts the selected load first. Seven criteria are
shared by every scope; pistol comparisons add compact case length because
cartridge size is what makes small pistols possible. When a strict win exists,
the weights are the maximum-entropy point inside a safety-margin region, so the
case is not just "sort by one column". When it does not, a deterministic search
finds a low-rank "closest found" weighting.

The app is dependency-free; this generator is not run at runtime. Regenerate it
after changing the load data or the criteria:

    nix-shell -p python3Packages.scipy python3Packages.numpy --run \
      "python3 tools/build-cases.py"

A full solve takes about half an hour. Two flags make the loop shorter:

    --scope pistol   re-solve one comparison set and merge it into the file (~35 s)
    --check          exit 1 if the checked-in file no longer matches a fresh solve
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import linprog, minimize

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cases.js"

# Keep this order in sync with CASE_CRITERIA in lib/case.js. The optional fifth
# item restricts a criterion to named scopes; the optional sixth marks a
# measurement where zero means "unknown" rather than the best possible value.
#
# Power factor is deliberately NOT a criterion. Recoil energy is momentum squared
# over twice the gun mass, so within a class — where the reference mass is fixed —
# the two are the same measurement in different units, and weighting both creates
# a null direction that scores every load identically. Power factor stays a
# displayed column (it is the shooting-sports convention); recoil carries the
# argument because it is what the shooter actually feels.
CRITERIA = [
    ("introduced", "Newer design", "Newer", +1),
    ("bulletGr", "Heavier bullet", "Heavier", +1),
    ("velocityFps", "Velocity", "Velocity", +1),
    ("energyFtLb", "Energy", "Energy", +1),
    ("effectiveRangeYd", "Eff. range", "Range", +1),
    ("recoilFtLb", "Low recoil", "Low recoil", -1),
    ("costPerRound", "Low cost", "Low cost", -1),
    ("caseLengthMm", "Compact case", "Compact case", -1, ("pistol",), True),
]

BASE_SCOPES = {
    "all": ("All loads", lambda row: True),
    "centerfire": ("Centerfire loads", lambda row: row["category"] != "rimfire"),
    "rimfire": ("Rimfire loads", lambda row: row["category"] == "rimfire"),
    "pistol": ("Pistol loads", lambda row: row["category"] == "pistol"),
    "rifle": ("Rifle loads", lambda row: row["category"] == "rifle"),
    "shotgun": ("Shotgun loads", lambda row: row["category"] == "shotgun"),
}

# Base scopes first, jurisdiction scopes appended, so the base scopes keep the
# same seed and a --scope rebuild of one of them reproduces the checked-in bytes.
SCOPES = dict(BASE_SCOPES)


def configure_scopes(jurisdictions: list[dict]) -> None:
    """Add one comparison set per jurisdiction the legal overlay covers.

    The predicate reads `restrictedIn` from the exported rows, so the sets come
    from `data/legality.js` rather than a second copy of the rules here.
    """
    global SCOPES
    SCOPES = dict(BASE_SCOPES)
    for jurisdiction in jurisdictions:
        code = jurisdiction["code"]
        SCOPES[code.lower()] = (
            f"Loads legal in {jurisdiction['label']}",
            lambda row, code=code: code not in row["restrictedIn"],
        )


def scopes_for(criterion: tuple) -> tuple[str, ...] | None:
    return criterion[4] if len(criterion) > 4 else None


def criteria_for_scope(scope: str) -> list[tuple]:
    return [
        criterion
        for criterion in CRITERIA
        if scopes_for(criterion) is None or scope in (scopes_for(criterion) or ())
    ]


def is_missing(value, criterion: tuple) -> bool:
    if value is None or not math.isfinite(value):
        return True
    return bool(len(criterion) > 5 and criterion[5] and value <= 0)

# A strict win needs a real gap, not a floating-point accident. This is below
# one percentile step for the largest scope (1/294 ≈ 0.0034), so it still lets
# a carefully chosen weighting separate near-ties.
FEASIBLE_EPS = 1e-4
# ...but a win of 0.01 percentile points is not an argument anybody would repeat.
# A case has to clear this to be reported as one; a thinner rank-one result is
# recorded as `thin` and shown as "wins, but not by enough to call it a case".
MIN_WIN = 5e-3
# The entropy step leaves residue on columns the optimum does not need — a tenth
# of a percent here and there. That is not part of the argument, and the panel
# promises every listed column is load-bearing, so anything below this is
# dropped and the rest renormalised.
SLIVER = 5e-3
ROUND_DIGITS = 8
# A weighting whose scores barely differ across the comparison set is not an
# argument. This is far above float noise, so it only rejects degenerate
# directions (two criteria that measure the same thing) and their near-nulls.
MIN_SPREAD = 1e-3


def load_rows() -> tuple[list[dict], list[dict]]:
    raw = subprocess.check_output(
        ["node", "tools/export-case-rows.mjs"], cwd=ROOT, text=True
    )
    payload = json.loads(raw)
    return payload["rows"], payload["jurisdictions"]


def percentile_matrix(
    rows: list[dict], indices: list[int], criteria: list[tuple]
) -> np.ndarray:
    """Percentile score (0 = worst, 1 = best) for each scope member.

    Ranks are computed among the members that *have* a value. A load with no
    price, no introduction year, or no case length sits at the worst end (0)
    instead of being ranked as if it were an observation. That distinction
    matters: ranking unpriced rows as "most expensive" made every priced load
    look cheap, so `.380 ACP` scored the 94th cost percentile while actually
    costing more than the 9mm it competes with — 42 of the 64 pistol rows have
    no price at all.
    """
    m = len(indices)
    out = np.zeros((m, len(criteria)), dtype=float)
    for j, criterion in enumerate(criteria):
        key, _label, _short, direction = criterion[:4]
        present = [
            p for p in range(m) if not is_missing(rows[indices[p]].get(key), criterion)
        ]
        n = len(present)
        if n == 0:
            continue  # every member is missing: the column carries no information
        order = sorted(present, key=lambda p: rows[indices[p]][key])
        p = 0
        while p < n:
            q = p
            while (
                q + 1 < n
                and rows[indices[order[q + 1]]][key] == rows[indices[order[p]]][key]
            ):
                q += 1
            # 1-based average rank for ties, over the values that exist.
            average_rank = (p + q) / 2.0 + 1.0
            percentile = 0.5 if n == 1 else (average_rank - 1.0) / (n - 1.0)
            directed = 1.0 - percentile if direction < 0 else percentile
            for t in range(p, q + 1):
                out[order[t], j] = directed
            p = q + 1
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

    def evaluate(candidates: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        scores = candidates @ competitor_pct.T
        selected_scores = candidates @ selected_pct
        above = (scores > selected_scores[:, None] + 1e-9).sum(axis=1)
        best_other = scores.max(axis=1)
        spread = np.maximum(scores.max(axis=1), selected_scores) - np.minimum(
            scores.min(axis=1), selected_scores
        )
        return above + 1, selected_scores - best_other, spread

    ranks, margins, spreads = evaluate(weights)
    informative = spreads >= MIN_SPREAD
    if informative.any():
        ranks, margins, weights = ranks[informative], margins[informative], weights[informative]
    order = np.lexsort((-margins, ranks))
    centers = weights[order[:3]]
    extra = [weights]
    for center in centers:
        noise = rng.normal(0.0, 0.06, size=(3000, k))
        batch = np.clip(center + noise, 1e-6, None)
        batch /= batch.sum(axis=1, keepdims=True)
        extra.append(batch)
    weights = np.vstack(extra)
    ranks, margins, spreads = evaluate(weights)
    informative = spreads >= MIN_SPREAD
    if informative.any():
        ranks, margins, weights = ranks[informative], margins[informative], weights[informative]
    order = np.lexsort((-margins, ranks))
    return weights[order[0]]


MAX_FACTORS = 8


def max_margin_subset(
    pct: np.ndarray, selected: int, competitors: list[int], subset: tuple[int, ...]
) -> tuple[float, np.ndarray] | None:
    """Max-margin LP restricted to a subset of criteria, expanded back to full width."""
    sub = pct[:, subset]
    k = sub.shape[1]
    c = np.zeros(k + 1)
    c[-1] = -1.0
    a_ub = []
    for j in competitors:
        d = sub[selected] - sub[j]
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
    weights = np.zeros(pct.shape[1])
    weights[list(subset)] = result.x[:k]
    return float(result.x[-1]), weights


def sparsest_case(
    pct: np.ndarray, selected: int, competitors: list[int]
) -> tuple[tuple[int, ...], float, np.ndarray] | None:
    """Fewest criteria that can put the load strictly first.

    The strongest case is the one that needs the fewest assumptions: "it is the
    cheapest" is a better argument than "it is cheapest, softest and lightest".
    Tries every subset of size 1, then 2, and so on, stopping at the first size
    that yields a strict win; within that size it keeps the widest margin.
    """
    width = pct.shape[1]
    for size in range(1, min(MAX_FACTORS, width) + 1):
        best: tuple[tuple[int, ...], float, np.ndarray] | None = None
        for subset in itertools.combinations(range(width), size):
            found = max_margin_subset(pct, selected, competitors, subset)
            if found is None:
                continue
            margin, weights = found
            if margin < MIN_WIN:
                continue
            if best is None or margin > best[1]:
                best = (subset, margin, weights)
        if best is not None:
            return best
    return None


def strip_slivers(weights: np.ndarray) -> np.ndarray:
    """Drop rounding residue so a factor count means "columns that matter"."""
    kept = np.where(np.asarray(weights, dtype=float) >= SLIVER, weights, 0.0)
    total = float(kept.sum())
    if total <= 0.0:
        return np.asarray(weights, dtype=float)
    return kept / total


def greedy_sparsify(
    pct: np.ndarray,
    selected: int,
    competitors: list[int],
    weights: np.ndarray,
    min_margin: float | None = None,
) -> np.ndarray:
    """Drop factors the result does not need.

    The subset search can miss a smaller winning set when an LP fails on a
    degenerate face, so this pass is the guarantee the panel relies on: with
    `min_margin`, a column may only go if the result still *wins* by that much
    (the feasible branch); without it, the closest case only has to keep its rank.
    """
    best = np.asarray(weights, dtype=float).copy()
    best_rank = rank_of(pct, selected, competitors, normalized(best))
    for index in np.argsort(best):
        if best[index] <= 0.0:
            continue
        trial = best.copy()
        trial[index] = 0.0
        total = float(trial.sum())
        if total <= 0.0:
            continue
        trial /= total
        rounded = normalized(trial)
        if min_margin is None:
            if rank_of(pct, selected, competitors, rounded) <= best_rank:
                best = trial
            continue
        if (
            rank_of(pct, selected, competitors, rounded) == 1
            and margin_of(pct, selected, competitors, rounded) >= min_margin
        ):
            best = trial
    return best


def build_scope(rows: list[dict], scope: str, predicate) -> dict[str, dict]:
    indices = [i for i, row in enumerate(rows) if predicate(row)]
    pct = percentile_matrix(rows, indices, criteria_for_scope(scope))
    results: dict[str, dict] = {}
    total = len(indices)
    for p, selected in enumerate(indices):
        competitors = [q for q in range(total) if q != p]
        best = max_margin(pct, p, competitors)
        if best is None:
            continue
        margin, weights = best
        feasible = margin >= MIN_WIN
        chosen = weights
        if feasible:
            # Fewest factors first: the smallest set of columns that can still
            # put this load strictly first, then as even a split as possible
            # inside that set.
            sparse = sparsest_case(pct, p, competitors)
            if sparse is not None:
                subset, subset_margin, subset_weights = sparse
                chosen = subset_weights
                if len(subset) > 1:
                    entropy_eps = max(MIN_WIN, min(0.01, subset_margin * 0.5))
                    start = np.array([subset_weights[i] for i in subset], dtype=float)
                    start = start / start.sum() + 1e-6
                    start = start / start.sum()
                    even = entropy_weights(
                        pct[:, subset], p, competitors, start, entropy_eps
                    )
                    if even is None:
                        even = entropy_weights(
                            pct[:, subset], p, competitors, start, FEASIBLE_EPS
                        )
                    if even is not None:
                        chosen = np.zeros(pct.shape[1])
                        chosen[list(subset)] = even
            else:
                # No subset up to MAX_FACTORS wins; use the full simplex.
                entropy_eps = max(MIN_WIN, min(0.01, margin * 0.5))
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
            chosen = greedy_sparsify(pct, p, competitors, chosen)
        rounded = normalized(chosen)
        rounded_margin = margin_of(pct, p, competitors, rounded)
        rounded_rank = rank_of(pct, p, competitors, rounded)
        if feasible and rounded_margin < MIN_WIN:
            # Rounding occasionally shaves a thin win; fall back to the
            # max-margin point, which is the safest separator.
            rounded = normalized(weights)
            rounded_margin = margin_of(pct, p, competitors, rounded)
            rounded_rank = rank_of(pct, p, competitors, rounded)
        # Residue on columns the optimum does not need would be counted as a
        # factor the panel cannot defend, so drop it and re-verify.
        stripped = normalized(strip_slivers(np.asarray(rounded, dtype=float)))
        if stripped != rounded:
            stripped_margin = margin_of(pct, p, competitors, stripped)
            stripped_rank = rank_of(pct, p, competitors, stripped)
            if stripped_rank <= rounded_rank and (
                not feasible or stripped_margin >= MIN_WIN
            ):
                rounded, rounded_margin, rounded_rank = stripped, stripped_margin, stripped_rank
        # Then drop any column the win does not actually need. The subset search
        # can miss one when an LP fails on a degenerate face, and a factor the
        # panel cannot defend is worse than one column too many.
        if feasible:
            trimmed = normalized(
                greedy_sparsify(pct, p, competitors, np.asarray(rounded, dtype=float), MIN_WIN)
            )
            if trimmed != rounded:
                trimmed_margin = margin_of(pct, p, competitors, trimmed)
                trimmed_rank = rank_of(pct, p, competitors, trimmed)
                if trimmed_rank == 1 and trimmed_margin >= MIN_WIN:
                    rounded, rounded_margin, rounded_rank = trimmed, trimmed_margin, trimmed_rank
        wins = rounded_rank == 1 and rounded_margin >= MIN_WIN
        results[rows[selected]["id"]] = {
            "weights": rounded,
            "margin": round(rounded_margin, ROUND_DIGITS),
            "rank": rounded_rank,
            "factors": sum(1 for weight in rounded if weight > 0.0),
            # First place, but by less than a case is worth making.
            "thin": bool(rounded_rank == 1 and not wins and rounded_margin > FEASIBLE_EPS),
            "feasible": wins,
        }
    return results


def auto_scope(
    row: dict,
    available: list[str],
    results: dict[str, dict[str, dict]],
    counts: dict[str, int],
) -> str:
    """Broadest set the load can win, else the closest one.

    All loads first, then centre/rimfire, then the load's own category. A tie
    between closest sets goes to the narrower set, which is usually the more
    useful comparison.
    """
    rid = row["id"]
    feasible = [scope for scope in available if results[rid][scope]["feasible"]]
    if feasible:
        return feasible[0]
    return min(
        available,
        key=lambda scope: (
            results[rid][scope]["rank"],
            counts[scope],
            available.index(scope),
        ),
    )


def candidate_scopes(row: dict) -> list[str]:
    ignition = "rimfire" if row["category"] == "rimfire" else "centerfire"
    order = ["all", ignition, row["category"]]
    seen: list[str] = []
    for scope in order:
        if scope not in seen:
            seen.append(scope)
    return seen


def assemble(
    rows: list[dict], results: dict[str, dict[str, dict]], counts: dict[str, int]
) -> dict:
    """Build the payload in a deterministic order from per-scope results.

    A load's scope list is the base sets it belongs to (all, ignition, category)
    followed by every jurisdiction set it appears in, in the order the generator
    declares them. `auto` only ever considers the base sets: a jurisdiction is a
    filter the reader applies, not a breadth level.
    """
    jurisdiction_scopes = [scope for scope in SCOPES if scope not in BASE_SCOPES]
    cases = {}
    for row in rows:
        rid = row["id"]
        order = candidate_scopes(row) + jurisdiction_scopes
        available = [
            scope
            for index, scope in enumerate(order)
            if scope not in order[:index] and rid in results and scope in results[rid]
        ]
        if not available:
            continue
        base = [scope for scope in available if scope in BASE_SCOPES]
        cases[rid] = {
            "auto": auto_scope(row, base, results, counts),
            "scopes": {scope: results[rid][scope] for scope in available},
        }
    return cases


def serialize(payload: dict) -> str:
    return (
        "// Generated by tools/build-cases.py. Do not edit by hand.\n"
        "// Regenerate with: nix-shell -p python3Packages.scipy python3Packages.numpy "
        '--run "python3 tools/build-cases.py"\n'
        f"export const CASE_CRITERIA = {json.dumps(payload['criteria'], separators=(',', ':'))};\n"
        f"export const CASE_SCOPES = {json.dumps(payload['scopes'], separators=(',', ':'))};\n"
        f"export const CASES = {json.dumps(payload['cases'], separators=(',', ':'))};\n"
    )


def criteria_payload() -> list[dict]:
    payload = []
    for criterion in CRITERIA:
        key, label, short, direction = criterion[:4]
        item = {"key": key, "label": label, "short": short, "direction": direction}
        scopes = scopes_for(criterion)
        if scopes is not None:
            item["scopes"] = list(scopes)
        if len(criterion) > 5 and criterion[5]:
            item["positive"] = True
        payload.append(item)
    return payload


def read_payload() -> dict | None:
    """Parse the checked-in file so a single scope can be rebuilt in place."""
    if not OUT.exists():
        return None
    text = OUT.read_text()
    found = {}
    for name in ("CASE_CRITERIA", "CASE_SCOPES", "CASES"):
        match = re.search(rf"^export const {name} = (.*);$", text, re.MULTILINE)
        if match is None:
            return None
        found[name] = json.loads(match.group(1))
    return {"criteria": found["CASE_CRITERIA"], "scopes": found["CASE_SCOPES"], "cases": found["CASES"]}


def build(rows: list[dict], only: str | None, previous: dict | None) -> dict:
    """Solve the requested scopes and merge them with what is already checked in."""
    scope_meta: dict[str, dict] = {}
    if only and previous:
        scope_meta = dict(previous["scopes"])

    # Existing per-scope results, minus any scope being rebuilt.
    merged: dict[str, dict[str, dict]] = {}
    if previous:
        for rid, entry in previous["cases"].items():
            kept = {scope: result for scope, result in entry["scopes"].items() if scope != only}
            if kept:
                merged[rid] = kept

    for scope, (label, predicate) in SCOPES.items():
        if only and scope != only:
            continue
        indices = [i for i, row in enumerate(rows) if predicate(row)]
        scope_meta[scope] = {"label": label, "count": len(indices)}
        print(f"building {scope}: {len(indices)} rows", file=sys.stderr)
        results = build_scope(rows, scope, predicate)
        for rid, result in results.items():
            merged.setdefault(rid, {})[scope] = result

    counts = {scope: meta["count"] for scope, meta in scope_meta.items()}
    return {
        "criteria": criteria_payload(),
        "scopes": scope_meta,
        "cases": assemble(rows, merged, counts),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--scope",
        choices=list(SCOPES),
        help="rebuild one comparison set and merge it into the checked-in file",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit 1 if the checked-in file differs from a fresh solve",
    )
    return parser.parse_args()


def main() -> None:
    # The scope list has to exist before argparse validates --scope, and it comes
    # from the legal overlay via the exported rows.
    rows, jurisdictions = load_rows()
    configure_scopes(jurisdictions)
    args = parse_args()
    previous = read_payload()
    if args.scope and previous is None:
        sys.exit(f"--scope needs an existing {OUT.name} to merge into")

    payload = build(rows, args.scope, previous)
    text = serialize(payload)

    if args.check:
        if previous is None:
            sys.exit(f"no checked-in {OUT.name} to compare against")
        current = OUT.read_text()
        if text != current:
            print(f"{OUT.name} is stale — regenerate it", file=sys.stderr)
            stale = [
                rid
                for rid, case in payload["cases"].items()
                if previous["cases"].get(rid) != case
            ]
            print(
                f"  {len(stale)} load(s) differ: {', '.join(stale[:8])}"
                f"{' …' if len(stale) > 8 else ''}",
                file=sys.stderr,
            )
            sys.exit(1)
        print(f"{OUT.name} is up to date", file=sys.stderr)
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    feasible = sum(
        1
        for case in payload["cases"].values()
        if case["scopes"].get(case["auto"], {}).get("feasible")
    )
    scope_note = f" ({args.scope} only)" if args.scope else ""
    print(
        f"wrote {OUT}{scope_note} — {feasible}/{len(rows)} loads have a strict case",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
