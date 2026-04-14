import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArtistRequestFeedbackText } from '../../src/lib/artist-requests.ts';

test('buildArtistRequestFeedbackText formats a structured artist request', () => {
  assert.equal(
    buildArtistRequestFeedbackText({
      artistName: '  Hilma af Klint ',
      movement: ' early abstraction ',
      starterWorks: ' The Ten Largest ',
      rationale: '  Her work changes how the catalog tells the story of modernism. '
    }),
    [
      'Artist request: Hilma af Klint',
      'Movement or scene: early abstraction',
      'Works to start with: The Ten Largest',
      'Why add them: Her work changes how the catalog tells the story of modernism.'
    ].join('\n')
  );
});

test('buildArtistRequestFeedbackText skips blank optional fields', () => {
  assert.equal(
    buildArtistRequestFeedbackText({
      artistName: 'Sofonisba Anguissola',
      movement: '',
      starterWorks: '   ',
      rationale: 'Important portraiture and an obvious catalog gap.'
    }),
    [
      'Artist request: Sofonisba Anguissola',
      'Why add them: Important portraiture and an obvious catalog gap.'
    ].join('\n')
  );
});
