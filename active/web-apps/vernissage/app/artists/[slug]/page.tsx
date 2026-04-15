import { notFound } from 'next/navigation';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
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
import { getArtistAverageRating } from '@/src/lib/artist-profile';
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
  const averageRating = getArtistAverageRating(works);

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
          {averageRating === null ? (
            <p>
              This dossier is live before the first safely licensed artwork image has joined the catalog.
              The collection team can still index the artist, link reviews, and fill in works once the
              right source arrives.
            </p>
          ) : (
            <>
              <RatingStars rating={averageRating} />
              <p>
                Readers respond most strongly to {artist.signatureMotifs[0]} and the way {artist.name.split(' ')[0]} sequences ornament like choreography.
              </p>
            </>
          )}
        </GildedCard>
        <GildedCard title="Missing another artist?" eyebrow="Catalog expansion">
          <p>
            If the next artist you want to compare or review is not catalogued yet, send a direct
            artist request so the collection team knows who should enter the room next.
          </p>
          <div className="button-row">
            <EnamelButton href="/artists/new" variant="secondary">
              Suggest an artist
            </EnamelButton>
          </div>
        </GildedCard>
      </section>

      <BotanicalDivider label="Works by this artist" />

      <section className="mosaic-grid">
        {works.length > 0 ? (
          works.map((work) => (
            <GildedCard key={work.slug} title={work.title} eyebrow={work.year} subtitle={work.medium} href={`/artworks/${work.slug}`}>
              <p>{work.summary}</p>
            </GildedCard>
          ))
        ) : (
          <GildedCard title="Works forthcoming" eyebrow="Cataloging in progress">
            <p>
              Vernissage has the artist dossier in place, but the first artwork entry is still waiting on a
              reusable image source or sharper provenance notes.
            </p>
          </GildedCard>
        )}
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
