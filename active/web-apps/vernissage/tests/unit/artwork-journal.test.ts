import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeArtworkJournalEntry,
  parseArtworkJournalState,
  serializeArtworkJournalState,
  updateArtworkJournalState
} from '../../src/lib/artwork-journal.ts';

test('normalizeArtworkJournalEntry trims notes and drops empty entries', () => {
  assert.equal(normalizeArtworkJournalEntry({ favorited: false, note: '   ' }, '2026-04-14T00:00:00.000Z'), null);
  assert.deepEqual(
    normalizeArtworkJournalEntry({ favorited: true, note: '  luminous fog  ' }, '2026-04-14T00:00:00.000Z'),
    {
      favorited: true,
      note: 'luminous fog',
      updatedAt: '2026-04-14T00:00:00.000Z'
    }
  );
});

test('parseArtworkJournalState ignores invalid payloads and keeps valid entries', () => {
  assert.deepEqual(parseArtworkJournalState('{not-json'), {});
  assert.deepEqual(
    parseArtworkJournalState(
      JSON.stringify({
        'water-lilies-1906': { favorited: true, note: '  mist and lilies  ', updatedAt: '2026-04-14T00:00:00.000Z' },
        'empty-work': { favorited: false, note: '   ' }
      })
    ),
    {
      'water-lilies-1906': {
        favorited: true,
        note: 'mist and lilies',
        updatedAt: '2026-04-14T00:00:00.000Z'
      }
    }
  );
});

test('updateArtworkJournalState adds, updates, and removes artwork entries', () => {
  const firstState = updateArtworkJournalState({}, 'water-lilies-1906', { favorited: true, note: '' }, '2026-04-14T00:00:00.000Z');
  assert.deepEqual(firstState, {
    'water-lilies-1906': {
      favorited: true,
      note: '',
      updatedAt: '2026-04-14T00:00:00.000Z'
    }
  });

  const secondState = updateArtworkJournalState(
    firstState,
    'water-lilies-1906',
    { favorited: false, note: '  still thinking about the reflections  ' },
    '2026-04-14T00:05:00.000Z'
  );
  assert.deepEqual(secondState, {
    'water-lilies-1906': {
      favorited: false,
      note: 'still thinking about the reflections',
      updatedAt: '2026-04-14T00:05:00.000Z'
    }
  });

  const clearedState = updateArtworkJournalState(
    secondState,
    'water-lilies-1906',
    { favorited: false, note: '' },
    '2026-04-14T00:10:00.000Z'
  );
  assert.deepEqual(clearedState, {});
  assert.equal(serializeArtworkJournalState(secondState).includes('still thinking about the reflections'), true);
});
