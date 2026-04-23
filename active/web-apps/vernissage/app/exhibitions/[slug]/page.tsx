import { notFound } from 'next/navigation';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { PageIntro } from '@/src/components/PageIntro';
import { RatingStars } from '@/src/components/RatingStars';
import { getAverageRating } from '@/src/lib/artist-profile';
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
  const averageRating = getAverageRating(reviews);

  return (
    <div className="page-stack">
      <PageIntro eyebrow={venue ? `${venue.name} · ${venue.city}` : 'Venue'} title={exhibition.title}>
        <p className="lead">{exhibition.description}</p>
        <p className="meta-note">{exhibition.dateLabel}</p>
      </PageIntro>

      <section className="two-up-grid">
        <GildedCard title="Venue atmosphere" eyebrow="Architecture notes">
          <p>{venue?.description}</p>
        </GildedCard>
        <GildedCard title="Exhibition reading" eyebrow="Critical response">
          {averageRating === null ? (
            <p>No published exhibition ratings yet.</p>
          ) : (
            <>
              <RatingStars rating={averageRating} />
              <p>{reviews.length} published exhibition review{reviews.length === 1 ? '' : 's'} are attached to this show.</p>
            </>
          )}
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
        {reviews.length ? (
          reviews.map((review) => (
            <GildedCard key={review.slug} title={review.title} eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}>
              <RatingStars rating={review.rating} />
              <p>{review.excerpt}</p>
            </GildedCard>
          ))
        ) : (
          <GildedCard title="No published exhibition reviews yet" eyebrow="Waiting for real responses">
            <p>This exhibition record has no seeded criticism attached. Published member reviews will appear here when they exist.</p>
          </GildedCard>
        )}
      </section>
    </div>
  );
}
