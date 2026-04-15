import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTEBOOK_LABEL, formatMemberAttribution, isEditorialMemberHandle } from '../../src/lib/member-attribution.ts';

test('editorial notebook attribution is disabled when there is no seeded notebook account', () => {
  assert.equal(isEditorialMemberHandle('vernissage-notebook'), false);
  assert.notEqual(formatMemberAttribution('vernissage-notebook', '2024-11-15'), `${NOTEBOOK_LABEL} · 2024-11-15`);
});

test('non-editorial handles keep their public handle in attributions', () => {
  assert.equal(isEditorialMemberHandle('real-member'), false);
  assert.equal(formatMemberAttribution('real-member', 'public'), 'real-member · public');
});
