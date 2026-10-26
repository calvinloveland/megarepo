import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import {
  REFERENCE_GUNS,
  RECOIL_LEVELS,
  FT_LB_TO_J,
  recoilInGun,
  recoilLevel,
  recoilProfile,
  recoilImpulse,
} from '../lib/recoil.js';

const byId = new Map(AMMO.map((load) => [load.id, load]));
const profile = (id) => recoilProfile(byId.get(id));

test('every load produces finite recoil from its own momentum', () => {
  for (const load of AMMO) {
    const r = recoilProfile(load);
    assert.ok(Number.isFinite(r.recoilFtLb) && r.recoilFtLb > 0, `${load.id} recoil energy`);
    assert.ok(Number.isFinite(r.recoilImpulseLbfS) && r.recoilImpulseLbfS > 0, `${load.id} impulse`);
    assert.ok(r.recoilLevel >= 1 && r.recoilLevel <= 5, `${load.id} level ${r.recoilLevel}`);
    assert.ok(Math.abs(r.recoilJoules - r.recoilFtLb * FT_LB_TO_J) < 1e-9, `${load.id} joules`);
    assert.equal(r.recoilGunLb, REFERENCE_GUNS[load.category].lb, `${load.id} reference gun`);
  }
});

test('recoil energy is impulse squared over twice the gun mass', () => {
  const load = byId.get('9mm');
  const impulse = recoilImpulse(load);
  assert.ok(Math.abs(impulse - (124 * 1150) / 7000) < 1e-9);
  const expected = (impulse * impulse) / (2 * 2 * 32.174);
  assert.ok(Math.abs(recoilInGun(load, 2) - expected) < 1e-9);
  // Halving the gun's weight doubles the energy it puts into your hand.
  assert.ok(Math.abs(recoilInGun(load, 1) - 2 * recoilInGun(load, 2)) < 1e-9);
  assert.ok(Math.abs(recoilInGun(load, 4) - recoilInGun(load, 2) / 2) < 1e-9);
});

test('recoil orders the way shooters describe it', () => {
  const energy = (id) => profile(id).recoilFtLb;
  assert.ok(energy('22lr') < energy('380acp'), '.22 LR should be gentler than .380 ACP');
  assert.ok(energy('380acp') < energy('9mm'), '.380 ACP should be gentler than 9mm');
  assert.ok(energy('9mm') < energy('357mag'), '9mm should be gentler than .357 Magnum');
  assert.ok(energy('357mag') < energy('44mag'), '.357 should be gentler than .44 Magnum');
  assert.ok(energy('223') < energy('308'), '.223 should be gentler than .308');
  assert.ok(energy('308') < energy('50bmg'), '.308 should be gentler than .50 BMG');
  assert.ok(energy('9mm') < energy('12ga-slug'), '9mm should be gentler than a 12 ga slug');
});

test('the dot scale separates .380 ACP from 9mm Luger', () => {
  // The hand-typed rating this replaced scored both at 2/5, which is the reason
  // the column was rebuilt.
  assert.equal(profile('380acp').recoilLevel, 2);
  assert.equal(profile('9mm').recoilLevel, 3);
  assert.equal(profile('22lr').recoilLevel, 1);
  assert.equal(profile('500sw').recoilLevel, 5);
});

test('levels follow the fixed bounds, not the dataset quantiles', () => {
  assert.deepEqual(RECOIL_LEVELS, [0.5, 2, 5, 12]);
  assert.equal(recoilLevel(0.49), 1);
  assert.equal(recoilLevel(0.5), 2);
  assert.equal(recoilLevel(1.99), 2);
  assert.equal(recoilLevel(2), 3);
  assert.equal(recoilLevel(5), 4);
  assert.equal(recoilLevel(12), 5);
  assert.equal(recoilLevel(1e6), 5);
  for (const load of AMMO) {
    assert.equal(
      recoilProfile(load).recoilLevel,
      recoilLevel(recoilProfile(load).recoilFtLb),
      `${load.id} level disagrees with its energy`,
    );
  }
});

test('each class has a stated reference gun', () => {
  assert.deepEqual(Object.keys(REFERENCE_GUNS).sort(), ['pistol', 'rifle', 'rimfire', 'shotgun']);
  for (const [category, gun] of Object.entries(REFERENCE_GUNS)) {
    assert.ok(gun.lb > 0.5 && gun.lb < 20, `${category} reference mass ${gun.lb} lb is implausible`);
    assert.match(gun.label, /\d/);
  }
  // Heavier reference guns for heavier classes: pistol < shotgun < rifle.
  assert.ok(REFERENCE_GUNS.pistol.lb < REFERENCE_GUNS.shotgun.lb);
  assert.ok(REFERENCE_GUNS.shotgun.lb < REFERENCE_GUNS.rifle.lb);
});
