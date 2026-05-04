import type { Artist, Artwork, Exhibition, Review, Venue } from '@/src/lib/catalog';

export type HomeVariant = 'revamp' | 'classic';

export type HomePageData = {
  featuredArtworks: Artwork[];
  heroArtwork: Artwork;
  heroArtist?: Artist;
  heroImageUrl?: string;
  mosaicArtworks: Artwork[];
  featuredArtists: Artist[];
  featuredExhibitions: Exhibition[];
  recentReviews: Review[];
  primaryVenue?: Venue;
};
