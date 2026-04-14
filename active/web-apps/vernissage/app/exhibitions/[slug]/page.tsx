import { notFound } from 'next/navigation';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { RatingStars } from '@/src/components/RatingStars';
import {
  exhibitions,
  formatMemberAttribution,
  getArtwork,
  getExhibition,
  getReviewsForTarget,
  getVenue
} from '@/src/lib/catalog';
import { getPersistedReviewsForTarget, mergeReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return exhibitions.map((exhibition) => ({ slug: exhibition.slug }));
}

export default async function ExhibitionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const exhibition = getExhibition(slug);
  if (!exhibition) {
    notFound();
  }

  const venue = getVenue(exhibition.venueSlug);
  const reviews = mergeReviews(getReviewsForTarget('exhibition', exhibition.slug), await getPersistedReviewsForTarget('exhibition', exhibition.slug));

  return (
    <div className="page-stack">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">{venue ? `${venue.name} · ${venue.city}` : 'Venue'}</p>
        <h1>{exhibition.title}</h1>
        <p className="lead">{exhibition.description}</p>
        <p className="meta-note">{exhibition.dateLabel}</p>
      </section>

      <section className="two-up-grid">
        <GildedCard title="Venue atmosphere" eyebrow="Architecture notes">
          <p>{venue?.description}</p>
        </GildedCard>
        <GildedCard title="Exhibition reading" eyebrow="Critical response">
          <RatingStars rating={reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 4.5} />
          <p>{reviews.length} detailed exhibition reviews are attached to this show in the current launch catalog.</p>
        </GildedCard>
      </section>

      <BotanicalDivider label="Featured works" />

      <section className="mosaic-grid">
        {exhibition.artworkSlugs.map((artworkSlug) => {
          const artwork = getArtwork(artworkSlug);
          if (!artwork) return null;
          return (
            <GildedCard key={artwork.slug} title={artwork.title} eyebrow={artwork.year} subtitle={artwork.medium} href={`/artworks/${artwork.slug}`}>
              <p>{artwork.summary}</p>
            </GildedCard>
          );
        })}
      </section>

      <BotanicalDivider label="Exhibition reviews" />

      <section className="review-grid">
        {reviews.map((review) => (
          <GildedCard key={review.slug} title={review.title} eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}>
            <RatingStars rating={review.rating} />
            <p>{review.excerpt}</p>
          </GildedCard>
        ))}
      </section>
    </div>
  );
}
