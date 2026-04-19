'use client';

import Link from 'next/link';
import { useState } from 'react';
import { trackAnalyticsEvent } from '@/src/lib/analytics-client';

type FavoriteToggleButtonProps = {
  targetType: 'artist' | 'artwork';
  targetSlug: string;
  targetName: string;
  initialFavorited: boolean;
  databaseReady: boolean;
  signInHref?: string;
};

type FavoriteStatus = {
  tone: 'success' | 'error';
  text: string;
};

function nounFor(targetType: FavoriteToggleButtonProps['targetType']) {
  return targetType === 'artist' ? 'artist' : 'artwork';
}

export function FavoriteToggleButton({
  targetType,
  targetSlug,
  targetName,
  initialFavorited,
  databaseReady,
  signInHref
}: FavoriteToggleButtonProps) {
  const [isFavorited, setIsFavorited] = useState(initialFavorited);
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<FavoriteStatus | null>(null);
  const noun = nounFor(targetType);

  async function toggleFavorite(nextFavorited: boolean) {
    setIsPending(true);
    setStatus(null);

    try {
      const response = await fetch('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          targetType,
          targetSlug,
          favorited: nextFavorited
        })
      });

      if (!response.ok) {
        throw new Error('favorite-request-failed');
      }

      const payload = (await response.json()) as { favorited?: boolean };
      const resolvedFavorited = payload.favorited === true;
      setIsFavorited(resolvedFavorited);
      if (resolvedFavorited) {
        trackAnalyticsEvent({
          eventType: targetType === 'artist' ? 'favorite_artist' : 'favorite_artwork',
          pageType: targetType,
          path: window.location.pathname + window.location.search,
          targetType,
          targetSlug
        });
      }
      setStatus({
        tone: 'success',
        text: resolvedFavorited
          ? `${targetName} is now public on your member page as a favorite ${noun}.`
          : `${targetName} was removed from your public favorite ${noun}s.`
      });
    } catch {
      setStatus({
        tone: 'error',
        text: `Vernissage could not update your favorite ${noun}s right now.`
      });
    } finally {
      setIsPending(false);
    }
  }

  if (!databaseReady) {
    return (
      <section aria-label={`Favorite ${noun} actions`}>
        <p className="meta-note">Public favorite {noun}s will appear on member pages once the shared application database is connected.</p>
      </section>
    );
  }

  if (signInHref) {
    return (
      <section aria-label={`Favorite ${noun} actions`}>
        <div className="button-row">
          <Link href={signInHref} className="enamel-button enamel-button--secondary">
            Sign in to favorite this {noun}
          </Link>
        </div>
        <p className="meta-note">Favorite {noun}s appear on your public member page by default.</p>
      </section>
    );
  }

  return (
    <section aria-label={`Favorite ${noun} actions`}>
      <div className="button-row">
        <button
          type="button"
          className={`enamel-button ${isFavorited ? 'enamel-button--secondary' : 'enamel-button--primary'}`}
          aria-pressed={isFavorited}
          disabled={isPending}
          onClick={() => toggleFavorite(!isFavorited)}
        >
          {isFavorited ? `Remove favorite ${noun}` : `Mark as favorite ${noun}`}
        </button>
      </div>
      <p className="meta-note">
        {isFavorited
          ? `Visible on your member page as a favorite ${noun}.`
          : `Favorite ${noun}s appear on your public member page by default.`}
      </p>
      {status ? <p className={`artwork-quick-actions__status artwork-quick-actions__status--${status.tone}`}>{status.text}</p> : null}
    </section>
  );
}
