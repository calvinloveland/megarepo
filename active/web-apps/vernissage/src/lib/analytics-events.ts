export const analyticsEventTypes = [
  'page_view',
  'search_performed',
  'artist_viewed',
  'artwork_viewed',
  'join_started',
  'join_completed',
  'signin_started',
  'signin_completed',
  'favorite_artist',
  'favorite_artwork',
  'follow_member',
  'review_started',
  'review_submitted',
  'feedback_submitted'
] as const;

export const analyticsPageTypes = [
  'home',
  'search',
  'artist',
  'artwork',
  'member',
  'feed',
  'join',
  'signin',
  'review-compose',
  'exhibition',
  'list',
  'contact',
  'privacy',
  'terms',
  'other'
] as const;

export const analyticsTargetTypes = ['artist', 'artwork', 'exhibition', 'visit', 'member'] as const;

export type AnalyticsEventType = (typeof analyticsEventTypes)[number];
export type AnalyticsPageType = (typeof analyticsPageTypes)[number];
export type AnalyticsTargetType = (typeof analyticsTargetTypes)[number];

export type AnalyticsMetadataValue = string | number | boolean | null;

export type AnalyticsEventPayload = {
  eventType: AnalyticsEventType;
  pageType?: AnalyticsPageType;
  path?: string;
  targetType?: AnalyticsTargetType;
  targetSlug?: string;
  sessionId?: string;
  memberHandle?: string | null;
  occurredAt?: string;
  metadata?: Record<string, AnalyticsMetadataValue>;
};

export function inferAnalyticsPageType(pathname: string): AnalyticsPageType {
  if (pathname === '/') return 'home';
  if (pathname === '/search') return 'search';
  if (pathname.startsWith('/artists/')) return 'artist';
  if (pathname.startsWith('/artworks/')) return 'artwork';
  if (pathname.startsWith('/members/')) return 'member';
  if (pathname === '/feed') return 'feed';
  if (pathname === '/join') return 'join';
  if (pathname === '/signin') return 'signin';
  if (pathname === '/reviews/new') return 'review-compose';
  if (pathname.startsWith('/exhibitions/')) return 'exhibition';
  if (pathname.startsWith('/lists/')) return 'list';
  if (pathname === '/contact') return 'contact';
  if (pathname === '/privacy') return 'privacy';
  if (pathname === '/terms') return 'terms';
  return 'other';
}

export function buildTrackedPath(pathname: string, search: string) {
  if (!search) {
    return pathname;
  }

  return `${pathname}${search.startsWith('?') ? search : `?${search}`}`;
}

export function buildAutomaticAnalyticsEvents(pathname: string, searchParams: URLSearchParams) {
  const path = buildTrackedPath(pathname, searchParams.toString());
  const pageType = inferAnalyticsPageType(pathname);
  const events: AnalyticsEventPayload[] = [{ eventType: 'page_view', pageType, path }];

  if (pageType === 'artist') {
    const slug = pathname.split('/')[2];
    if (slug) {
      events.push({
        eventType: 'artist_viewed',
        pageType,
        path,
        targetType: 'artist',
        targetSlug: slug
      });
    }
  }

  if (pageType === 'artwork') {
    const slug = pathname.split('/')[2];
    if (slug) {
      events.push({
        eventType: 'artwork_viewed',
        pageType,
        path,
        targetType: 'artwork',
        targetSlug: slug
      });
    }
  }

  if (pageType === 'search') {
    const query = searchParams.get('query')?.trim() ?? '';
    const movement = searchParams.get('movement')?.trim() ?? '';
    const medium = searchParams.get('medium')?.trim() ?? '';
    const year = searchParams.get('year')?.trim() ?? '';
    if (query || movement || medium || year) {
      events.push({
        eventType: 'search_performed',
        pageType,
        path,
        metadata: {
          hasQuery: Boolean(query),
          movement: movement || null,
          medium: medium || null,
          year: year || null
        }
      });
    }
  }

  if (pageType === 'join') {
    events.push({ eventType: 'join_started', pageType, path });
  }

  if (pageType === 'signin') {
    events.push({ eventType: 'signin_started', pageType, path });
  }

  if (pageType === 'review-compose') {
    events.push({ eventType: 'review_started', pageType, path });
  }

  return events;
}
