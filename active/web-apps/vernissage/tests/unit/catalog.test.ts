import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTEBOOK_LABEL, formatMemberAttribution, isEditorialMemberHandle } from '../../src/lib/member-attribution.ts';

test('editorial seed handles are labeled as notebook attributions', () => {
  assert.equal(isEditorialMemberHandle('aurelia-vale'), true);
  assert.equal(formatMemberAttribution('aurelia-vale', '2024-11-15'), `${NOTEBOOK_LABEL} · 2024-11-15`);
});

test('non-editorial handles keep their public handle in attributions', () => {
  assert.equal(isEditorialMemberHandle('real-member'), false);
  assert.equal(formatMemberAttribution('real-member', 'public'), 'real-member · public');
});
