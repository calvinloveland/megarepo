import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReviewComposerSelection, type ComposerTargetCollection } from '../../app/reviews/new/review-composer.ts';

const targetCollections: ComposerTargetCollection[] = [
  {
    value: 'artwork',
    label: 'Artwork',
    items: [
      { value: 'water-lilies-1906', label: 'Water Lilies' },
      { value: 'impression-sunrise', label: 'Impression, Sunrise' }
    ]
  },
  {
    value: 'artist',
    label: 'Artist',
    items: [{ value: 'claude-monet', label: 'Claude Monet' }]
  }
];

test('resolveReviewComposerSelection keeps a matching target slug', () => {
  const selection = resolveReviewComposerSelection(targetCollections, 'artwork', 'impression-sunrise');

  assert.equal(selection.targetType, 'artwork');
  assert.equal(selection.targetSlug, 'impression-sunrise');
  assert.equal(selection.activeCollection?.label, 'Artwork');
});

test('resolveReviewComposerSelection falls back to the first entry in the chosen type', () => {
  const selection = resolveReviewComposerSelection(targetCollections, 'artist', 'water-lilies-1906');

  assert.equal(selection.targetType, 'artist');
  assert.equal(selection.targetSlug, 'claude-monet');
  assert.equal(selection.activeCollection?.label, 'Artist');
});

test('resolveReviewComposerSelection falls back to the first populated type when the request is unknown', () => {
  const selection = resolveReviewComposerSelection(targetCollections, 'visit', 'saturday-at-the-aic');

  assert.equal(selection.targetType, 'artwork');
  assert.equal(selection.targetSlug, 'water-lilies-1906');
  assert.equal(selection.activeCollection?.label, 'Artwork');
});
