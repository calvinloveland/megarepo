'use client';

import { useEffect, useState } from 'react';

import {
  favoriteArtistsStorageKey,
  parseFavoriteArtistsState,
  serializeFavoriteArtistsState,
  updateFavoriteArtistsState
} from '@/src/lib/artist-favorites';

type ArtistFavoriteButtonProps = {
  artistSlug: string;
  artistName: string;
};

function loadFavorites() {
  return parseFavoriteArtistsState(window.localStorage.getItem(favoriteArtistsStorageKey));
}

function persistFavorites(state: string[]) {
  if (state.length === 0) {
    window.localStorage.removeItem(favoriteArtistsStorageKey);
    return;
  }

  window.localStorage.setItem(favoriteArtistsStorageKey, serializeFavoriteArtistsState(state));
}

export function ArtistFavoriteButton({ artistSlug, artistName }: ArtistFavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    try {
      setIsFavorited(loadFavorites().includes(artistSlug));
    } catch {
      setStatus('This browser blocked local saves, so favorite artists are unavailable here.');
    } finally {
      setIsReady(true);
    }
  }, [artistSlug]);

  function commit(nextFavorited: boolean) {
    try {
      const nextState = updateFavoriteArtistsState(loadFavorites(), artistSlug, nextFavorited);
      persistFavorites(nextState);
      setIsFavorited(nextFavorited);
      setStatus(
        nextFavorited
          ? `${artistName} is now one of your favorite artists on this device.`
          : `${artistName} was removed from your favorite artists on this device.`
      );
    } catch {
      setStatus('Vernissage could not save that favorite artist update locally on this device.');
    }
  }

  return (
    <section aria-label="Favorite artist actions">
      <div className="button-row">
        <button
          type="button"
          className={`enamel-button ${isFavorited ? 'enamel-button--secondary' : 'enamel-button--primary'}`}
          aria-pressed={isFavorited}
          disabled={!isReady}
          onClick={() => commit(!isFavorited)}
        >
          {isFavorited ? 'Remove from favorite artists' : 'Mark as favorite artist'}
        </button>
      </div>
      <p className="meta-note">
        {isFavorited ? 'Saved to your favorite artists on this device.' : 'Save favorite artists on this device for now.'}
      </p>
      {status ? <p className="meta-note">{status}</p> : null}
    </section>
  );
}
