import { notFound } from 'next/navigation';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { RatingStars } from '@/src/components/RatingStars';
import {
  formatMemberAttribution,
  artists,
  getArtist,
  getArtworksByArtist,
  getMovement,
  getReviewsForTarget
} from '@/src/lib/catalog';
import { getPersistedReviewsForTarget, mergeReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return artists.map((artist) => ({ slug: artist.slug }));
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = getArtist(slug);
  if (!artist) {
    notFound();
  }

  const works = getArtworksByArtist(artist.slug);
  const movement = getMovement(artist.movementSlug);
  const reviews = mergeReviews(getReviewsForTarget('artist', artist.slug), await getPersistedReviewsForTarget('artist', artist.slug));

  return (
    <div className="page-stack">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">{movement?.name}</p>
        <h1>{artist.name}</h1>
        <p className="lead">{artist.bio}</p>
        <div className="chip-row">
          {artist.signatureMotifs.map((motif, index) => (
            <EnamelChip key={motif} tone={index === 1 ? 'rose' : index === 2 ? 'moss' : 'gold'}>
              {motif}
            </EnamelChip>
          ))}
        </div>
      </section>

      <section className="two-up-grid">
        <GildedCard title="Artist dossier" eyebrow={`${artist.years} · ${artist.country}`}>
          <p>{artist.portraitLabel}</p>
          <ul className="plain-list">
            <li>Movement: {movement?.name}</li>
            <li>{works.length} catalogued works in the current launch collection</li>
            <li>{reviews.length} long-form artist reviews</li>
          </ul>
        </GildedCard>
        <GildedCard title="House appraisal" eyebrow="Aggregate response">
          <RatingStars rating={works.reduce((sum, work) => sum + work.rating, 0) / works.length} />
          <p>
            Readers respond most strongly to {artist.signatureMotifs[0]} and the way {artist.name.split(' ')[0]} sequences ornament like choreography.
          </p>
        </GildedCard>
      </section>

      <BotanicalDivider label="Works by this artist" />

      <section className="mosaic-grid">
        {works.map((work) => (
          <GildedCard key={work.slug} title={work.title} eyebrow={work.year} subtitle={work.medium} href={`/artworks/${work.slug}`}>
            <p>{work.summary}</p>
          </GildedCard>
        ))}
      </section>

      <BotanicalDivider label="Artist reviews" />

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
