import assert from 'node:assert/strict';
import test from 'node:test';

import { getClientIp, rateLimitHeaders, resetRateLimitStore, takeRateLimitHit } from '../../src/lib/rate-limit.ts';

test('takeRateLimitHit blocks after the configured number of hits in the window', () => {
  resetRateLimitStore();

  const first = takeRateLimitHit('feedback:127.0.0.1', 2, 60_000, 1_000);
  const second = takeRateLimitHit('feedback:127.0.0.1', 2, 60_000, 2_000);
  const third = takeRateLimitHit('feedback:127.0.0.1', 2, 60_000, 3_000);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterSeconds, 58);
  assert.deepEqual(rateLimitHeaders(third), {
    'Retry-After': '58',
    'X-RateLimit-Remaining': '0'
  });
});

test('takeRateLimitHit resets after the window elapses', () => {
  resetRateLimitStore();

  takeRateLimitHit('reviews:user-1', 1, 1_000, 0);
  const afterWindow = takeRateLimitHit('reviews:user-1', 1, 1_000, 1_500);

  assert.equal(afterWindow.ok, true);
  assert.equal(afterWindow.remaining, 0);
});

test('getClientIp prefers forwarded headers and falls back safely', () => {
  const fromForwardedFor = getClientIp({
    headers: new Headers({ 'x-forwarded-for': '203.0.113.10, 198.51.100.7' })
  });
  const fromRealIp = getClientIp({
    headers: new Headers({ 'x-real-ip': '198.51.100.8' })
  });
  const unknown = getClientIp({
    headers: new Headers()
  });

  assert.equal(fromForwardedFor, '203.0.113.10');
  assert.equal(fromRealIp, '198.51.100.8');
  assert.equal(unknown, 'unknown');
});
