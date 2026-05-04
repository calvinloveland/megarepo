import { ClassicHomePage } from '@/src/components/home/ClassicHomePage';
import { HomeVariantSwitcher } from '@/src/components/home/HomeVariantSwitcher';
import { RevampedHomePage } from '@/src/components/home/RevampedHomePage';
import type { HomePageData, HomeVariant } from '@/src/components/home/types';
import {
  artworks,
  getArtist,
  getArtworkThumbnail,
  getFeaturedArtists,
  getFeaturedArtworks,
  getFeaturedExhibitions,
  getMosaicArtworks,
  hasArtworkImage,
  venues
} from '@/src/lib/catalog';
import { getPersistedRecentReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeVariant(value: string | string[] | undefined): HomeVariant {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === 'classic' ? 'classic' : 'revamp';
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {};
  const currentVariant = normalizeVariant(params.home);

  const featuredArtworks = getFeaturedArtworks();
  const heroArtwork = featuredArtworks[0] ?? artworks.find(hasArtworkImage);

  if (!heroArtwork) {
    throw new Error('Vernissage homepage requires at least one artwork with an image.');
  }

  const heroArtist = getArtist(heroArtwork.artistSlug);
  const heroImageUrl = getArtworkThumbnail(heroArtwork, 900);
  const data: HomePageData = {
    featuredArtworks: [heroArtwork, ...featuredArtworks.filter((artwork) => artwork.slug !== heroArtwork.slug)],
    heroArtwork,
    heroArtist,
    heroImageUrl,
    mosaicArtworks: getMosaicArtworks([heroArtwork.slug]),
    featuredArtists: getFeaturedArtists(),
    featuredExhibitions: getFeaturedExhibitions(),
    recentReviews: await getPersistedRecentReviews(4),
    primaryVenue: venues[0]
  };

  return (
    <div className="page-stack">
      {heroImageUrl ? <link rel="preload" as="image" href={heroImageUrl} /> : null}
      <HomeVariantSwitcher currentVariant={currentVariant} />
      {currentVariant === 'classic' ? <ClassicHomePage data={data} /> : <RevampedHomePage data={data} />}
    </div>
  );
}
