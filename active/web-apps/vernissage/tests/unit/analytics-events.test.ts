import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAutomaticAnalyticsEvents, inferAnalyticsPageType } from '../../src/lib/analytics-events.ts';

test('inferAnalyticsPageType recognizes key Vernissage routes', () => {
  assert.equal(inferAnalyticsPageType('/'), 'home');
  assert.equal(inferAnalyticsPageType('/search'), 'search');
  assert.equal(inferAnalyticsPageType('/artists/claude-monet'), 'artist');
  assert.equal(inferAnalyticsPageType('/artworks/water-lilies-1906'), 'artwork');
  assert.equal(inferAnalyticsPageType('/members/curatorbot'), 'member');
  assert.equal(inferAnalyticsPageType('/reviews/new'), 'review-compose');
});

test('buildAutomaticAnalyticsEvents creates search and detail-view events', () => {
  const searchEvents = buildAutomaticAnalyticsEvents(
    '/search',
    new URLSearchParams({ query: 'monet', year: '1906' })
  );
  const artistEvents = buildAutomaticAnalyticsEvents('/artists/claude-monet', new URLSearchParams());

  assert.equal(searchEvents[0]?.eventType, 'page_view');
  assert.ok(searchEvents.some((event) => event.eventType === 'search_performed'));
  assert.ok(artistEvents.some((event) => event.eventType === 'artist_viewed' && event.targetSlug === 'claude-monet'));
});

test('buildAutomaticAnalyticsEvents creates join, signin, and review-start events', () => {
  const joinEvents = buildAutomaticAnalyticsEvents('/join', new URLSearchParams());
  const signinEvents = buildAutomaticAnalyticsEvents('/signin', new URLSearchParams());
  const reviewEvents = buildAutomaticAnalyticsEvents('/reviews/new', new URLSearchParams());

  assert.ok(joinEvents.some((event) => event.eventType === 'join_started'));
  assert.ok(signinEvents.some((event) => event.eventType === 'signin_started'));
  assert.ok(reviewEvents.some((event) => event.eventType === 'review_started'));
});
