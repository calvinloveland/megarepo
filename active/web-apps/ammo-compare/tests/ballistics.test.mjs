import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import {
  energyFtLb,
  ftLbToJoules,
  powerFactor,
  momentumLbfS,
  GRAINS_FPS_TO_LBF_S,
  derive,
} from '../lib/ballistics.js';

test('muzzle energy matches the hand-computed reference values', () => {
  // 124 gr at 1,150 fps is the classic 9mm "NATO-ish" load: ~364 ft-lb.
  assert.ok(Math.abs(energyFtLb(124, 1150) - 364) < 1);
  // 55 gr at 3,150 fps is M193-ish: ~1,211 ft-lb.
  assert.ok(Math.abs(energyFtLb(55, 3150) - 1211) < 2);
  // Energy scales with the square of velocity.
  assert.equal(energyFtLb(100, 2000), energyFtLb(100, 1000) * 4);
});

test('joule conversion uses the standard factor', () => {
  assert.ok(Math.abs(ftLbToJoules(1) - 1.3558179) < 1e-6);
});

test('power factor is momentum per 1000', () => {
  assert.ok(Math.abs(powerFactor(124, 1150) - 142.6) < 1e-9);
  assert.ok(Math.abs(powerFactor(230, 850) - 195.5) < 1e-9);
});

test('momentum in lbf·s matches the published figure for a .45 ACP load', () => {
  // Wikipedia lists 0.868 lbf·s for 230 gr at 850 fps.
  assert.ok(Math.abs(momentumLbfS(230, 850) - 0.868) < 0.001);
  assert.ok(Math.abs(momentumLbfS(9.375 * GRAINS_FPS_TO_LBF_S, 1) - 9.375) < 1e-9);
});

test('derive() returns both unit systems consistently', () => {
  const d = derive({ bulletGr: 180, velocityFps: 2700 });
  assert.ok(Math.abs(d.velocityMps - 822.96) < 0.01);
  assert.ok(Math.abs(d.bulletGrams - 11.6638) < 1e-3);
  assert.ok(Math.abs(d.energyJoules - ftLbToJoules(d.energyFtLb)) < 1e-9);
});

test('every load has the fields the table renders', () => {
  const required = ['id', 'name', 'category', 'bulletGr', 'velocityFps', 'recoil', 'use', 'notes'];
  for (const load of AMMO) {
    for (const key of required) {
      assert.ok(load[key] !== undefined && load[key] !== null, `${load.id} is missing ${key}`);
    }
    assert.ok(Array.isArray(load.platforms) && load.platforms.length > 0, `${load.id} needs platforms`);
    assert.ok(load.bulletGr > 0, `${load.id} bullet weight must be positive`);
    assert.ok(load.velocityFps > 0, `${load.id} velocity must be positive`);
    assert.ok(load.recoil >= 1 && load.recoil <= 5, `${load.id} recoil must be 1-5`);
    // costPerRound is optional: reference rows deliberately have no price.
    if (load.costPerRound != null) assert.ok(load.costPerRound > 0, `${load.id} cost must be positive`);
  }
});

test('load ids stay unique so row expansion is deterministic', () => {
  const ids = AMMO.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the dataset covers Wikipedia and then some', () => {
  const byCategory = AMMO.reduce((acc, l) => ({ ...acc, [l.category]: (acc[l.category] ?? 0) + 1 }), {});
  assert.ok(AMMO.length >= 290, `expected the extended set, got ${AMMO.length}`);
  for (const category of ['rimfire', 'pistol', 'rifle', 'shotgun']) {
    assert.ok((byCategory[category] ?? 0) >= 3, `${category} needs at least three loads`);
  }
  // Spot-check the long tail: an obsolete curiosity, a huge anti-materiel
  // round, a Swedish service cartridge, and a modern extra that Wikipedia's
  // handgun/rifle table does not contain.
  for (const id of ['2-mm-kolibri', '950-jdj', '65x55mm', '400legend']) {
    assert.ok(AMMO.some((l) => l.id === id), `missing ${id}`);
  }
});

