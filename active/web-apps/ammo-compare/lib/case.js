import {
  CASE_CRITERIA,
  CASE_SCOPES,
  CASES,
} from '../data/cases.js';

export { CASE_CRITERIA, CASE_SCOPES, CASES };

/** True when a load belongs to a comparison scope. */
export function matchesScope(row, scope) {
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

/** The value used for a criterion, with missing data pushed to the worst end. */
function criterionValue(row, criterion) {
  const value = row[criterion.key];
  if (value == null || !Number.isFinite(value)) {
    return criterion.direction > 0 ? -Infinity : Infinity;
  }
  return value;
}

/**
 * Percentile score for every row in a scope (0 = worst, 1 = best).
 *
 * The generator uses the same percentile scale, so a saved weighting keeps the
 * same meaning in the browser. Ties share an average rank.
 */
export function percentileScores(rows, scope) {
  const members = scopeRows(rows, scope);
  const size = members.length;
  const scores = new Map();
  for (const row of members) scores.set(row.id, new Array(CASE_CRITERIA.length).fill(0.5));
  if (size <= 1) return scores;

  for (let column = 0; column < CASE_CRITERIA.length; column += 1) {
    const criterion = CASE_CRITERIA[column];
    const ordered = members
      .map((row, index) => ({ row, index, value: criterionValue(row, criterion) }))
      .sort((a, b) => {
        if (a.value < b.value) return -1;
        if (a.value > b.value) return 1;
        return a.index - b.index;
      });

    let cursor = 0;
    while (cursor < size) {
      let end = cursor;
      while (end + 1 < size && ordered[end + 1].value === ordered[cursor].value) end += 1;
      const averageRank = (cursor + end) / 2 + 1;
      const percentile = (averageRank - 1) / (size - 1);
      const directed = criterion.direction < 0 ? 1 - percentile : percentile;
      for (let tie = cursor; tie <= end; tie += 1) {
        scores.get(ordered[tie].row.id)[column] = directed;
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
  return {
    rank: above.length + 1,
    selected,
    sorted,
    percentiles: scores,
    blockers: above
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.row.name),
  };
}
