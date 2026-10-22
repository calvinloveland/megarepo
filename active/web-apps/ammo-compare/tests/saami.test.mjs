/**
 * SAAMI validation for the cartridge silhouettes.
 *
 * The 37 loads below have published ANSI/SAAMI dimensions. This file checks two
 * things:
 *
 * 1. The dataset's bullet diameter and case length agree with the standard, so
 *    the row and its drawing describe the same cartridge.
 * 2. When a SAAMI reference is attached (`load.saami`), the drawing uses the
 *    published base, neck, rim, and rim height instead of the inferred values.
 *
 * It also measures the inferred fallback on the same sample, which is the only
 * accuracy claim the remaining rows can make. Offline by construction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { SAAMI_DIMENSIONS } from '../data/saami.js';
import { cartridgeGeometry } from '../lib/cartridge-svg.js';

const byId = new Map(AMMO.map((load) => [load.id, load]));
const references = Object.entries(SAAMI_DIMENSIONS);

const pctError = (actual, expected) => Math.abs(actual - expected) / expected;

test('every SAAMI reference names a real load and is self-consistent', () => {
  for (const [id, ref] of references) {
    const load = byId.get(id);
    assert.ok(load, `${id} is not in data/ammo.js`);
    assert.ok(ref.standard && ref.title, `${id} needs provenance`);
    if (load.category !== 'shotgun') {
      assert.ok(ref.bulletMm > 0, `${id} needs a bullet diameter`);
      assert.ok(ref.neckMm <= ref.baseMm + 0.01, `${id} neck cannot exceed base`);
    }
    assert.ok(ref.caseMm > 0 && ref.baseMm > 0 && ref.rimMm > 0, `${id} has a missing dimension`);
    assert.ok(ref.rimThicknessMm > 0 && ref.rimThicknessMm < ref.caseMm, `${id} has an impossible rim height`);
  }
});

test('dataset bullet diameters and case lengths match SAAMI', () => {
  let worstBullet = 0;
  let worstCase = 0;
  for (const [id, ref] of references) {
    const load = byId.get(id);
    if (load.category !== 'shotgun') {
      worstBullet = Math.max(worstBullet, Math.abs(load.diameterIn * 25.4 - ref.bulletMm));
    }
    worstCase = Math.max(worstCase, Math.abs(load.caseLengthMm - ref.caseMm));
  }
  // Bullet diameters are copied from published tables, so they should agree
  // closely. Case lengths use nominal designations in a few rows and run up to
  // a millimetre and a quarter off the standard's maximum-length figure.
  assert.ok(worstBullet < 0.1, `bullet diameter is ${worstBullet.toFixed(3)} mm off SAAMI`);
  assert.ok(worstCase < 1.5, `case length is ${worstCase.toFixed(3)} mm off SAAMI`);
});

test('a SAAMI reference replaces every inferred case dimension', () => {
  for (const [id, ref] of references) {
    const load = byId.get(id);
    const drawn = cartridgeGeometry({ ...load, saami: ref });
    assert.ok(Math.abs(drawn.baseMm - ref.baseMm) < 0.01, `${id} base`);
    assert.ok(Math.abs(drawn.neckMm - ref.neckMm) < 0.01, `${id} neck`);
    assert.ok(Math.abs(drawn.rimMm - ref.rimMm) < 0.01, `${id} rim`);
    assert.ok(Math.abs(drawn.rimThickness - ref.rimThicknessMm) < 0.01, `${id} rim height`);
  }
});

test('the inferred fallback stays inside its documented error band', () => {
  let worstBase = 0;
  let worstRim = 0;
  let worstNeck = 0;
  for (const [id, ref] of references) {
    const load = byId.get(id);
    const inferred = cartridgeGeometry(load); // no reference attached
    worstBase = Math.max(worstBase, pctError(inferred.baseMm, ref.baseMm));
    worstRim = Math.max(worstRim, pctError(inferred.rimMm, ref.rimMm));
    worstNeck = Math.max(worstNeck, pctError(inferred.neckMm, ref.neckMm));
  }
  // Measured on this sample: base 27%, neck 19%. Rows without a SAAMI drawing
  // are schematics; the docs state this band rather than implying precision.
  assert.ok(worstBase < 0.3, `inferred base diameter is ${(worstBase * 100).toFixed(1)}% off`);
  assert.ok(worstRim < 0.3, `inferred rim diameter is ${(worstRim * 100).toFixed(1)}% off`);
  assert.ok(worstNeck < 0.2, `inferred neck diameter is ${(worstNeck * 100).toFixed(1)}% off`);
});

test('a rebated rim draws narrower than the case body', () => {
  // .350 Legend and .450 Bushmaster are SAAMI rows where the rim is rebated.
  for (const id of ['350legend', '450bushmaster']) {
    const ref = SAAMI_DIMENSIONS[id];
    assert.ok(ref.rimMm < ref.baseMm, `${id} should be rebated`);
    const drawn = cartridgeGeometry({ ...byId.get(id), saami: ref });
    assert.ok(drawn.rimMm < drawn.baseMm, `${id} drawing should be rebated`);
  }
});
