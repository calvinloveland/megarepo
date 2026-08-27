// tests/watch.test.mjs — phenotype model behaviour
import { test } from 'node:test';
import assert from 'node:assert/strict';
import watchPkg from '../watch.js';
const { randomGenotype, computePhenotype, genotypeHash, championName, mulberry32 } = watchPkg;

const rng = mulberry32(42);

test('phenotype is deterministic for the same genotype', () => {
  const g = randomGenotype(mulberry32(7));
  const a = computePhenotype(g, { rng: mulberry32(genotypeHash(g)) });
  const b = computePhenotype(g, { rng: mulberry32(genotypeHash(g)) });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('thickness grows when complications are added', () => {
  const g = randomGenotype(mulberry32(3));
  g.complications = {};
  const bare = computePhenotype(g);
  g.complications.moonphase = 1;
  g.complications.chronograph = 1;
  const loaded = computePhenotype(g);
  assert.ok(loaded.thickness > bare.thickness, `${loaded.thickness} > ${bare.thickness}`);
  assert.ok(loaded.weight > bare.weight);
  assert.ok(loaded.cost > bare.cost);
  assert.ok(loaded.componentCount > bare.componentCount);
});

test('silicon + free-sprung + constant force beats steel + plain + lever on accuracy', () => {
  const base = randomGenotype(mulberry32(11));
  base.complications = {};
  const budget = { ...base, hairspring: 'steel', balance: 'plain', escapement: 'lever' };
  const haute = { ...base, hairspring: 'silicon', balance: 'freeSprung', escapement: 'constant' };
  assert.ok(
    computePhenotype(haute).accuracy < computePhenotype(budget).accuracy,
    `haute ${computePhenotype(haute).accuracy} < budget ${computePhenotype(budget).accuracy}`
  );
});

test('higher beat rates improve accuracy but drain power reserve', () => {
  const g = randomGenotype(mulberry32(5));
  g.complications = {};
  const slow = computePhenotype({ ...g, beat: 18000 });
  const fast = computePhenotype({ ...g, beat: 36000 });
  assert.ok(fast.accuracy < slow.accuracy);
  assert.ok(fast.powerReserve < slow.powerReserve);
});

test('more train wheels = more components and more visible parts', () => {
  const g = randomGenotype(mulberry32(9));
  g.complications = {};
  const lean = computePhenotype({ ...g, trainWheels: 3 });
  const wide = computePhenotype({ ...g, trainWheels: 9 });
  assert.ok(wide.componentCount > lean.componentCount);
  assert.ok(wide.visibleComponents > lean.visibleComponents);
  assert.ok(wide.thickness > lean.thickness);
});

test('skeletonization strongly increases visible components but not count', () => {
  const g = randomGenotype(mulberry32(13));
  g.skeleton = 0;
  const closed = computePhenotype(g);
  g.skeleton = 100;
  const open = computePhenotype(g);
  assert.ok(open.visibleComponents > closed.visibleComponents * 1.5);
  assert.equal(open.componentCount, closed.componentCount);
});

test('twin/three barrels extend power reserve', () => {
  const g = randomGenotype(mulberry32(17));
  g.complications = {};
  const one = computePhenotype({ ...g, barrels: 1 });
  const three = computePhenotype({ ...g, barrels: 3 });
  assert.ok(three.powerReserve > one.powerReserve * 2.2);
});

test('grades raise cost and visibility of a complication', () => {
  const g = randomGenotype(mulberry32(23));
  g.complications = { tourbillon: 1 };
  const g1 = computePhenotype(g);
  g.complications = { tourbillon: 3 };
  const g3 = computePhenotype(g);
  assert.ok(g3.cost > g1.cost);
  assert.ok(g3.visibleComponents > g1.visibleComponents);
  assert.ok(g3.compGradeSum === 3);
});

test('reliability stays in [0.3, 1] for wild builds', () => {
  let worst = 1, best = 0;
  for (let i = 0; i < 400; i++) {
    const p = computePhenotype(randomGenotype(mulberry32(i)), { rng: mulberry32(i) });
    worst = Math.min(worst, p.reliability);
    best = Math.max(best, p.reliability);
  }
  assert.ok(worst >= 0.3, `worst ${worst}`);
  assert.ok(best <= 1, `best ${best}`);
});

test('all stats are finite and non-negative', () => {
  for (let i = 0; i < 200; i++) {
    const p = computePhenotype(randomGenotype(mulberry32(i)), { rng: mulberry32(i) });
    for (const k of ['componentCount', 'visibleComponents', 'thickness', 'weight',
                     'cost', 'complexity', 'powerReserve', 'accuracy', 'effectiveAccuracy']) {
      assert.ok(Number.isFinite(p[k]), `${k} finite`);
      assert.ok(p[k] >= 0, `${k} >= 0`);
    }
  }
});

test('champion names are stable and readable', () => {
  const g = randomGenotype(mulberry32(31));
  assert.equal(championName(g), championName(g));
  assert.match(championName(g), /^Calibre \w+/);
});

test('genotypeHash differs across distinct genotypes', () => {
  const a = genotypeHash(randomGenotype(mulberry32(1)));
  const b = genotypeHash(randomGenotype(mulberry32(2)));
  const c = genotypeHash(randomGenotype(mulberry32(3)));
  assert.ok(a !== b || b !== c, 'at least one distinct');
});