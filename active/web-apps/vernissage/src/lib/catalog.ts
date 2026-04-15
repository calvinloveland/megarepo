import rawCatalog from '../content/demo-content.json';
import {
  maximizeArticImageUrl,
  resolveReviewThumbnail,
  resizeArticImageUrl,
  searchArtistsInCatalog,
  searchArtworksInCatalog,
  searchExhibitionsInCatalog,
  selectMosaicArtworks,
  type CatalogSearchFilters
} from './catalog-helpers';
import {
  NOTEBOOK_LABEL,
  formatMemberAttribution,
  getMemberAttributionLabel,
  isEditorialMemberHandle
} from './member-attribution';

export type ReviewTargetType = 'artwork' | 'artist' | 'exhibition' | 'visit';

export type Movement = {
  slug: string;
  name: string;
  description: string;
};

export type Venue = {
  slug: string;
  name: string;
  city: string;
  country: string;
  description: string;
};

export type Artist = {
  slug: string;
  name: string;
  years: string;
  movementSlug: string;
  country: string;
  portraitLabel: string;
  bio: string;
  signatureMotifs: string[];
};

export type Artwork = {
  slug: string;
  title: string;
  artistSlug: string;
  movementSlug: string;
  year: string;
  medium: string;
  dimensions: string;
  image: string;
  width: number;
  height: number;
  tags: string[];
  summary: string;
};

export type Exhibition = {
  slug: string;
  title: string;
  venueSlug: string;
  dateLabel: string;
  heroArtworkSlug: string;
  artworkSlugs: string[];
  description: string;
};

export type Visit = {
  slug: string;
  title: string;
  memberHandle: string;
  venueSlug: string;
  visitedOn: string;
  notes: string;
};

export type Member = {
  handle: string;
  displayName: string;
  location: string;
  favoriteMovement: string;
  bio: string;
  initials: string;
  stats: {
    reviews: number;
    lists: number;
    following: number;
  };
  followingHandles: string[];
  featuredListSlug?: string;
  currentlyViewingSlugs: string[];
};

export type Review = {
  slug: string;
  targetType: ReviewTargetType;
  targetSlug: string;
  memberHandle: string;
  title: string;
  excerpt: string;
  rating: number;
  publishedOn: string;
  tags: string[];
};

export type ArtworkList = {
  slug: string;
  memberHandle: string;
  title: string;
  visibility: string;
  description: string;
  items: Array<{
    artworkSlug: string;
    note: string;
  }>;
};

export type FeedItem = {
  type: 'review' | 'list' | 'visit';
  memberHandle: string;
  headline: string;
  detail: string;
  href: string;
  publishedOn: string;
};

export type Catalog = {
  site: {
    name: string;
    tagline: string;
    intro: string;
    highlights: {
      featuredArtworkSlugs: string[];
      featuredArtistSlugs: string[];
      featuredExhibitionSlugs: string[];
      featuredListSlug?: string;
      featuredMemberHandle?: string;
    };
  };
  movements: Movement[];
  venues: Venue[];
  artists: Artist[];
  artworks: Artwork[];
  exhibitions: Exhibition[];
  visits: Visit[];
  members: Member[];
  reviews: Review[];
  lists: ArtworkList[];
  feed: FeedItem[];
};

export const catalog = rawCatalog as Catalog;
export const site = catalog.site;
export const movements = catalog.movements;
export const venues = catalog.venues;
export const artists = catalog.artists;
export const artworks = catalog.artworks;
export const exhibitions = catalog.exhibitions;
export const visits = catalog.visits;
export const members = catalog.members;
export const reviews = catalog.reviews;
export const artworkLists = catalog.lists;
export const feed = catalog.feed;
export { NOTEBOOK_LABEL, formatMemberAttribution, getMemberAttributionLabel, isEditorialMemberHandle };

export function getMovement(slug: string) {
  return movements.find((movement) => movement.slug === slug);
}

export function getVenue(slug: string) {
  return venues.find((venue) => venue.slug === slug);
}

export function getArtist(slug: string) {
  return artists.find((artist) => artist.slug === slug);
}

export function getArtwork(slug: string) {
  return artworks.find((artwork) => artwork.slug === slug);
}

