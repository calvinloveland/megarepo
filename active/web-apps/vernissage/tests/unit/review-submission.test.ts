import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReviewExcerpt,
  normalizeHandle,
  parseReviewSubmission,
  parseReviewTags
} from '../../src/lib/review-submission.ts';

const allowedTargets = {
  artwork: new Set(['water-lilies-1906']),
  artist: new Set(['claude-monet']),
  exhibition: new Set(['light-and-color-revolution']),
  visit: new Set(['saturday-at-the-aic'])
};

test('normalizeHandle creates stable lowercase handles', () => {
  assert.equal(normalizeHandle('  Aurelia Vale  '), 'aurelia-vale');
  assert.equal(normalizeHandle('Mucha__Fan!!'), 'mucha-fan');
});

test('parseReviewTags trims, normalizes, and deduplicates tags', () => {
  assert.deepEqual(parseReviewTags(' Light, symbolism, light ,  atmosphere '), [
    { slug: 'light', name: 'light' },
    { slug: 'symbolism', name: 'symbolism' },
    { slug: 'atmosphere', name: 'atmosphere' }
  ]);
});

test('buildReviewExcerpt compresses and truncates long copy cleanly', () => {
  const excerpt = buildReviewExcerpt('word '.repeat(80), 80);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(excerpt.length <= 81);
});

test('parseReviewSubmission validates and returns a normalized payload', () => {
  const formData = new FormData();
  formData.set('targetType', 'artwork');
  formData.set('targetSlug', 'water-lilies-1906');
  formData.set('title', 'Monet at the threshold');
  formData.set('body', 'Standing before the lilies, the surface seems to breathe in color and reflection until the room itself starts to soften around the frame.');
  formData.set('rating', '4.5');
  formData.set('spoiler', 'no');
  formData.set('tags', 'Light, Reflection');

  const parsed = parseReviewSubmission(formData, allowedTargets);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.targetType, 'artwork');
    assert.equal(parsed.value.rating, 4.5);
    assert.deepEqual(parsed.value.tags, [
      { slug: 'light', name: 'light' },
      { slug: 'reflection', name: 'reflection' }
    ]);
  }
});

test('parseReviewSubmission rejects invalid targets', () => {
  const formData = new FormData();
  formData.set('targetType', 'artwork');
  formData.set('targetSlug', 'unknown-work');
  formData.set('title', 'Bad target');
  formData.set('body', 'This body is long enough to satisfy the validator but the target is invalid for the catalog lookup.');
  formData.set('rating', '4');

  const parsed = parseReviewSubmission(formData, allowedTargets);
  assert.deepEqual(parsed, { ok: false, error: 'Choose a valid catalogue entry.' });
});
