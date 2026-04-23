import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSiteUrl } from '../../src/lib/site-url.ts';

test('resolveSiteUrl falls back to the production hostname', () => {
  assert.equal(resolveSiteUrl(undefined), 'https://thevernissage.art');
  assert.equal(resolveSiteUrl('   '), 'https://thevernissage.art');
});

test('resolveSiteUrl trims a single trailing slash from configured values', () => {
  assert.equal(resolveSiteUrl('https://thevernissage.art/'), 'https://thevernissage.art');
  assert.equal(resolveSiteUrl('https://example.com'), 'https://example.com');
});
