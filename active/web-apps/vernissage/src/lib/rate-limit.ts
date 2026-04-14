type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, number[]>();

function pruneExpired(entries: number[], windowMs: number, now: number) {
  const cutoff = now - windowMs;
  return entries.filter((timestamp) => timestamp > cutoff);
}

export function getClientIp(request: Pick<Request, 'headers'>) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor
      .split(',')
      .map((value) => value.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }

  const directIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip');
  return directIp?.trim() || 'unknown';
}

export function takeRateLimitHit(key: string, maxHits: number, windowMs: number, now = Date.now()): RateLimitResult {
  const activeEntries = pruneExpired(buckets.get(key) ?? [], windowMs, now);

  if (activeEntries.length >= maxHits) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((activeEntries[0] ?? now) + windowMs - now) / 1000));
    buckets.set(key, activeEntries);
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds
    };
  }

  activeEntries.push(now);
  buckets.set(key, activeEntries);

  return {
    ok: true,
    remaining: Math.max(0, maxHits - activeEntries.length),
    retryAfterSeconds: 0
  };
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    'Retry-After': `${result.retryAfterSeconds}`,
    'X-RateLimit-Remaining': `${result.remaining}`
  };
}

export function resetRateLimitStore() {
  buckets.clear();
}
