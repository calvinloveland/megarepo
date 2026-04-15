import assert from 'node:assert/strict';
import test from 'node:test';

import { getAverageRating } from '../../src/lib/artist-profile.ts';

test('getAverageRating returns null when there are no ratings yet', () => {
  assert.equal(getAverageRating([]), null);
});

test('getAverageRating averages the supplied ratings', () => {
  assert.equal(getAverageRating([{ rating: 4.2 }, { rating: 4.8 }, { rating: 5 }]), 4.666666666666667);
});
