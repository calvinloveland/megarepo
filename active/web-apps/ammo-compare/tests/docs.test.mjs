/**
 * Documentation-claims checks.
 *
 * `docs/index.md` and `README.md` quote numbers from the dataset: how many loads
 * have a strict case, how many rows each comparison set holds, how many are
 * unpriced, what the `.380 ACP` case rests on. Those numbers move whenever the
 * data or the generator changes, and a stale claim is a lie in the docs. This
 * suite pins the ones a reader would rely on, so regenerating the weights and
 * forgetting the prose fails here instead of shipping.
 *
 * `docs/case-maker-review.md` is deliberately not covered: it is a dated review,
 * so its numbers describe the moment it was written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AMMO } from '../data/ammo.js';
import { REFERENCE_DIMENSIONS } from '../data/dimensions.js';
import { INVENTORS } from '../data/inventors.js';
import { derive } from '../lib/ballistics.js';
import { ballisticProfile } from '../lib/trajectory.js';
import { recoilProfile } from '../lib/recoil.js';
import { matchesJurisdiction } from '../lib/legality.js';
import { CATALOG_IS_FIXTURE, CATALOG_STATS } from '../lib/products.js';
import {
  CASE_SCOPES,
  CASES,
  criteriaForScope,
  percentileScores,
  rankCase,
  scopeRows,
} from '../lib/case.js';

const ROWS = AMMO.map((load) => ({
  ...load,
  ...derive(load),
  ...ballisticProfile(load),
  ...recoilProfile(load),
}));

// Wrapped prose would otherwise make every claim a whitespace puzzle.
const flat = (text) => text.replace(/\s+/g, ' ');
const DOC = flat(readFileSync(new URL('../docs/index.md', import.meta.url), 'utf8'));
const README = flat(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));

const says = (source, claim, label) =>
  assert.ok(
    source.includes(flat(claim)),
    `${label ?? claim} is stale or missing from the docs`,
  );

/** Counts the prose quotes, computed from the same data the prose describes. */
const stats = (() => {
  let feasible = 0;
  let infeasible = 0;
  let oneHot = 0;
  let autoOneHot = 0;
  let rankOneTies = 0;
  let autoFeasible = 0;
  for (const [id, entry] of Object.entries(CASES)) {
    if (entry.scopes[entry.auto]?.feasible) autoFeasible += 1;
    for (const [scope, result] of Object.entries(entry.scopes)) {
      if (result.feasible) {
        feasible += 1;
        continue;
      }
      infeasible += 1;
      if (result.rank === 1 && !result.thin) rankOneTies += 1;
      if (result.factors === 1) {
        oneHot += 1;
        if (scope === entry.auto) autoOneHot += 1;
      }
    }
  }
  const pistols = ROWS.filter((row) => row.category === 'pistol');
  const dimensionDrawings = new Set(Object.values(REFERENCE_DIMENSIONS).map((entry) => entry.title));
  return {
    loads: AMMO.length,
    autoFeasible,
    feasible,
    infeasible,
    oneHot,
    autoOneHot,
    rankOneTies,
    priced: AMMO.filter((load) => load.costPerRound != null).length,
    unpriced: AMMO.filter((load) => load.costPerRound == null).length,
    designers: AMMO.filter((load) => INVENTORS[load.id]).length,
    bcRows: AMMO.filter((load) => load.bc).length,
    pistols: pistols.length,
    unpricedPistols: pistols.filter((load) => load.costPerRound == null).length,
    dimensionRows: Object.keys(REFERENCE_DIMENSIONS).length,
    dimensionCartridges: dimensionDrawings.size,
  };
})();

test('the coverage numbers in the docs match the dataset', () => {
  says(DOC, `Designer coverage is ${stats.designers} of ${stats.loads} loads`);
  says(DOC, `Cost per round is only present for the ${stats.priced} cartridges`);
  says(DOC, `because ${stats.unpricedPistols} of the ${stats.pistols} pistol rows are unpriced`);
  says(DOC, `the data has one (${stats.bcRows} rows)`);
  says(DOC, `the ${stats.unpriced} unpriced loads never win a cost argument by default`);
});

