import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRegistrationSubmission } from '../../src/lib/account-registration.ts';

test('parseRegistrationSubmission defaults the display name to the normalized handle', () => {
  const formData = new FormData();
  formData.set('handle', '  Mucha Fan  ');
  formData.set('password', 'ornamented-secret');

  const parsed = parseRegistrationSubmission(formData);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      name: 'mucha-fan',
      handle: 'mucha-fan',
      password: 'ornamented-secret',
      callbackUrl: '/reviews/new'
    });
  }
});

test('parseRegistrationSubmission accepts an explicit display name and callback', () => {
  const formData = new FormData();
  formData.set('name', 'Aurelia Vale');
  formData.set('handle', 'aurelia-vale');
  formData.set('password', 'ornamented-secret');
  formData.set('callbackUrl', '/artworks/water-lilies-1906');

  const parsed = parseRegistrationSubmission(formData);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, 'Aurelia Vale');
    assert.equal(parsed.value.callbackUrl, '/artworks/water-lilies-1906');
  }
});

test('parseRegistrationSubmission rejects short passwords and invalid handles', () => {
  const formData = new FormData();
  formData.set('handle', '??');
  formData.set('password', 'short');

  assert.deepEqual(parseRegistrationSubmission(formData), { ok: false, error: 'invalid' });
});
