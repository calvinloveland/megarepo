/**
 * Exterior-ballistics tests.
 *
 * These import the checked-in dataset and the shared model only. No network,
 * no browser: `node --test tests/*.test.mjs` runs them anywhere.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { energyFtLb } from '../lib/ballistics.js';
import {
  ballisticCoefficient,
  ballisticProfile,
  dragDecay,
  effectiveRangeYd,
  isShotLoad,
  sectionalDensity,
  sightGeometry,
  timeOfFlight,
  trajectoryAt,
  trajectoryTable,
  velocityAt,
} from '../lib/trajectory.js';

const byId = Object.fromEntries(AMMO.map((load) => [load.id, load]));

test('sectional density uses pounds per square inch', () => {
  // 168 gr .308" is the classic 0.253 SD bullet.
  assert.ok(Math.abs(sectionalDensity(168, 0.308) - 0.253) < 0.002);
  assert.ok(sectionalDensity(230, 0.451) > sectionalDensity(124, 0.355));
});

test('published ballistic coefficients win over estimates', () => {
  const published = AMMO.find((load) => Number.isFinite(load.bc));
  assert.ok(published, 'dataset should carry some published BCs');
  const bc = ballisticCoefficient(published);
  assert.equal(bc.source, 'published');
  assert.equal(bc.value, published.bc);
});

test('estimated ballistic coefficients stay in a plausible band', () => {
  for (const id of ['9mm', '45acp', '22lr', '762x39', '308', '50bmg', '12ga-slug']) {
    const bc = ballisticCoefficient(byId[id]);
    if (byId[id].bc) continue;
    assert.equal(bc.source, 'estimated');
    assert.ok(bc.value >= 0.03 && bc.value <= 1.2, `${id} BC ${bc.value} is out of band`);
  }
  // A heavy spitzer has more BC than a light round-nose pistol bullet.
  assert.ok(ballisticCoefficient(byId['308']).value > ballisticCoefficient(byId['9mm']).value);
});

test('drag grows as the ballistic coefficient falls', () => {
  assert.ok(dragDecay(0.15) > dragDecay(0.3));
  assert.ok(dragDecay(0.3) > dragDecay(0.6));
  assert.ok(dragDecay(0.0001) <= 0.0035);
});

test('velocity, time, and energy stay physically consistent', () => {
  const load = byId['308'];
  const bc = ballisticCoefficient(load);
  assert.equal(velocityAt(load, 0, bc.value), load.velocityFps);
  assert.equal(timeOfFlight(load, 0, bc.value), 0);
  assert.ok(velocityAt(load, 100, bc.value) < load.velocityFps);
  assert.ok(velocityAt(load, 300, bc.value) < velocityAt(load, 100, bc.value));
  assert.ok(timeOfFlight(load, 200, bc.value) > timeOfFlight(load, 100, bc.value));
  const at200 = trajectoryAt(load, 200, bc);
  assert.ok(Math.abs(at200.energyFtLb - energyFtLb(load.bulletGr, at200.velocityFps)) < 1e-9);
});

test('trajectory is zeroed at the class-appropriate distance', () => {
  for (const id of ['308', '9mm', '22lr']) {
    const load = byId[id];
    const { heightIn, zeroYd } = sightGeometry(load);
    const zero = trajectoryAt(load, zeroYd);
    assert.ok(Math.abs(zero.dropIn) < 0.01, `${id} should cross the line of sight at ${zeroYd} yd`);
    assert.ok(Math.abs(trajectoryAt(load, 0).dropIn + heightIn) < 0.01, `${id} should start below the sight`);
    assert.ok(trajectoryAt(load, zeroYd * 2).dropIn < 0, `${id} should fall beyond its zero`);
  }
});

test('effective ranges land in the expected order of magnitude', () => {
  assert.ok(effectiveRangeYd(byId['22lr']) >= 100 && effectiveRangeYd(byId['22lr']) <= 200);
  assert.ok(effectiveRangeYd(byId['9mm']) >= 50 && effectiveRangeYd(byId['9mm']) <= 150);
  assert.ok(effectiveRangeYd(byId['223']) >= 400 && effectiveRangeYd(byId['223']) <= 600);
  assert.ok(effectiveRangeYd(byId['308']) >= 500 && effectiveRangeYd(byId['308']) <= 900);
  assert.ok(effectiveRangeYd(byId['50bmg']) >= 1500);
  assert.ok(effectiveRangeYd(byId['22lr']) < effectiveRangeYd(byId['223']));
  assert.ok(effectiveRangeYd(byId['9mm']) < effectiveRangeYd(byId['308']));
  assert.ok(effectiveRangeYd(byId['308']) < effectiveRangeYd(byId['50bmg']));
});

test('shot shells are pattern-limited and slugs get a slug range', () => {
  assert.equal(isShotLoad(byId['12ga-buck']), true);
  assert.equal(isShotLoad(byId['12ga-slug']), false);
  assert.equal(effectiveRangeYd(byId['12ga-buck']), 40);
  assert.equal(effectiveRangeYd(byId['12ga-target']), 40);
  assert.equal(effectiveRangeYd(byId['12ga-slug']), 100);
  assert.equal(effectiveRangeYd(byId['12ga-sabot']), 150);
  assert.equal(trajectoryTable(byId['12ga-buck']), null);
});

test('trajectory samples are ordered and end at the effective range', () => {
  for (const id of ['22lr', '9mm', '45acp', '223', '762x39', '308', '338lapua', '50bmg']) {
    const load = byId[id];
    const table = trajectoryTable(load);
    assert.ok(table.length >= 4 && table.length <= 8, `${id} table has ${table.length} rows`);
    assert.equal(table[0].distanceYd, 0);
    assert.equal(table.at(-1).distanceYd, effectiveRangeYd(load));
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i].distanceYd > table[i - 1].distanceYd, `${id} ranges are out of order`);
      assert.ok(table[i].velocityFps < table[i - 1].velocityFps, `${id} velocity should fall`);
    }
    if (effectiveRangeYd(load) > 200) {
      assert.ok(table.some((row) => row.distanceYd === 100), `${id} should include the 100-yard row`);
    }
  }
});

test('every load produces finite ballistics', () => {
  for (const load of AMMO) {
    const profile = ballisticProfile(load);
    assert.ok(Number.isFinite(profile.bcValue) && profile.bcValue > 0, `${load.id} BC`);
    assert.ok(
      Number.isFinite(profile.effectiveRangeYd) &&
        profile.effectiveRangeYd >= 25 &&
        profile.effectiveRangeYd <= 2500,
      `${load.id} effective range ${profile.effectiveRangeYd}`,
    );
    if (!profile.trajectory) continue;
    for (const row of profile.trajectory) {
      for (const key of ['velocityFps', 'energyFtLb', 'energyJoules', 'timeS', 'dropIn']) {
        assert.ok(Number.isFinite(row[key]), `${load.id} ${key} at ${row.distanceYd} yd`);
      }
      assert.ok(row.velocityFps > 0 && row.velocityFps <= load.velocityFps, `${load.id} velocity`);
      assert.ok(row.energyFtLb > 0, `${load.id} energy`);
    }
  }
});