test('the SAAMI/CIP counts in the docs match the overlay', () => {
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = (n) => {
    if (n < 10) return words[n];
    const [t, u] = String(n).padStart(2, '0').split('').map(Number);
    const tensWords = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty'];
    const unitWords = ['', '-one', '-two', '-three', '-four', '-five', '-six', '-seven', '-eight', '-nine'];
    return tensWords[t] + (u ? unitWords[u] : '');
  };
  const written = tens(stats.dimensionCartridges);
  assert.ok(written, `no spelling for ${stats.dimensionCartridges}`);
  says(
    DOC,
    `${written} published drawings cover ${stats.dimensionRows} rows`,
    `${written} published drawings covering ${stats.dimensionRows} rows`,
  );
  says(DOC, `Measured against those ${stats.dimensionRows} rows:`);
});

test('the comparison-set table matches the generated scopes', () => {
  const labels = {
    all: 'All loads',
    centerfire: 'Centerfire loads',
    rimfire: 'Rimfire loads',
    pistol: 'Pistol loads',
    rifle: 'Rifle loads',
    shotgun: 'Shotgun loads',
    mx: 'Loads legal in Mexico',
    it: 'Loads legal in Italy',
    ca: 'Loads legal in Canada',
  };
  for (const [scope, meta] of Object.entries(CASE_SCOPES)) {
    const label = labels[scope] ?? meta.label;
    says(DOC, `| ${label} | ${meta.count} |`, `scope table row for ${scope}`);
    // The count in the payload has to be the overlay's own answer, not a guess.
    const jurisdiction = scope.toUpperCase();
    if (['MX', 'IT', 'CA'].includes(jurisdiction)) {
      assert.equal(
        meta.count,
        ROWS.filter((row) => matchesJurisdiction(row, jurisdiction)).length,
        `${scope} count disagrees with the legality overlay`,
      );
    }
  }
  says(DOC, `The default is the broadest set in which the load can win: all loads first`);
});

test('the case statistics in the docs match the generated weights', () => {
  says(
    DOC,
    `**${stats.autoFeasible} of ${stats.loads} loads have a strict case**`,
    `${stats.autoFeasible} of ${stats.loads} loads have a strict case`,
  );
  says(
    DOC,
    `**A tie is a tie.** ${stats.rankOneTies} load/scope results can only tie for first`,
    `${stats.rankOneTies} rank-one ties`,
  );
  says(
    DOC,
    `vertex of the weight simplex for ${stats.oneHot} of the ${stats.infeasible} infeasible results — ${stats.autoOneHot} of them`,
    `${stats.oneHot}/${stats.infeasible} single-column fallbacks, ${stats.autoOneHot} auto`,
  );
});

