import assert from 'node:assert/strict';
import test from 'node:test';

import { getArtistAverageRating } from '../../src/lib/artist-profile.ts';

test('getArtistAverageRating returns null when no works are catalogued yet', () => {
  assert.equal(getArtistAverageRating([]), null);
});

test('getArtistAverageRating averages the artist work ratings', () => {
  assert.equal(getArtistAverageRating([{ rating: 4.2 }, { rating: 4.8 }, { rating: 5 }]), 4.666666666666667);
});
