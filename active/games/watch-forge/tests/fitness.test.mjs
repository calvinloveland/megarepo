// tests/fitness.test.mjs — each challenge equation rewards its stated objective
import { test } from 'node:test';
import assert from 'node:assert/strict';
import watchPkg from '../watch.js';
const { randomGenotype, computePhenotype, mulberry32 } = watchPkg;
import evoPkg from '../evolution.js';
const { CHALLENGES, scoreWatch } = evoPkg;

function mk(rngSeed, edits) {
  const g = randomGenotype(mulberry32(rngSeed));
  g.complications = {};
  return { ...g, ...edits };
}

// A cheap complication added to an otherwise bare, thin watch.
const CHEAP_COMP = { date: 1 };

test('skeleton challenge: more parts + more openness wins', () => {
  const bare = mk(1, { skeleton: 10, trainWheels: 3 });
  const openLoaded = mk(1, { skeleton: 95, trainWheels: 9, complications: { ...CHEAP_COMP, moonphase: 2, tourbillon: 1 } });
  const sBare = scoreWatch(computePhenotype(bare), 'skeleton');
  const sOpen = scoreWatch(computePhenotype(openLoaded), 'skeleton');
  assert.ok(sOpen > sBare, `open ${sOpen} > bare ${sBare}`);
});

test('skeleton challenge: skeletonizing an identical build scores higher', () => {
  const closed = computePhenotype(mk(2, { skeleton: 0 }));
  const open = computePhenotype(mk(2, { skeleton: 100 }));
  assert.ok(
    scoreWatch(open, 'skeleton') > scoreWatch(closed, 'skeleton'),
    `${scoreWatch(open, 'skeleton')} > ${scoreWatch(closed, 'skeleton')}`
  );
});

test('minimalist challenge: bare minimal build beats a complication-loaded one', () => {
  const lean = computePhenotype(mk(3, { trainWheels: 3, skeleton: 20 }));
  const fat = computePhenotype(mk(3, { trainWheels: 8, skeleton: 90,
    complications: { ...CHEAP_COMP, chronograph: 2, perpetual: 1, minuteRepeater: 1 } }));
  const sLean = scoreWatch(lean, 'minimalist');
  const sFat = scoreWatch(fat, 'minimalist');
  assert.ok(sLean > sFat, `lean ${sLean} > fat ${sFat}`);
});

test('minimalist challenge: accuracy upgrade beats part-count bloat', () => {
  const sloppy = computePhenotype(mk(4, { escapement: 'lever', balance: 'plain', hairspring: 'steel', beat: 18000 }));
  const precise = computePhenotype(mk(4, { escapement: 'constant', balance: 'inertial', hairspring: 'silicon', beat: 36000 }));
  assert.ok(
    scoreWatch(precise, 'minimalist') > scoreWatch(sloppy, 'minimalist'),
    `${scoreWatch(precise, 'minimalist')} > ${scoreWatch(sloppy, 'minimalist')}`
  );
});

test('grand complication: loading complications wins even with the thickness tax', () => {
  const plain = computePhenotype(mk(5, { complications: {} }));
  const loaded = computePhenotype(mk(5, {
    complications: { ...CHEAP_COMP, moonphase: 2, gmt: 1, powerReserve: 1, perpetual: 1, worldTime: 2 },
  }));
  assert.ok(
    scoreWatch(loaded, 'grandComplication') > scoreWatch(plain, 'grandComplication'),
    `${scoreWatch(loaded, 'grandComplication')} > ${scoreWatch(plain, 'grandComplication')}`
  );
});

test('grand complication: slim beats fat at equal complication load', () => {
  const thin = computePhenotype(mk(6, { trainWheels: 3, complications: { moonphase: 2, gmt: 1 } }));
  const thick = computePhenotype(mk(6, { trainWheels: 9, complications: { moonphase: 2, gmt: 1 } }));
  assert.ok(
    scoreWatch(thin, 'grandComplication') > scoreWatch(thick, 'grandComplication'),
    `${scoreWatch(thin, 'grandComplication')} > ${scoreWatch(thick, 'grandComplication')}`
  );
});

test('grand complication: three grades of the same complication beat one', () => {
  const g1 = computePhenotype(mk(7, { complications: { tourbillon: 1 } }));
  const g3 = computePhenotype(mk(7, { complications: { tourbillon: 3 } }));
  assert.ok(scoreWatch(g3, 'grandComplication') > scoreWatch(g1, 'grandComplication'));
});

test('chronometer: precision build beats bling build', () => {
  const precise = computePhenotype(mk(8, {
    escapement: 'constant', balance: 'inertial', hairspring: 'silicon', beat: 36000,
    complications: {}, trainWheels: 3, skeleton: 10,
  }));
  const bling = computePhenotype(mk(8, {
    escapement: 'lever', balance: 'plain', hairspring: 'steel', beat: 18000,
    complications: { ...CHEAP_COMP, moonphase: 1, chronograph: 1, repeater: 1 },
    trainWheels: 6, skeleton: 80,
  }));
  assert.ok(scoreWatch(precise, 'chronometer') > scoreWatch(bling, 'chronometer'));
});

test('pocket hero: triple barrels beat single barrel', () => {
  const one = computePhenotype(mk(9, { barrels: 1, complications: {} }));
  const three = computePhenotype(mk(9, { barrels: 3, complications: {} }));
  assert.ok(scoreWatch(three, 'pocket') > scoreWatch(one, 'pocket'));
});

test('every challenge returns finite scores for any random watch', () => {
  for (let i = 0; i < 300; i++) {
    const p = computePhenotype(randomGenotype(mulberry32(i)), { rng: mulberry32(i) });
    for (const id of Object.keys(CHALLENGES)) {
      const s = scoreWatch(p, id);
      assert.ok(Number.isFinite(s), `${id} finite ${s}`);
    }
  }
});

test('challenge equations are exposed in metadata', () => {
  for (const id of Object.keys(CHALLENGES)) {
    assert.ok(CHALLENGES[id].name);
    assert.ok(CHALLENGES[id].equation);
    assert.ok(CHALLENGES[id].tagline);
  }
});