/**
 * Designer-data checks. The overlay is checked in, so this stays offline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { INVENTORS, inventorFor } from '../data/inventors.js';

const ammoIds = new Set(AMMO.map((load) => load.id));

test('designer records are keyed to real loads', () => {
  for (const id of Object.keys(INVENTORS)) {
    assert.ok(ammoIds.has(id), `${id} is not a load id`);
  }
});

test('the overlay covers most of the catalogue', () => {
  const covered = AMMO.filter((load) => INVENTORS[load.id]).length;
  assert.ok(covered >= 260, `expected broad designer coverage, got ${covered}/${AMMO.length}`);
});

test('well-known cartridges name their designer', () => {
  assert.match(inventorFor('45acp').name, /Browning/);
  assert.match(inventorFor('9mm').name, /Luger/);
  assert.match(inventorFor('357mag').name, /Elmer Keith/);
  assert.match(inventorFor('50bmg').name, /Winchester/);
  assert.match(inventorFor('223').name, /Remington/);
  assert.match(inventorFor('762x39').name, /Soviet/);
  assert.match(inventorFor('338lapua').name, /Lapua/);
});

test('+P loads inherit their parent cartridge designer', () => {
  assert.deepEqual(inventorFor('9mm-p'), inventorFor('9mm'));
  assert.deepEqual(inventorFor('38sp-p'), inventorFor('38sp'));
  assert.deepEqual(inventorFor('45acp-p'), inventorFor('45acp'));
});

test('unknown ids return null instead of a placeholder', () => {
  assert.equal(inventorFor('not-a-cartridge'), null);
  assert.equal(inventorFor(''), null);
});

test('designer strings are clean enough to render', () => {
  for (const [id, record] of Object.entries(INVENTORS)) {
    assert.equal(typeof record.name, 'string', `${id} name`);
    assert.ok(record.name.trim().length > 0, `${id} has an empty name`);
    assert.ok(record.name.length <= 100, `${id} name is unexpectedly long`);
    assert.ok(!/[{}[\]<>]/.test(record.name), `${id} still contains wiki markup: ${record.name}`);
    assert.ok(!/&[a-z]+;/i.test(record.name), `${id} contains an HTML entity: ${record.name}`);
    assert.ok(
      record.page === null || (typeof record.page === 'string' && record.page.trim().length > 0),
      `${id} has an invalid source page`,
    );
  }
});
