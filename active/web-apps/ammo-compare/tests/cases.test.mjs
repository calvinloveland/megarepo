import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { derive } from '../lib/ballistics.js';
import { ballisticProfile } from '../lib/trajectory.js';
import {
  CASE_CRITERIA,
  CASE_SCOPES,
  CASES,
  autoCaseFor,
  caseScore,
  criteriaForScope,
  dominantCriterion,
  percentileScores,
  rankCase,
  resultFor,
  scopeOptionsFor,
  scopeRows,
} from '../lib/case.js';

const ROWS = AMMO.map((load) => ({
  ...load,
  ...derive(load),
  ...ballisticProfile(load),
}));

const byId = new Map(ROWS.map((row) => [row.id, row]));
const expectedCriteria = [
  'introduced',
  'bulletGr',
  'velocityFps',
  'energyFtLb',
  'effectiveRangeYd',
  'recoilFtLb',
  'costPerRound',
  'caseLengthMm',
];

test('every load has a generated case and every scope is known', () => {
  assert.equal(Object.keys(CASES).length, AMMO.length);
  for (const load of AMMO) {
    const entry = CASES[load.id];
    assert.ok(entry, `missing case for ${load.id}`);
    assert.ok(entry.scopes[entry.auto], `${load.id} auto scope ${entry.auto} is missing`);
    for (const scope of Object.keys(entry.scopes)) {
      assert.ok(CASE_SCOPES[scope], `${load.id} references unknown scope ${scope}`);
    }
  }
});

test('criteria and scope metadata stay in sync with the app', () => {
  assert.deepEqual(CASE_CRITERIA.map((criterion) => criterion.key), expectedCriteria);
  assert.deepEqual(
    Object.keys(CASE_SCOPES),
    ['all', 'centerfire', 'rimfire', 'pistol', 'rifle', 'shotgun'],
  );
  assert.deepEqual(
    criteriaForScope('all').map((criterion) => criterion.key),
    expectedCriteria.slice(0, 7),
  );
  assert.deepEqual(
    criteriaForScope('pistol').map((criterion) => criterion.key),
    expectedCriteria,
  );
  assert.deepEqual(CASE_CRITERIA[7].scopes, ['pistol']);
  assert.equal(CASE_CRITERIA[7].positive, true);
  // Power factor is a column, not a criterion: inside a class it measures the
  // same thing as recoil, and weighting both produced a null direction.
  assert.ok(
    !CASE_CRITERIA.some((criterion) => criterion.key === 'powerFactor'),
    'power factor must not be a Case criterion',
  );
  assert.equal(CASE_SCOPES.all.count, ROWS.length);
  assert.equal(CASE_SCOPES.centerfire.count, ROWS.filter((r) => r.category !== 'rimfire').length);
  assert.equal(CASE_SCOPES.rimfire.count, ROWS.filter((r) => r.category === 'rimfire').length);
  assert.equal(CASE_SCOPES.pistol.count, ROWS.filter((r) => r.category === 'pistol').length);
  assert.equal(CASE_SCOPES.rifle.count, ROWS.filter((r) => r.category === 'rifle').length);
  assert.equal(CASE_SCOPES.shotgun.count, ROWS.filter((r) => r.category === 'shotgun').length);
});

test('generated weights and ranks reproduce in the browser math', () => {
  let checked = 0;
  for (const [id, entry] of Object.entries(CASES)) {
    for (const [scope, result] of Object.entries(entry.scopes)) {
      const members = scopeRows(ROWS, scope);
      assert.ok(members.some((row) => row.id === id), `${id} is not in ${scope}`);
      assert.equal(
        result.weights.length,
        criteriaForScope(scope).length,
        `${id}/${scope} weight count`,
      );

      const sum = result.weights.reduce((total, weight) => total + weight, 0);
      assert.ok(Math.abs(sum - 1) < 2e-7, `${id}/${scope} weights sum to ${sum}`);
      for (const weight of result.weights) {
        assert.ok(Number.isFinite(weight) && weight >= 0, `${id}/${scope} has a bad weight`);
      }

      const percentiles = percentileScores(ROWS, scope);
      const selected = members.find((row) => row.id === id);
      const selectedScore = caseScore(percentiles.get(id), result.weights);
      const above = members.filter(
        (row) =>
          row.id !== id &&
          caseScore(percentiles.get(row.id), result.weights) > selectedScore + 1e-9,
      );
      const margin = Math.min(
        ...members
          .filter((row) => row.id !== id)
          .map((row) => selectedScore - caseScore(percentiles.get(row.id), result.weights)),
      );

      assert.equal(result.rank, above.length + 1, `${id}/${scope} rank`);
      assert.ok(
        Math.abs(result.margin - margin) < 3e-7,
        `${id}/${scope} margin ${result.margin} vs ${margin}`,
      );
      if (result.feasible) {
        assert.equal(result.rank, 1, `${id}/${scope} is marked feasible but not #1`);
        assert.ok(margin > 0, `${id}/${scope} is marked feasible with no margin`);
      }
      assert.ok(byId.has(id));
      checked += 1;
    }
  }
  assert.equal(checked, 874);
});

