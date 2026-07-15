import test from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_BUNDLES, getScanBundle } from '../src/scan-bundles.mjs';

test('scan bundles have unique ids and non-empty analysis lists', () => {
  const ids = SCAN_BUNDLES.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const b of SCAN_BUNDLES) {
    assert.ok(b.analyses.length > 0);
  }
});

test('getScanBundle resolves known ids and falls back to quick', () => {
  assert.equal(getScanBundle('full').id, 'full');
  assert.equal(getScanBundle('missing').id, 'quick');
});

test('full bundle is a superset of quick characterize', () => {
  const quick = new Set(getScanBundle('quick').analyses);
  const full = new Set(getScanBundle('full').analyses);
  for (const a of quick) assert.ok(full.has(a));
});