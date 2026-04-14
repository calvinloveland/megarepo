import { notFound } from 'next/navigation';
import { ArtworkFigure } from '@/src/components/ArtworkFigure';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { CatalogRequestCard } from '@/src/components/CatalogRequestCard';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { RatingStars } from '@/src/components/RatingStars';
import {
  artworks,
  formatMemberAttribution,
  getArtist,
  getArtworksByArtist,
  getArtwork,
  getMovement,
  getReviewsForTarget
} from '@/src/lib/catalog';
import { getPersistedReviewsForTarget, mergeReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return artworks.map((artwork) => ({ slug: artwork.slug }));
}

export default async function ArtworkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artwork = getArtwork(slug);
  if (!artwork) {
    notFound();
  }

  const artist = getArtist(artwork.artistSlug);
  const movement = getMovement(artwork.movementSlug);
  const reviews = mergeReviews(getReviewsForTarget('artwork', artwork.slug), await getPersistedReviewsForTarget('artwork', artwork.slug));
  const relatedWorks = getArtworksByArtist(artwork.artistSlug).filter((candidate) => candidate.slug !== artwork.slug);

  return (
    <div className="page-stack">
      <section className="detail-hero detail-hero--artwork">
        <div className="detail-hero__artwork">
          <ArtworkFigure artwork={artwork} priority variant="immersive" />
        </div>
        <div className="detail-hero__copy">
          <p className="eyebrow">{artist?.name}</p>
          <h1>{artwork.title}</h1>
          <p className="lead">{artwork.summary}</p>
          <RatingStars rating={artwork.rating} />
          <dl className="meta-grid">
            <div>
              <dt>Year</dt>
              <dd>{artwork.year}</dd>
            </div>
            <div>
              <dt>Medium</dt>
              <dd>{artwork.medium}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{artwork.dimensions}</dd>
            </div>
            <div>
              <dt>Movement</dt>
              <dd>{movement?.name}</dd>
            </div>
          </dl>
          <div className="chip-row">
            {artwork.tags.map((tag, index) => (
              <EnamelChip key={tag} tone={index % 2 === 0 ? 'gold' : 'moss'}>
                {tag}
              </EnamelChip>
            ))}
          </div>
        </div>
      </section>

      <BotanicalDivider label="Reader responses" />

      <section className="review-grid">
        {reviews.map((review) => (
          <GildedCard key={review.slug} title={review.title} eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}>
            <RatingStars rating={review.rating} />
            <p>{review.excerpt}</p>
          </GildedCard>
        ))}
      </section>

      <BotanicalDivider label="More from this artist" />

      <section className="mosaic-grid">
        {relatedWorks.map((related) => (
          <GildedCard key={related.slug} title={related.title} eyebrow={related.year} subtitle={related.medium} href={`/artworks/${related.slug}`}>
            <p>{related.summary}</p>
          </GildedCard>
        ))}
        <CatalogRequestCard
          title="Looking for another artist or work?"
          eyebrow="Catalog requests"
          body="If the next work you want to review is not here yet, send a request while the collection is still expanding."
          initialText={`I'd love to see more works or artists like ${artist?.name ?? 'this'} added to Vernissage.`}
        />
      </section>
    </div>
  );
}