export function getExhibition(slug: string) {
  return exhibitions.find((exhibition) => exhibition.slug === slug);
}

export function getVisit(slug: string) {
  return visits.find((visit) => visit.slug === slug);
}

export function getMember(handle: string) {
  return members.find((member) => member.handle === handle);
}

export function getList(slug: string) {
  return artworkLists.find((list) => list.slug === slug);
}

export function getReviewsForTarget(targetType: ReviewTargetType, targetSlug: string) {
  return reviews.filter((review) => review.targetType === targetType && review.targetSlug === targetSlug);
}

export function getReviewsByMember(memberHandle: string) {
  return reviews.filter((review) => review.memberHandle === memberHandle);
}

export function getListsByMember(memberHandle: string) {
  return artworkLists.filter((list) => list.memberHandle === memberHandle);
}

export function getArtworksByArtist(artistSlug: string) {
  return artworks.filter((artwork) => artwork.artistSlug === artistSlug);
}

export function getExhibitionsByVenue(venueSlug: string) {
  return exhibitions.filter((exhibition) => exhibition.venueSlug === venueSlug);
}

export function getFeaturedArtworks() {
  return site.highlights.featuredArtworkSlugs
    .map((slug) => getArtwork(slug))
    .filter((artwork): artwork is Artwork => Boolean(artwork));
}

/** Get a diverse mosaic of artworks excluding specific slugs, preferring one per artist. */
export function getMosaicArtworks(excludeSlugs: string[] = [], count: number = 6) {
  return selectMosaicArtworks(artworks, excludeSlugs, count);
}

/** Get a representative artwork for an artist (first available). */
export function getRepresentativeArtwork(artistSlug: string): Artwork | undefined {
  return artworks.find((artwork) => artwork.artistSlug === artistSlug);
}

export function getFeaturedArtists() {
  return site.highlights.featuredArtistSlugs
    .map((slug) => getArtist(slug))
    .filter((artist): artist is Artist => Boolean(artist));
}

export function getFeaturedExhibitions() {
  return site.highlights.featuredExhibitionSlugs
    .map((slug) => getExhibition(slug))
    .filter((exhibition): exhibition is Exhibition => Boolean(exhibition));
}

export function getFeaturedList() {
  return site.highlights.featuredListSlug ? getList(site.highlights.featuredListSlug) : undefined;
}

export function getFeaturedMember() {
  return site.highlights.featuredMemberHandle ? getMember(site.highlights.featuredMemberHandle) : undefined;
}

export function searchArtworks(filters: CatalogSearchFilters) {
  return searchArtworksInCatalog(artworks, filters, { getArtist, getMovement });
}

export function searchArtists(filters: Pick<CatalogSearchFilters, 'query' | 'movement'>) {
  return searchArtistsInCatalog(artists, filters, { getMovement });
}

export function searchExhibitions(filters: Pick<CatalogSearchFilters, 'query' | 'movement'>) {
  return searchExhibitionsInCatalog(exhibitions, filters, { getVenue, getArtwork, getArtist });
}

/** Return a IIIF image URL resized to the given width, or the original for local assets. */
export function getArtworkThumbnail(artwork: Artwork, width: number = 400): string {
  return resizeArticImageUrl(artwork.image, width);
}

/** Return the highest-resolution artwork image available from the current catalog source. */
export function getArtworkDetailImage(artwork: Artwork): string {
  return maximizeArticImageUrl(artwork.image);
}

/** Resolve a thumbnail image for any review, regardless of target type. */
export function getReviewThumbnail(review: Review, width: number = 700): { src: string; alt: string } | undefined {
  return resolveReviewThumbnail(
    review,
    {
      getArtwork,
      getArtworksByArtist,
      getExhibition
    },
    width
  );
}

export function getReviewTargetHref(review: Pick<Review, 'targetType' | 'targetSlug'>) {
  if (review.targetType === 'artwork') {
    return `/artworks/${review.targetSlug}`;
  }

  if (review.targetType === 'artist') {
    return `/artists/${review.targetSlug}`;
  }

  if (review.targetType === 'exhibition') {
    return `/exhibitions/${review.targetSlug}`;
  }

  return '/feed';
}
