'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

import { buildAutomaticAnalyticsEvents } from '@/src/lib/analytics-events';
import { trackAnalyticsEvent } from '@/src/lib/analytics-client';

export function AnalyticsTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedKey = useRef('');

  useEffect(() => {
    if (!pathname) {
      return;
    }

    const currentKey = `${pathname}?${searchParams.toString()}`;
    if (currentKey === lastTrackedKey.current) {
      return;
    }

    lastTrackedKey.current = currentKey;
    const events = buildAutomaticAnalyticsEvents(pathname, searchParams);
    for (const event of events) {
      trackAnalyticsEvent(event);
    }
  }, [pathname, searchParams]);

  return null;
}
