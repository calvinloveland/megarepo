import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { energyFtLb, ftLbToJoules, powerFactor, derive } from '../lib/ballistics.js';

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

test('derive() returns both unit systems consistently', () => {
  const d = derive({ bulletGr: 180, velocityFps: 2700 });
  assert.ok(Math.abs(d.velocityMps - 822.96) < 0.01);
  assert.ok(Math.abs(d.bulletGrams - 11.6638) < 1e-3);
  assert.ok(Math.abs(d.energyJoules - ftLbToJoules(d.energyFtLb)) < 1e-9);
});

test('every load has the fields the table renders', () => {
  const required = ['id', 'name', 'category', 'bulletGr', 'velocityFps', 'costPerRound', 'recoil', 'use', 'notes'];
  for (const load of AMMO) {
    for (const key of required) {
      assert.ok(load[key] !== undefined && load[key] !== null, `${load.id} is missing ${key}`);
    }
    assert.ok(Array.isArray(load.platforms) && load.platforms.length > 0, `${load.id} needs platforms`);
    assert.ok(load.bulletGr > 0, `${load.id} bullet weight must be positive`);
    assert.ok(load.velocityFps > 0, `${load.id} velocity must be positive`);
    assert.ok(load.recoil >= 1 && load.recoil <= 5, `${load.id} recoil must be 1-5`);
    assert.ok(load.costPerRound > 0, `${load.id} cost must be positive`);
  }
});

test('load ids stay unique so row expansion is deterministic', () => {
  const ids = AMMO.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('energy ordering lands where shooters expect it', () => {
  const byId = Object.fromEntries(AMMO.map((l) => [l.id, energyFtLb(l.bulletGr, l.velocityFps)]));
  assert.ok(byId['22lr'] < byId['9mm']);
  assert.ok(byId['9mm'] < byId['223']);
  assert.ok(byId['308'] < byId['300wm']);
  assert.ok(byId['40sw'] < byId['10mm']);
  // The 12 ga slug carries a whole 1 oz payload, so it easily outguns rifle
  // cartridges of a similar case size — but not a .30-06 class load (~2,900 ft-lb).
  assert.ok(byId['12ga-slug'] > byId['762x39']);
  assert.ok(byId['12ga-slug'] > byId['357mag']);
  assert.ok(byId['12ga-slug'] < byId['3006']);
});
