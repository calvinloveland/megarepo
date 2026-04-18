export const favoriteArtistsStorageKey = 'vernissage.favorite-artists';

export function parseFavoriteArtistsState(serialized: string | null | undefined) {
  if (!serialized) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }

    return Array.from(
      new Set(
        parsed
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );
  } catch {
    return [] as string[];
  }
}

export function serializeFavoriteArtistsState(state: string[]) {
  return JSON.stringify(state);
}

export function updateFavoriteArtistsState(state: string[], artistSlug: string, favorited: boolean) {
  const normalizedSlug = artistSlug.trim();
  if (!normalizedSlug) {
    return state;
  }

  const nextState = state.filter((slug) => slug !== normalizedSlug);
  if (favorited) {
    nextState.push(normalizedSlug);
  }

  return nextState;
}