test('known loads get the intended comparison set', () => {
  const expected = {
    '223': ['all', true],
    '22lr': ['all', true],
    '9mm': ['centerfire', true],
    '45acp': ['pistol', true],
    '357mag': ['pistol', true],
    '50bmg': ['all', true],
    '380acp': ['pistol', true],
  };
  for (const [id, [scope, feasible]] of Object.entries(expected)) {
    const auto = autoCaseFor(id);
    assert.ok(auto, `missing auto case for ${id}`);
    assert.equal(auto.scope, scope, `${id} auto scope`);
    assert.equal(auto.feasible, feasible, `${id} auto feasibility`);
  }

  // The user-facing example: 9mm cannot win against everything, but it can
  // once rimfire loads are excluded.
  assert.equal(resultFor('9mm', 'all').feasible, false);
  assert.equal(resultFor('9mm', 'all').rank, 2);
  assert.equal(resultFor('9mm', 'centerfire').rank, 1);
  assert.ok(resultFor('9mm', 'centerfire').weights[7] > 0.4);
  assert.ok(resultFor('9mm', 'centerfire').weights[6] > 0.2);

  // Within pistols, .45 ACP and .357 Magnum become winnable.
  assert.equal(resultFor('45acp', 'pistol').rank, 1);
  assert.equal(resultFor('357mag', 'pistol').rank, 1);

  // Compact case length is a pistol-only criterion, so .380 ACP wins the
  // pocket-pistol argument without changing the all/centerfire comparisons.
  const options = scopeOptionsFor('380acp');
  assert.equal(options.length, 3);
  assert.equal(resultFor('380acp', 'all').feasible, false);
  assert.equal(resultFor('380acp', 'centerfire').feasible, false);
  assert.equal(resultFor('380acp', 'pistol').rank, 1);
  assert.equal(resultFor('380acp', 'pistol').feasible, true);
  assert.ok(resultFor('380acp', 'pistol').weights[8] > 0.5);
});

test('rankCase exposes the closest case and its blockers', () => {
  const result = resultFor('380acp', 'all');
  const ranking = rankCase(ROWS, 'all', result.weights, '380acp');
  assert.equal(ranking.rank, 9);
  assert.ok(ranking.blockers.length > 0);
  assert.ok(ranking.sorted.some((entry) => entry.row.id === '380acp'));
});

test('a tie is reported as a tie, not as a win', () => {
  // .44 Magnum can only tie for first among pistols, and it does so on 100 %
  // effective range. The ranking must name the loads it ties with, and must not
  // put the selection ahead of them.
  const result = resultFor('44mag', 'pistol');
  assert.equal(result.feasible, false);
  assert.equal(result.rank, 1);
  assert.equal(result.weights[4], 1);

  const ranking = rankCase(ROWS, 'pistol', result.weights, '44mag');
  assert.equal(ranking.tiedWith.length, 29);
  assert.ok(ranking.tiedWith.includes('.38 Super'));
  assert.ok(ranking.tiedWith.includes('.357 Magnum'));

  // Name order among equal scores: the selection is not hoisted to the top.
  assert.equal(ranking.sorted[0].row.name, '.221 Remington Fireball');
  const position = ranking.sorted.findIndex((entry) => entry.row.id === '44mag');
  assert.ok(position > 0, 'selected row is first in the sorted list');
  assert.ok(ranking.sorted.every((entry, index, all) =>
    index === 0 || all[index - 1].score >= entry.score - 1e-9));

  // A strict win has nothing to tie with.
  const feasible = rankCase(ROWS, 'centerfire', resultFor('9mm', 'centerfire').weights, '9mm');
  assert.deepEqual(feasible.tiedWith, []);
});

test('a single-column weighting is flagged as not an even argument', () => {
  const pistol = criteriaForScope('pistol');
  const dominant = dominantCriterion(pistol, resultFor('44mag', 'pistol').weights);
  assert.ok(dominant, 'expected a dominant criterion');
  assert.equal(dominant.criterion.key, 'effectiveRangeYd');
  assert.equal(dominant.weight, 1);

  const even = dominantCriterion(
    criteriaForScope('centerfire'),
    resultFor('9mm', 'centerfire').weights,
  );
  assert.equal(even, null, '9mm keeps cost at 63 %, below the dominance threshold');

  const spread = dominantCriterion(pistol, [0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.05, 0.04, 0.01]);
  assert.equal(spread, null);
  assert.equal(dominantCriterion(pistol, [0.5, 0.5, 0, 0, 0, 0, 0, 0, 0], 0.45)?.weight, 0.5);
});

test('no stored weighting is degenerate', () => {
  // Regression guard for a real bug: recoil energy is momentum squared over
  // twice the gun mass, so inside a class it is the same measurement as power
  // factor. Weighting both let the generator return a null direction that scored
  // every load identically, and .357 Magnum "tied for first" with all 63 other
  // pistol loads. A weighting has to actually spread the comparison set.
  const MIN_SPREAD = 1e-3;
  const MIN_DISTINCT_RATIO = 0.25;
  let worstSpread = Infinity;
  let worstCase = '';
  for (const [id, entry] of Object.entries(CASES)) {
    for (const [scope, result] of Object.entries(entry.scopes)) {
      const members = scopeRows(ROWS, scope);
      const percentiles = percentileScores(ROWS, scope);
      const scores = members.map((row) => caseScore(percentiles.get(row.id), result.weights));
      const spread = Math.max(...scores) - Math.min(...scores);
      if (spread < worstSpread) {
        worstSpread = spread;
        worstCase = `${id}/${scope}`;
      }
      assert.ok(spread >= MIN_SPREAD, `${id}/${scope} weighting spreads scores by only ${spread}`);
      const distinct = new Set(scores.map((score) => score.toFixed(6))).size;
      assert.ok(
        distinct >= members.length * MIN_DISTINCT_RATIO,
        `${id}/${scope} produces only ${distinct} distinct scores for ${members.length} loads`,
      );
    }
  }
  assert.ok(worstSpread >= MIN_SPREAD, `worst spread ${worstSpread} at ${worstCase}`);
});
