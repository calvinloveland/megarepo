import {
  CASE_CRITERIA,
  CASE_SCOPES,
  CASES,
} from '../data/cases.js';
import { matchesJurisdiction } from './legality.js';

export { CASE_CRITERIA, CASE_SCOPES, CASES };

/**
 * The margin a strict win needs, matching `FEASIBLE_EPS` in the generator.
 * A win thinner than this is rounding noise, not an argument.
 */
export const FEASIBLE_EPS = 1e-4;

/**
 * The margin a case needs before it is worth calling one, matching `MIN_WIN` in
 * the generator. Between FEASIBLE_EPS and this, a result is a `thin` win: it
 * reaches first place, but a small change to the data would flip it.
 */
export const MIN_WIN = 5e-3;

/** Category scopes the generator always emits; anything else is a jurisdiction. */
const CATEGORY_SCOPES = ['all', 'centerfire', 'rimfire', 'pistol', 'rifle', 'shotgun'];

/**
 * Scope keys that name a jurisdiction, upper-cased for the legal overlay. The
 * generator emits them from `data/legality.js`, so this list is derived rather
 * than written twice.
 */
const JURISDICTION_SCOPES = new Map(
  Object.keys(CASE_SCOPES)
    .filter((scope) => !CATEGORY_SCOPES.includes(scope))
    .map((scope) => [scope, scope.toUpperCase()]),
);

/** True when a load belongs to a comparison scope. */
export function matchesScope(row, scope) {
  if (JURISDICTION_SCOPES.has(scope)) {
    return matchesJurisdiction(row, JURISDICTION_SCOPES.get(scope));
  }
  switch (scope) {
    case 'all':
      return true;
    case 'centerfire':
      return row.category !== 'rimfire';
    case 'rimfire':
    case 'pistol':
    case 'rifle':
    case 'shotgun':
      return row.category === scope;
    default:
      return false;
  }
}

export function scopeRows(rows, scope) {
  return rows.filter((row) => matchesScope(row, scope));
}

/**
 * Criteria that apply to a scope. Compact case length is deliberately limited
 * to pistols: shorter cartridges enable smaller frames, while overall length in
 * rifles and shotguns is driven by the action and powder column.
 */
export function criteriaForScope(scope) {
  return CASE_CRITERIA.filter(
    (criterion) => !criterion.scopes || criterion.scopes.includes(scope),
  );
}

/** True when the row has no usable value for a criterion. */
function criterionMissing(row, criterion) {
  const value = row[criterion.key];
  return (
    value == null ||
    !Number.isFinite(value) ||
    (criterion.positive === true && value <= 0)
  );
}

/**
 * Percentile score for every row in a scope (0 = worst, 1 = best).
 *
 * The generator uses the same percentile scale, so a saved weighting keeps the
 * same meaning in the browser. Ties share an average rank.
 */
export function percentileScores(rows, scope) {
  const members = scopeRows(rows, scope);
  const criteria = criteriaForScope(scope);
  const size = members.length;
  const scores = new Map();
  // Missing data is the worst end (0), not an observation. Ranking unpriced rows
  // as "most expensive" would make every priced load look cheap.
  for (const row of members) scores.set(row.id, new Array(criteria.length).fill(0));
  if (size === 0) return scores;

  for (let column = 0; column < criteria.length; column += 1) {
    const criterion = criteria[column];
    const present = members
      .map((row, index) => ({ row, index, value: row[criterion.key] }))
      .filter((entry) => !criterionMissing(entry.row, criterion))
      .sort((a, b) => {
        if (a.value < b.value) return -1;
        if (a.value > b.value) return 1;
        return a.index - b.index;
      });

    const count = present.length;
    if (count === 0) continue; // no member has a value: the column says nothing

    let cursor = 0;
    while (cursor < count) {
      let end = cursor;
      while (end + 1 < count && present[end + 1].value === present[cursor].value) end += 1;
      const averageRank = (cursor + end) / 2 + 1;
      const percentile = count === 1 ? 0.5 : (averageRank - 1) / (count - 1);
      const directed = criterion.direction < 0 ? 1 - percentile : percentile;
      for (let tie = cursor; tie <= end; tie += 1) {
        scores.get(present[tie].row.id)[column] = directed;
      }
      cursor = end + 1;
    }
  }
  return scores;
}

export function caseScore(percentiles, weights) {
  let score = 0;
  for (let i = 0; i < weights.length; i += 1) {
    score += percentiles[i] * weights[i];
  }
  return score;
}

export function resultFor(id, scope) {
  const entry = CASES[id];
  if (!entry) return null;
  const result = entry.scopes[scope];
  if (!result) return null;
  return { ...result, scope, id };
}

export function autoCaseFor(id) {
  const entry = CASES[id];
  if (!entry) return null;
  return resultFor(id, entry.auto);
}

export function scopeOptionsFor(id) {
  const entry = CASES[id];
  if (!entry) return [];
  return Object.keys(entry.scopes).map((scope) => ({
    scope,
    label: CASE_SCOPES[scope]?.label ?? scope,
    count: CASE_SCOPES[scope]?.count ?? 0,
  }));
}

/**
 * Rank every row in a scope with a weighting.
 *
 * `rank` counts rows strictly above the selection (ties share a rank); the
 * sorted list is name-tie-broken so the table has a stable order.
 */
export function rankCase(rows, scope, weights, selectedId, percentiles = null) {
  const members = scopeRows(rows, scope);
  const scores = percentiles ?? percentileScores(rows, scope);
  const scored = members.map((row) => ({
    row,
    score: caseScore(scores.get(row.id), weights),
  }));
  const sorted = [...scored].sort((a, b) => {
    if (a.score > b.score) return -1;
    if (a.score < b.score) return 1;
    return a.row.name.localeCompare(b.row.name);
  });
  const selected = scored.find((entry) => entry.row.id === selectedId);
  if (!selected) return null;
  const above = scored.filter(
    (entry) => entry.row.id !== selectedId && entry.score > selected.score + 1e-9,
  );
  // Rows that score exactly the same as the selection. They share its rank, and
  // the panel has to name them: a tie is not a win, and the table must not
  // pretend otherwise by floating the selected row to the top.
  const tied = scored.filter(
    (entry) =>
      entry.row.id !== selectedId && Math.abs(entry.score - selected.score) <= 1e-9,
  );
  const bestOther = scored.reduce(
    (best, entry) =>
      entry.row.id === selectedId ? best : Math.max(best, entry.score),
    Number.NEGATIVE_INFINITY,
  );
  return {
    rank: above.length + 1,
    selected,
    sorted,
    percentiles: scores,
    // How far clear of the next load the selection is. Positive is a win; zero
    // is a tie. Mirrors the generator's notion of a strict win.
    margin: Number.isFinite(bestOther) ? selected.score - bestOther : 0,
    tiedWith: tied.map((entry) => entry.row.name),
    blockers: above
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.row.name),
  };
}

/**
 * The criterion carrying almost all of a weighting, if there is one.
 *
 * The fallback search minimises rank, so its answer is often a vertex of the
 * weight simplex — a single-column sort dressed up as a case. Callers use this
 * to say so instead of implying the weights are an even-handed argument.
 */
export function dominantCriterion(criteria, weights, threshold = 0.9) {
  let best = 0;
  for (let i = 1; i < weights.length; i += 1) {
    if (weights[i] > weights[best]) best = i;
  }
  if (!(weights[best] >= threshold)) return null;
  return { criterion: criteria[best], weight: weights[best] };
}
