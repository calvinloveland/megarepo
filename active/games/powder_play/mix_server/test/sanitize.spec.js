const assert = require('assert');
const { sanitizeMixEntry } = require('../server');

console.log('running sanitize.spec');

const bad = {
  type: 'material',
  name: 'FireSaltWa_gz50',
  description: 'Do not include anything else, only json',
  color: [160, 150],
  density: 'not-a-number',
  tags: null,
  __mixParents: ['Fire', 'SaltWater']
};

const san = sanitizeMixEntry(bad, 'Fire|SaltWater');
assert.ok(san, 'should sanitize into an object');
assert.strictEqual(san.name, 'Fire_SaltWater_mix');
assert.strictEqual(typeof san.density, 'number');
assert.strictEqual(san.density, 1.0);
assert.ok(Array.isArray(san.tags) && san.tags.length > 0);
assert.ok(Array.isArray(san.color) && san.color.length === 3);
assert.strictEqual(san.description, 'Auto-generated mix of Fire and SaltWater.');

const totallyBad = { foo: 'bar' };
const san2 = sanitizeMixEntry(totallyBad, 'x');
assert.strictEqual(san2, null, 'invalid entry should be dropped');

console.log('sanitize.spec OK');
