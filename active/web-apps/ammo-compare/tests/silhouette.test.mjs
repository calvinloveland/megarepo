/**
 * Cartridge silhouette tests.
 *
 * Offline like the rest of the suite: the drawings are generated from the
 * checked-in dataset, so these assertions need no browser, server, or network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { cartridgeExtents, cartridgeGeometry, cartridgeSvg } from '../lib/cartridge-svg.js';

const EXTENTS = cartridgeExtents(AMMO);
const byId = new Map(AMMO.map((load) => [load.id, load]));

test('every load produces a finite silhouette', () => {
  for (const load of AMMO) {
    const svg = cartridgeSvg(load, EXTENTS);
    assert.match(svg, /^<svg class="cart"/, `${load.id} is not an inline svg`);
    assert.doesNotMatch(svg, /NaN|Infinity|undefined/, `${load.id} emitted a bad number`);
    assert.match(svg, /<path|<rect/, `${load.id} has no drawn shape`);
  }
});

test('all silhouettes share one viewBox so rows are comparable', () => {
  const boxes = new Set(AMMO.map((load) => cartridgeSvg(load, EXTENTS).match(/viewBox="([^"]+)"/)[1]));
  assert.equal(boxes.size, 1);
  assert.ok(EXTENTS.length > 0 && EXTENTS.radius > 0);
});

test('silhouettes are self-contained', () => {
  for (const load of AMMO) {
    const svg = cartridgeSvg(load, EXTENTS);
    assert.doesNotMatch(svg, /https?:|url\(|<script|<image/i, `${load.id} pulls in an external resource`);
  }
});

test('drawn size tracks the real dimensions', () => {
  const short = cartridgeGeometry(byId.get('22short'));
  const pistol = cartridgeGeometry(byId.get('9mm'));
  const rifle = cartridgeGeometry(byId.get('50bmg'));
  const giant = cartridgeGeometry(byId.get('950-jdj'));

  assert.ok(short.totalLength < pistol.totalLength, '.22 Short should be shorter than 9mm');
  assert.ok(pistol.totalLength < rifle.totalLength, '9mm should be shorter than .50 BMG');
  assert.ok(giant.caseMm > pistol.caseMm * 3, '.950 JDJ case should dwarf a 9mm case');
  assert.ok(giant.bulletMm > pistol.bulletMm * 2, '.950 JDJ bullet should be much wider');
});

test('bottleneck inference separates necked rifle rounds from straight walls', () => {
  assert.equal(cartridgeGeometry(byId.get('223')).bottleneck, true);
  assert.equal(cartridgeGeometry(byId.get('45-70')).bottleneck, false);
  assert.equal(cartridgeGeometry(byId.get('9mm')).bottleneck, false);
});

test('rimmed cartridges get a wider rim than body', () => {
  const rimmed = cartridgeGeometry(byId.get('762x54r'));
  const rimless = cartridgeGeometry(byId.get('308'));
  assert.ok(rimmed.rimMm > rimmed.baseMm);
  assert.ok(rimless.rimMm < rimmed.rimMm);
});

test('shotgun rows draw a hull with no protruding bullet', () => {
  for (const load of AMMO.filter((l) => l.category === 'shotgun')) {
    const svg = cartridgeSvg(load, EXTENTS);
    assert.match(svg, /class="cart-hull"/, `${load.id} needs a hull`);
    assert.doesNotMatch(svg, /class="cart-bullet"/, `${load.id} should not show a bullet`);
    assert.equal(cartridgeGeometry(load).exposed, 0);
  }
});

test('missing metadata falls back instead of breaking the drawing', () => {
  const bare = cartridgeGeometry({ name: 'Mystery', category: 'pistol', bulletGr: 100, velocityFps: 900 });
  assert.ok(bare.bulletMm > 0);
  assert.ok(bare.caseMm > 0);
  assert.ok(bare.totalLength > 0);
  assert.ok(Number.isFinite(bare.maxRadius));
});

test('geometry is deterministic', () => {
  const load = byId.get('9mm');
  assert.equal(cartridgeSvg(load, EXTENTS), cartridgeSvg(load, EXTENTS));
  assert.deepEqual(cartridgeGeometry(load), cartridgeGeometry(load));
});
