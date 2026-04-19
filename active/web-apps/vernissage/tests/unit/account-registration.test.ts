import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CALLBACK_URL, MIN_PASSWORD_LENGTH, normalizeCallbackUrl, parseRegistrationSubmission } from '../../src/lib/account-registration.ts';

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
      callbackUrl: DEFAULT_CALLBACK_URL
    });
  }
});

test('parseRegistrationSubmission ignores a supplied display name and keeps the handle as the public name', () => {
  const formData = new FormData();
  formData.set('name', 'Mucha Fan');
  formData.set('handle', 'mucha-fan');
  formData.set('password', 'ornamented-secret');
  formData.set('callbackUrl', '/artworks/water-lilies-1906');

  const parsed = parseRegistrationSubmission(formData);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, 'mucha-fan');
    assert.equal(parsed.value.callbackUrl, '/artworks/water-lilies-1906');
  }
});

test('parseRegistrationSubmission rejects short passwords and invalid handles', () => {
  const formData = new FormData();
  formData.set('handle', '??');
  formData.set('password', 'short');

  assert.deepEqual(parseRegistrationSubmission(formData), { ok: false, error: 'invalid' });
});

test('normalizeCallbackUrl only allows local paths', () => {
  assert.equal(normalizeCallbackUrl('/artworks/water-lilies-1906'), '/artworks/water-lilies-1906');
  assert.equal(normalizeCallbackUrl('https://evil.example/phish'), DEFAULT_CALLBACK_URL);
  assert.equal(normalizeCallbackUrl('//evil.example/phish'), DEFAULT_CALLBACK_URL);
});

test(`parseRegistrationSubmission requires passwords with at least ${MIN_PASSWORD_LENGTH} characters`, () => {
  const formData = new FormData();
  formData.set('handle', 'mucha-fan');
  formData.set('password', '12345678901');

  assert.deepEqual(parseRegistrationSubmission(formData), { ok: false, error: 'invalid' });
});
