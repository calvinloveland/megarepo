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
  'powerFactor',
  'recoil',
  'costPerRound',
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
    '380acp': ['pistol', false],
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

  // No available scope wins for .380 ACP; the feature must admit that.
  const options = scopeOptionsFor('380acp');
  assert.equal(options.length, 3);
  assert.ok(options.every((option) => !resultFor('380acp', option.scope).feasible));
  assert.equal(resultFor('380acp', 'pistol').rank, 3);
});

test('rankCase exposes the closest case and its blockers', () => {
  const result = resultFor('380acp', 'pistol');
  const ranking = rankCase(ROWS, 'pistol', result.weights, '380acp');
  assert.equal(ranking.rank, 3);
  assert.ok(ranking.blockers.length > 0);
  assert.ok(ranking.sorted.some((entry) => entry.row.id === '380acp'));
});
