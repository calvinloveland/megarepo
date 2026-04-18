import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseFavoriteArtistsState,
  serializeFavoriteArtistsState,
  updateFavoriteArtistsState
} from '../../src/lib/artist-favorites.ts';

test('parseFavoriteArtistsState ignores invalid payloads and normalizes duplicates', () => {
  assert.deepEqual(parseFavoriteArtistsState('{not-json'), []);
  assert.deepEqual(
    parseFavoriteArtistsState(JSON.stringify([' claude-monet ', 'claude-monet', '', 42, 'mark-rothko'])),
    ['claude-monet', 'mark-rothko']
  );
});

test('updateFavoriteArtistsState adds and removes favorite artists cleanly', () => {
  const firstState = updateFavoriteArtistsState([], 'claude-monet', true);
  assert.deepEqual(firstState, ['claude-monet']);

  const secondState = updateFavoriteArtistsState(firstState, 'mark-rothko', true);
  assert.deepEqual(secondState, ['claude-monet', 'mark-rothko']);

  const clearedState = updateFavoriteArtistsState(secondState, 'claude-monet', false);
  assert.deepEqual(clearedState, ['mark-rothko']);
  assert.equal(serializeFavoriteArtistsState(clearedState), '["mark-rothko"]');
});
