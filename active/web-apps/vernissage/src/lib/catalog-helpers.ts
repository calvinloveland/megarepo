export type ArtworkLike = {
  slug: string;
  artistSlug: string;
  image: string;
  title: string;
};

export type ExhibitionLike = {
  heroArtworkSlug: string;
};

export type ReviewTargetType = 'artwork' | 'artist' | 'exhibition' | 'visit';

export type ReviewLike = {
  targetType: ReviewTargetType;
  targetSlug: string;
};

export type MovementLike = {
  slug: string;
  name: string;
};

export type ArtistSearchLike = {
  slug: string;
  name: string;
  movementSlug: string;
  country: string;
  portraitLabel: string;
  bio: string;
  signatureMotifs: string[];
  years: string;
};

export type ArtworkSearchLike = ArtworkLike & {
  movementSlug: string;
  year: string;
  medium: string;
  summary: string;
  tags: string[];
};

export type VenueSearchLike = {
  name: string;
  city: string;
  country: string;
};

export type ExhibitionSearchLike = {
  slug: string;
  title: string;
  venueSlug: string;
  dateLabel: string;
  artworkSlugs: string[];
  description: string;
};

export type CatalogSearchFilters = {
  query?: string;
  movement?: string;
  medium?: string;
  year?: string;
};

function normalizeSearchValue(value?: string) {
  return value?.trim().toLowerCase() ?? '';
}

function matchesSearchQuery(fields: Array<string | undefined>, query: string) {
  if (!query) {
    return true;
  }

  return fields.some((field) => normalizeSearchValue(field).includes(query));
}

export function selectMosaicArtworks<T extends ArtworkLike>(items: T[], excludeSlugs: string[] = [], count: number = 6) {
  const excluded = new Set(excludeSlugs);
  const available = items.filter((item) => !excluded.has(item.slug));
  const result: T[] = [];
  const seenArtists = new Set<string>();

  for (const artwork of available) {
    if (!seenArtists.has(artwork.artistSlug)) {
      result.push(artwork);
      seenArtists.add(artwork.artistSlug);
    }
    if (result.length >= count) {
      break;
    }
  }

  for (const artwork of available) {
    if (result.length >= count) {
      break;
    }
    if (!result.includes(artwork)) {
      result.push(artwork);
    }
  }

  return result;
}

export function resizeArticImageUrl(image: string, width: number = 400) {
  if (/^https:\/\/www\.artic\.edu\/iiif\/2\//.test(image)) {
    return image.replace(/\/full\/\d+,\//, `/full/${width},/`);
  }

  return image;
}

export function resolveReviewThumbnail<TArtwork extends ArtworkLike, TReview extends ReviewLike>(
  review: TReview,
  helpers: {
    getArtwork: (slug: string) => TArtwork | undefined;
    getArtworksByArtist: (artistSlug: string) => TArtwork[];
    getExhibition: (slug: string) => ExhibitionLike | undefined;
  },
  width: number = 700
) {
  if (review.targetType === 'artwork') {
    const artwork = helpers.getArtwork(review.targetSlug);
    if (artwork) {
      return { src: resizeArticImageUrl(artwork.image, width), alt: artwork.title };
    }
  } else if (review.targetType === 'artist') {
    const artistWorks = helpers.getArtworksByArtist(review.targetSlug);
    if (artistWorks.length > 0) {
      return { src: resizeArticImageUrl(artistWorks[0].image, width), alt: artistWorks[0].title };
    }
  } else if (review.targetType === 'exhibition') {
    const exhibition = helpers.getExhibition(review.targetSlug);
    if (exhibition) {
      const heroArt = helpers.getArtwork(exhibition.heroArtworkSlug);
      if (heroArt) {
        return { src: resizeArticImageUrl(heroArt.image, width), alt: heroArt.title };
      }
    }
  }

  return undefined;
}

export function searchArtworksInCatalog<TArtwork extends ArtworkSearchLike, TArtist extends ArtistSearchLike, TMovement extends MovementLike>(
  artworks: TArtwork[],
  filters: CatalogSearchFilters,
  helpers: {
    getArtist: (slug: string) => TArtist | undefined;
    getMovement: (slug: string) => TMovement | undefined;
  }
) {
  const query = normalizeSearchValue(filters.query);
  const movement = filters.movement?.trim() ?? '';
  const medium = filters.medium?.trim() ?? '';
  const year = filters.year?.trim() ?? '';

  return artworks.filter((artwork) => {
    const artist = helpers.getArtist(artwork.artistSlug);
    const artworkMovement = helpers.getMovement(artwork.movementSlug);

    if (movement && artwork.movementSlug !== movement) {
      return false;
    }

    if (medium && artwork.medium !== medium) {
      return false;
    }

    if (year && artwork.year !== year) {
      return false;
    }

    return matchesSearchQuery(
      [
        artwork.title,
        artwork.summary,
        artwork.medium,
        artwork.year,
        artworkMovement?.name,
        artist?.name,
        artist?.bio,
        ...(artist?.signatureMotifs ?? []),
        ...artwork.tags
      ],
      query
    );
  });
}

export function searchArtistsInCatalog<TArtist extends ArtistSearchLike, TMovement extends MovementLike>(
  artists: TArtist[],
  filters: Pick<CatalogSearchFilters, 'query' | 'movement'>,
  helpers: {
    getMovement: (slug: string) => TMovement | undefined;
  }
) {
  const query = normalizeSearchValue(filters.query);
  const movement = filters.movement?.trim() ?? '';

  return artists.filter((artist) => {
    const artistMovement = helpers.getMovement(artist.movementSlug);

    if (movement && artist.movementSlug !== movement) {
      return false;
    }

    return matchesSearchQuery(
      [artist.name, artist.bio, artist.country, artist.portraitLabel, artist.years, artistMovement?.name, ...artist.signatureMotifs],
      query
    );
  });
}

export function searchExhibitionsInCatalog<
  TExhibition extends ExhibitionSearchLike,
  TArtwork extends ArtworkSearchLike,
  TVenue extends VenueSearchLike,
  TArtist extends ArtistSearchLike
>(
  exhibitions: TExhibition[],
  filters: Pick<CatalogSearchFilters, 'query' | 'movement'>,
  helpers: {
    getVenue: (slug: string) => TVenue | undefined;
    getArtwork: (slug: string) => TArtwork | undefined;
    getArtist: (slug: string) => TArtist | undefined;
  }
) {
  const query = normalizeSearchValue(filters.query);
  const movement = filters.movement?.trim() ?? '';

  return exhibitions.filter((exhibition) => {
    const venue = helpers.getVenue(exhibition.venueSlug);
    const featuredArtworks = exhibition.artworkSlugs
      .map((slug) => helpers.getArtwork(slug))
      .filter((artwork): artwork is TArtwork => Boolean(artwork));

    if (movement && !featuredArtworks.some((artwork) => artwork.movementSlug === movement)) {
      return false;
    }

    return matchesSearchQuery(
      [
        exhibition.title,
        exhibition.description,
        exhibition.dateLabel,
        venue?.name,
        venue?.city,
        venue?.country,
        ...featuredArtworks.flatMap((artwork) => {
          const artist = helpers.getArtist(artwork.artistSlug);
          return [artwork.title, artwork.summary, artist?.name];
        })
      ],
      query
    );
  });
}