test('reference rows carry provenance and plausible bullet weights', () => {
  const reference = AMMO.filter((l) => l.source?.startsWith('wikipedia'));
  assert.ok(reference.length >= 220, `expected the Wikipedia set, got ${reference.length}`);
  for (const load of reference) {
    assert.ok(load.nation, `${load.id} should record its nation`);
    assert.ok(load.introduced > 1800, `${load.id} should record an introduction year`);
    assert.ok(load.bulletGr >= 2 && load.bulletGr <= 4000, `${load.id} bullet weight is implausible`);
  }
});

test('curated rows carry the same reference metadata as the Wikipedia set', () => {
  const curated = AMMO.filter((l) => !l.source);
  assert.ok(curated.length >= 45, `expected the curated set, got ${curated.length}`);
  for (const load of curated) {
    if (load.category !== 'shotgun') {
      assert.ok(load.nation, `${load.id} should record its nation`);
      assert.ok(load.introduced > 1800, `${load.id} should record an introduction year`);
    }
    assert.ok(load.diameterIn > 0.1 && load.diameterIn < 1, `${load.id} diameter is implausible`);
    assert.ok(load.caseLengthMm > 5 && load.caseLengthMm < 120, `${load.id} case length is implausible`);
  }
});

test('common bullet weight ranges contain the load they describe', () => {
  const ranged = AMMO.filter((l) => l.commonGrains);
  assert.ok(ranged.length >= 40, `expected weight ranges, got ${ranged.length}`);
  for (const load of ranged) {
    const [lo, hi] = load.commonGrains;
    assert.equal(load.commonGrains.length, 2, `${load.id} range needs two bounds`);
    assert.ok(lo <= hi, `${load.id} range is inverted`);
    assert.ok(lo >= 2 && hi <= 4000, `${load.id} range is implausible`);
    assert.ok(
      load.bulletGr >= lo && load.bulletGr <= hi,
      `${load.id} load (${load.bulletGr} gr) sits outside its usual range ${lo}–${hi}`,
    );
  }
});

test('introduction years are plausible', () => {
  const thisYear = new Date().getUTCFullYear();
  for (const load of AMMO) {
    if (load.introduced == null) continue;
    assert.ok(
      load.introduced >= 1800 && load.introduced <= thisYear,
      `${load.id} has an implausible year: ${load.introduced}`,
    );
  }
});

test('only curated loads carry a price, and it is a plausible retail figure', () => {
  const priced = AMMO.filter((l) => l.costPerRound != null);
  // The 68 curated loads have current commercial equivalents. Reference rows
  // are deliberately unpriced: many are obsolete, surplus, or collector-only,
  // and a made-up dollar figure is worse than an honest blank.
  assert.equal(
    AMMO.filter((l) => l.source?.startsWith('wikipedia') && l.costPerRound != null).length,
    0,
    'reference rows must not carry a price',
  );
  assert.ok(priced.length >= 60, `expected the curated prices, got ${priced.length}`);
  for (const load of priced) {
    assert.ok(load.costPerRound > 0.03, `${load.id} price is implausibly low`);
    assert.ok(load.costPerRound < 60, `${load.id} price is implausibly high`);
  }
});

test('energy ordering lands where shooters expect it', () => {
  const byId = Object.fromEntries(AMMO.map((l) => [l.id, energyFtLb(l.bulletGr, l.velocityFps)]));
  assert.ok(byId['22lr'] < byId['9mm']);
  assert.ok(byId['9mm'] < byId['223']);
  assert.ok(byId['308'] < byId['300wm']);
  assert.ok(byId['40sw'] < byId['10mm']);
  // The 12 ga slug carries a whole 1 oz payload, so it easily outguns rifle
  // cartridges of a similar case size — but not a .30-06 class load (~2,900 ft-lb).
  assert.ok(byId['25acp'] < byId['22lr'], 'the smallest centerfire should sit under .22 LR');
  assert.ok(byId['22lr'] < byId['22wmr']);
  assert.ok(byId['45acp'] < byId['10mm']);
  assert.ok(byId['30-06'] < byId['300wm']);
  assert.ok(byId['300wm'] < byId['338lapua']);
  assert.ok(byId['338lapua'] < byId['50bmg']);
  assert.ok(byId['12ga-slug'] > byId['762x39']);
  assert.ok(byId['12ga-slug'] > byId['357mag']);
  assert.ok(byId['12ga-slug'] < byId['30-06']);
});