test('the illustrative cases in the docs are the stored ones', () => {
  const rows = [
    ['9mm Luger', '9mm', 'centerfire', 1],
    ['.223 Rem', '223', 'all', 2],
    ['12 ga slug', '12ga-slug', 'shotgun', 1],
    ['.380 ACP', '380acp', 'pistol', 3],
    ['.45 ACP', '45acp', 'centerfire', 4],
    ['.357 Magnum', '357mag', 'pistol', 1],
    ['.50 BMG', '50bmg', 'rifle', 3],
  ];
  for (const [name, id, scope, factors] of rows) {
    const result = CASES[id].scopes[scope];
    assert.ok(result, `${id}/${scope} is missing`);
    assert.equal(result.factors, factors, `${id}/${scope} factor count changed`);
    says(
      DOC,
      `| \`${name}\` | ${scope} | ${
        result.feasible
          ? '#1'
          : result.thin
            ? 'first, thin'
            : result.rank === 1
              ? 'tied #1'
              : `closest found #${result.rank}`
      } | **${factors}** |`,
      `illustrative table row for ${id}/${scope}`,
    );
  }
  // The 9mm override row is the "closest found" example.
  says(DOC, '| `9mm Luger` | all (override) | closest found #2 |');
});

test('the .380 ACP walkthrough matches the stored weights', () => {
  const result = CASES['380acp'].scopes.pistol;
  const criteria = criteriaForScope('pistol');
  const used = criteria
    .map((criterion, index) => ({ criterion, weight: result.weights[index] }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  assert.equal(used.length, 3, '.380 ACP should need three columns');

  const percent = (weight) => `${Math.round(weight * 100)} %`;
  const [first, second, third] = used;
  says(
    DOC,
    `**three of the eight columns** — ${first.criterion.label.toLowerCase()} ${percent(first.weight)}, ` +
      `${second.criterion.label.toLowerCase()} ${percent(second.weight)}, ` +
      `${third.criterion.label.toLowerCase()} ${percent(third.weight)}`,
    '.380 ACP column split',
  );

  // Every used column is load-bearing, and the docs quote where it falls without it.
  const percentiles = percentileScores(ROWS, 'pistol');
  const rankWithout = (index) => {
    const trial = result.weights.slice();
    trial[index] = 0;
    const total = trial.reduce((sum, value) => sum + value, 0);
    const ranking = rankCase(
      ROWS,
      'pistol',
      trial.map((value) => value / total),
      '380acp',
      percentiles,
    );
    return ranking.rank;
  };
  const drops = [
    { key: 'caseLengthMm', words: 'compact case' },
    { key: 'costPerRound', words: 'cost' },
    { key: 'bulletGr', words: 'bullet weight' },
  ];
  for (const drop of drops) {
    const rank = rankWithout(criteria.findIndex((criterion) => criterion.key === drop.key));
    says(DOC, `drop ${drop.words} and it falls to rank ${rank}`);
  }

  // The Mexican result is the interesting one, so it is claimed in prose.
  const mexican = CASES['380acp'].scopes.mx;
  assert.ok(mexican, '.380 ACP should have a Mexico scope');
  says(DOC, `Rank ${mexican.rank} of ${CASE_SCOPES.mx.count}, reported as a closest case rather than a win.`);
  assert.equal(scopeRows(ROWS, 'mx').length, CASE_SCOPES.mx.count);
});

test('the tie example in the docs names the right number of loads', () => {
  const result = CASES['44mag'].scopes.pistol;
  const ranking = rankCase(ROWS, 'pistol', result.weights, '44mag');
  says(DOC, `that is ${ranking.tiedWith.length} other cartridges`);
});

test('the README counts match the dataset', () => {
  says(
    README,
    `dimensions: ${stats.dimensionCartridges} drawings across ${stats.dimensionRows} rows`,
    'README case-dimension count',
  );
  says(README, `plus shotgun loads and current-production rounds`);
});

test('the product-catalog claims match the catalog', () => {
  // The fixture is a claim about a claim: the docs must say it is a fixture while
  // it is one, and must quote its real size.
  assert.equal(CATALOG_IS_FIXTURE, true, 'the docs claim a fixture; keep them in step');
  says(
    DOC,
    `Its ${CATALOG_STATS.products} rows exist to exercise the`,
    'product fixture row count',
  );
  says(DOC, 'The table gains a **Products** view beside **Cartridges**');
  says(DOC, 'node tools/import-products.mjs catalog.csv            # validate + write');
  for (const field of ['cartridge', 'source', 'priceUsd', 'packageRounds', 'velocityFps']) {
    says(DOC, `| \`${field}\` |`, `product schema row for ${field}`);
  }
});

test('the two-way link between cartridges and listings is documented', () => {
  says(DOC, 'A cartridge row with listings carries a count badge');
  says(DOC, '`from cartridge` on a velocity the manufacturer did not publish');
  says(DOC, 'a **Brand** filter built from whatever the catalog contains');
});
