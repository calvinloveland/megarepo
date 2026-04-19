'use client';

import type { AnalyticsEventPayload } from '@/src/lib/analytics-events';

const sessionStorageKey = 'vernissage-analytics-session-id';

function getClientSessionId() {
  if (typeof window === 'undefined') {
    return '';
  }

  const existing = window.sessionStorage.getItem(sessionStorageKey);
  if (existing) {
    return existing;
  }

  const created = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(sessionStorageKey, created);
  return created;
}

export function trackAnalyticsEvent(event: AnalyticsEventPayload) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = JSON.stringify({
    ...event,
    sessionId: event.sessionId ?? getClientSessionId(),
    occurredAt: event.occurredAt ?? new Date().toISOString()
  });

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/api/analytics', blob);
    return;
  }

  void fetch('/api/analytics', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: payload,
    keepalive: true
  });
}
