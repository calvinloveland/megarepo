import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { createAnalyticsEvent } from '@/src/lib/analytics';
import {
  analyticsEventTypes,
  analyticsPageTypes,
  analyticsTargetTypes,
  type AnalyticsEventPayload,
  type AnalyticsMetadataValue
} from '@/src/lib/analytics-events';
import { authOptions } from '@/src/lib/auth';
import { getClientIp, rateLimitHeaders, takeRateLimitHit } from '@/src/lib/rate-limit';

const ANALYTICS_WINDOW_MS = 15 * 60 * 1000;
const ANALYTICS_POST_LIMIT = 240;

function asTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizePath(value: unknown) {
  const path = asTrimmedString(value);
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.length > 1000) {
    return '';
  }

  return path;
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const sanitized: Record<string, AnalyticsMetadataValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 80) {
      continue;
    }

    if (typeof entry === 'string') {
      sanitized[key] = entry.slice(0, 200);
    } else if (typeof entry === 'number' || typeof entry === 'boolean' || entry === null) {
      sanitized[key] = entry;
    }
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

export async function POST(request: NextRequest) {
  const rateLimit = takeRateLimitHit(`analytics:${getClientIp(request)}`, ANALYTICS_POST_LIMIT, ANALYTICS_WINDOW_MS);
  if (!rateLimit.ok) {
    return NextResponse.json({ message: 'Too many analytics events.' }, {
      status: 429,
      headers: rateLimitHeaders(rateLimit)
    });
  }

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return new Response('Invalid analytics payload', { status: 400 });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return new Response('Invalid analytics payload', { status: 400 });
  }

  const payload = data as AnalyticsEventPayload;
  const eventType = payload.eventType;
  if (!analyticsEventTypes.includes(eventType)) {
    return new Response('Invalid analytics event type', { status: 400 });
  }

  const pageType = payload.pageType;
  if (pageType && !analyticsPageTypes.includes(pageType)) {
    return new Response('Invalid analytics page type', { status: 400 });
  }

  const targetType = payload.targetType;
  if (targetType && !analyticsTargetTypes.includes(targetType)) {
    return new Response('Invalid analytics target type', { status: 400 });
  }

  const session = await getServerSession(authOptions);
  await createAnalyticsEvent({
    eventType,
    pageType,
    path: sanitizePath(payload.path),
    targetType,
    targetSlug: asTrimmedString(payload.targetSlug).slice(0, 160) || undefined,
    sessionId: asTrimmedString(payload.sessionId).slice(0, 80) || undefined,
    memberHandle: session?.user?.handle,
    occurredAt: asTrimmedString(payload.occurredAt) || undefined,
    metadata: sanitizeMetadata(payload.metadata)
  });

  return NextResponse.json({ ok: true });
}
