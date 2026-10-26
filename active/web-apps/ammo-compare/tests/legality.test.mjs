/**
 * Jurisdiction-overlay checks. The rules and exceptions are checked in, so this
 * stays offline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO } from '../data/ammo.js';
import { EXCEPTIONS, JURISDICTIONS, RULES } from '../data/legality.js';
import {
  jurisdictionFor,
  jurisdictionNames,
  matchesJurisdiction,
  restrictionsFor,
} from '../lib/legality.js';

const byId = new Map(AMMO.map((load) => [load.id, load]));
const codes = new Set(JURISDICTIONS.map((jurisdiction) => jurisdiction.code));
const restricted = (id, code) =>
  restrictionsFor(byId.get(id)).some((restriction) => restriction.code === code);

test('every jurisdiction is documented and uniquely coded', () => {
  assert.deepEqual([...codes].sort(), ['CA', 'IT', 'MX']);
  for (const jurisdiction of JURISDICTIONS) {
    for (const key of ['label', 'scope', 'basis', 'url', 'checked']) {
      assert.ok(jurisdiction[key], `${jurisdiction.code} is missing ${key}`);
    }
    assert.match(jurisdiction.url, /^https:\/\//);
    assert.match(jurisdiction.checked, /^\d{4}-\d{2}$/);
    assert.equal(jurisdictionFor(jurisdiction.code).label, jurisdiction.label);
  }
  assert.equal(jurisdictionFor('ZZ'), null);
});

test('rules and exceptions stay inside the documented vocabulary', () => {
  for (const rule of RULES) {
    assert.ok(codes.has(rule.code), `rule ${rule.key} names unknown code ${rule.code}`);
    assert.ok(rule.note.length > 40, `rule ${rule.key} needs a real explanation`);
    assert.equal(typeof rule.test, 'function');
  }
  const keys = new Set(RULES.map((rule) => rule.key));
  assert.equal(keys.size, RULES.length, 'rule keys must be unique');
  for (const [id, exceptions] of Object.entries(EXCEPTIONS)) {
    assert.ok(byId.has(id), `exception for unknown load ${id}`);
    for (const code of Object.keys(exceptions)) {
      assert.ok(codes.has(code), `exception for unknown jurisdiction ${code}`);
    }
  }
});

test('.380 ACP is the case the overlay exists for', () => {
  // Mexico permits .380 ACP and not 9mm Parabellum, even though both use a
  // .355" bullet. A diameter rule alone would get this wrong.
  assert.deepEqual(restrictionsFor(byId.get('380acp')), []);
  assert.ok(restricted('9mm', 'MX'));
  assert.ok(restricted('9mm-p', 'MX'));
  assert.ok(restricted('9mm', 'IT'));
  assert.equal(byId.get('380acp').diameterIn, byId.get('9mm').diameterIn);
});

test('Mexico distinguishes .38 Special from .357 Magnum', () => {
  // Same bullet diameter, different answer: Art. 10 lists .38 Special revolvers.
  assert.ok(!restricted('38sp', 'MX'));
  assert.ok(!restricted('38sp-p', 'MX'));
  assert.ok(restricted('357mag', 'MX'));
  assert.equal(byId.get('38sp').diameterIn, byId.get('357mag').diameterIn);
});

test('the .30 calibre boundary is on the right side', () => {
  assert.ok(!restricted('308', 'MX'), '.308 Win is not above .30 calibre');
  assert.ok(!restricted('30-06', 'MX'));
  assert.ok(restricted('303-british', 'MX'), '.303 is above .30 calibre');
  assert.ok(restricted('762x39', 'MX'));
  assert.ok(restricted('50bmg', 'MX'));
  assert.ok(restricted('338lapua', 'MX'));
});

test('Canada catches the small calibres only', () => {
  for (const id of ['25acp', '32acp', '32-s-and-w', '32-s-and-w-long', '32-h-and-r-magnum', '32-naa']) {
    assert.ok(restricted(id, 'CA'), `${id} should be prohibited in Canada`);
  }
  assert.ok(!restricted('380acp', 'CA'));
  assert.ok(!restricted('9mm', 'CA'));
  // .30 Super Carry measures .312" but is not a .32 calibre designation.
  assert.ok(!restricted('30supercarry', 'CA'));
});

test('restriction records carry the text the detail view shows', () => {
  const restrictions = restrictionsFor(byId.get('9mm'));
  assert.equal(restrictions.length, 2);
  assert.deepEqual(restrictions.map((restriction) => restriction.code), ['MX', 'IT']);
  for (const restriction of restrictions) {
    assert.ok(restriction.label && restriction.note && restriction.basis);
    assert.doesNotMatch(restriction.note, /<[a-z/]|\{\{|\[\[/i, 'notes must be plain sentences');
  }
  assert.equal(jurisdictionNames(restrictions), 'Mexico, Italy');
  assert.equal(jurisdictionNames([]), '');
});

test('the filter is a gate, not a score', () => {
  assert.ok(matchesJurisdiction(byId.get('9mm'), 'all'));
  assert.ok(matchesJurisdiction(byId.get('9mm'), null));
  assert.ok(!matchesJurisdiction(byId.get('9mm'), 'MX'));
  assert.ok(matchesJurisdiction(byId.get('380acp'), 'MX'));
  assert.ok(matchesJurisdiction(byId.get('380acp'), 'IT'));
  assert.ok(matchesJurisdiction(byId.get('380acp'), 'CA'));

  const legalInMx = AMMO.filter((load) => matchesJurisdiction(load, 'MX')).length;
  const legalInCa = AMMO.filter((load) => matchesJurisdiction(load, 'CA')).length;
  assert.ok(legalInMx > 100 && legalInMx < AMMO.length, `Mexico should filter some loads (${legalInMx})`);
  assert.ok(legalInCa > AMMO.length - 20, `Canada should only catch a handful (${legalInCa})`);
  // Every restricted load is still in the dataset; the filter never invents rows.
  const restrictedInMx = AMMO.filter((load) => restricted(load.id, 'MX')).length;
  assert.equal(legalInMx + restrictedInMx, AMMO.length);
});
