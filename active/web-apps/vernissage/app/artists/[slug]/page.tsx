import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
import { FavoriteToggleButton } from '@/src/components/FavoriteToggleButton';
import { ArtworkPreviewCard } from '@/src/components/ArtworkPreviewCard';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { PageIntro } from '@/src/components/PageIntro';
import { RatingStars } from '@/src/components/RatingStars';
import { authOptions } from '@/src/lib/auth';
import { getAverageRating } from '@/src/lib/artist-profile';
import { groupCatalogWorksByDecade } from '@/src/lib/catalog-records';
import {
  formatMemberAttribution,
  artists,
  getArtist,
  getArtworksByArtist,
  getMovement,
  getReviewsForTarget,
  hasArtworkImage
} from '@/src/lib/catalog';
import { getIsFavoritedByUser, getPersistedReviewsForTarget, mergeReviews } from '@/src/lib/live-data';
import { isDatabaseConfigured } from '@/src/lib/prisma';

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
  const illustratedWorks = works.filter(hasArtworkImage);
  const catalogOnlyWorks = works.filter((work) => !hasArtworkImage(work));
  const catalogOnlyGroups = groupCatalogWorksByDecade(catalogOnlyWorks);
  const movement = getMovement(artist.movementSlug);
  const session = await getServerSession(authOptions);
  const databaseReady = isDatabaseConfigured();
  const reviews = mergeReviews(getReviewsForTarget('artist', artist.slug), await getPersistedReviewsForTarget('artist', artist.slug));
  const isFavorited = await getIsFavoritedByUser(session?.user?.id, 'artist', artist.slug);
  const averageRating = getAverageRating(reviews);

  return (
    <div className="page-stack">
      <PageIntro eyebrow={movement?.name} title={artist.name}>
        <p className="lead">{artist.bio}</p>
        <div className="chip-row">
          {artist.signatureMotifs.map((motif, index) => (
            <EnamelChip key={motif} tone={index === 1 ? 'rose' : index === 2 ? 'moss' : 'gold'}>
              {motif}
            </EnamelChip>
          ))}
        </div>
        <FavoriteToggleButton
          targetType="artist"
          targetSlug={artist.slug}
          targetName={artist.name}
          initialFavorited={isFavorited}
          databaseReady={databaseReady}
          signInHref={databaseReady && !session?.user ? `/signin?callbackUrl=/artists/${artist.slug}` : undefined}
        />
      </PageIntro>

      <section className="two-up-grid">
        <GildedCard title="Artist dossier" eyebrow={`${artist.years} · ${artist.country}`}>
          <p>{artist.portraitLabel}</p>
          <ul className="plain-list">
            <li>Movement: {movement?.name}</li>
            <li>{works.length} catalogued works in the current collection</li>
            <li>{illustratedWorks.length} works currently published with images</li>
            <li>{reviews.length} published artist reviews</li>
          </ul>
        </GildedCard>
        <GildedCard title="House appraisal" eyebrow="Aggregate response">
          {averageRating === null ? (
            <p>
              No published reader ratings yet. This dossier can still stand on artist records and artwork metadata
              until members begin responding in public.
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
        {illustratedWorks.length > 0 ? (
          illustratedWorks.map((work) => <ArtworkPreviewCard key={work.slug} artwork={work} showArtistLink={false} />)
        ) : (
          <GildedCard title="Works forthcoming" eyebrow="Cataloging in progress">
            <p>
              Vernissage has the artist dossier in place, but illustrated works for this artist are still waiting on
              reusable image sources or sharper provenance notes.
            </p>
          </GildedCard>
        )}
      </section>

      {catalogOnlyGroups.length ? (
        <>
          <BotanicalDivider label="Deep catalog records" />

          <section className="three-up-grid">
            {catalogOnlyGroups.map((group) => (
              <GildedCard
                key={group.label}
                title={group.label}
                eyebrow={`${group.works.length} catalog record${group.works.length === 1 ? '' : 's'}`}
              >
                <ul className="plain-list">
                  {group.works.map((work) => (
                    <li key={work.slug}>
                      <Link href={`/artworks/${work.slug}`}>
                        {work.title}
                      </Link>{' '}
                      <span>({work.year})</span>
                    </li>
                  ))}
                </ul>
              </GildedCard>
            ))}
          </section>
        </>
      ) : null}

      <BotanicalDivider label="Artist reviews" />

      <section className="review-grid">
        {reviews.length ? (
          reviews.map((review) => (
            <GildedCard key={review.slug} title={review.title} eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}>
              <RatingStars rating={review.rating} />
              <p>{review.excerpt}</p>
            </GildedCard>
          ))
        ) : (
          <GildedCard title="No published artist reviews yet" eyebrow="Waiting for real criticism">
            <p>There are no seeded artist blurbs here anymore. The first real member review will appear once someone writes one.</p>
          </GildedCard>
        )}
      </section>
    </div>
  );
}
