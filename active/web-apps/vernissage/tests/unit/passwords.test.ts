import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPassword } from '../../src/lib/passwords.ts';

test('hashPassword and verifyPassword round-trip a valid password', async () => {
  const passwordHash = await hashPassword('a-curator-secret');

  assert.match(passwordHash, /^scrypt:/);
  assert.equal(await verifyPassword('a-curator-secret', passwordHash), true);
  assert.equal(await verifyPassword('not-the-secret', passwordHash), false);
});
