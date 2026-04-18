import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ArtworkFigure } from '@/src/components/ArtworkFigure';
import { FavoriteToggleButton } from '@/src/components/FavoriteToggleButton';
import { ArtworkPreviewCard } from '@/src/components/ArtworkPreviewCard';
import { ArtworkQuickActions } from '@/src/components/ArtworkQuickActions';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { CatalogRequestCard } from '@/src/components/CatalogRequestCard';
import { EnamelButton } from '@/src/components/EnamelButton';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { RatingStars } from '@/src/components/RatingStars';
import { authOptions } from '@/src/lib/auth';
import { getAverageRating } from '@/src/lib/artist-profile';
import {
  artworks,
  formatMemberAttribution,
  getArtist,
  getArtworksByArtist,
  getArtwork,
  getMovement,
  getReviewsForTarget
} from '@/src/lib/catalog';
import { getIsFavoritedByUser, getPersistedReviewsForTarget, mergeReviews } from '@/src/lib/live-data';
import { isDatabaseConfigured } from '@/src/lib/prisma';

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
  const session = await getServerSession(authOptions);
  const databaseReady = isDatabaseConfigured();
  const reviews = mergeReviews(getReviewsForTarget('artwork', artwork.slug), await getPersistedReviewsForTarget('artwork', artwork.slug));
  const relatedWorks = getArtworksByArtist(artwork.artistSlug).filter((candidate) => candidate.slug !== artwork.slug);
  const isFavorited = await getIsFavoritedByUser(session?.user?.id, 'artwork', artwork.slug);
  const averageRating = getAverageRating(reviews);

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
          {averageRating === null ? (
            <p className="meta-note">No published reader ratings yet.</p>
          ) : (
            <>
              <RatingStars rating={averageRating} />
              <p className="meta-note">{reviews.length} published review{reviews.length === 1 ? '' : 's'} so far.</p>
            </>
          )}
          {artist ? (
            <div className="button-row">
              <EnamelButton href={`/artists/${artist.slug}`} variant="secondary">
                View artist dossier
              </EnamelButton>
            </div>
          ) : null}
          <FavoriteToggleButton
            targetType="artwork"
            targetSlug={artwork.slug}
            targetName={artwork.title}
            initialFavorited={isFavorited}
            databaseReady={databaseReady}
            signInHref={databaseReady && !session?.user ? `/signin?callbackUrl=/artworks/${artwork.slug}` : undefined}
          />
          <ArtworkQuickActions artworkSlug={artwork.slug} artworkTitle={artwork.title} />
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
        {reviews.length ? (
          reviews.map((review) => (
            <GildedCard key={review.slug} title={review.title} eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}>
              <RatingStars rating={review.rating} />
              <p>{review.excerpt}</p>
            </GildedCard>
          ))
        ) : (
          <GildedCard title="No published responses yet" eyebrow="Waiting for the first review">
            <p>This artwork has no seeded ratings or quotes anymore. The first real member response will appear here.</p>
          </GildedCard>
        )}
      </section>

      <BotanicalDivider label="More from this artist" />

      <section className="mosaic-grid">
        {relatedWorks.map((related) => (
          <ArtworkPreviewCard key={related.slug} artwork={related} showArtistLink={false} />
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
