import { permanentRedirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ArtworkPreviewCard } from '@/src/components/ArtworkPreviewCard';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelChip } from '@/src/components/EnamelChip';
import { EnamelButton } from '@/src/components/EnamelButton';
import { FollowMemberButton } from '@/src/components/FollowMemberButton';
import { GildedCard } from '@/src/components/GildedCard';
import { authOptions } from '@/src/lib/auth';
import { getMovement } from '@/src/lib/catalog';
import { getIsFollowingMemberByUser, getPersistedMemberFavorites, getPersistedMemberProfile, getPersistedReviewsByMember } from '@/src/lib/live-data';
import { isDatabaseConfigured } from '@/src/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return [];
}

export default async function MemberPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const persistedMember = await getPersistedMemberProfile(handle);
  if (!persistedMember) {
    permanentRedirect('/feed');
  }

  const session = await getServerSession(authOptions);
  const databaseReady = isDatabaseConfigured();
  const reviews = await getPersistedReviewsByMember(persistedMember.handle);
  const favorites = await getPersistedMemberFavorites(persistedMember.handle);
  const isOwnProfile = session?.user?.id === persistedMember.id;
  const isFollowing = await getIsFollowingMemberByUser(session?.user?.id, persistedMember.id);
  const eyebrowParts = [persistedMember.location, persistedMember.favoriteMovement].filter(Boolean);

  return (
    <div className="page-stack">
      <section className="hero-shell hero-shell--compact">
        {eyebrowParts.length ? <p className="eyebrow">{eyebrowParts.join(' · ')}</p> : null}
        <h1>{persistedMember.displayName}</h1>
        {persistedMember.bio ? <p className="lead">{persistedMember.bio}</p> : <p className="lead">This member has an account, but they have not added a public bio yet.</p>}
        <div className="chip-row">
          <EnamelChip>{persistedMember.stats.reviews} reviews</EnamelChip>
          <EnamelChip tone="moss">{persistedMember.stats.lists} lists</EnamelChip>
          <EnamelChip tone="rose">{persistedMember.stats.following} following</EnamelChip>
          <EnamelChip tone="burgundy">{persistedMember.stats.followers} followers</EnamelChip>
        </div>
        {!isOwnProfile ? (
          <FollowMemberButton
            memberHandle={persistedMember.handle}
            memberName={persistedMember.displayName}
            initialFollowing={isFollowing}
            databaseReady={databaseReady}
            signInHref={databaseReady && !session?.user ? `/signin?callbackUrl=/members/${persistedMember.handle}` : undefined}
          />
        ) : null}
      </section>

      <BotanicalDivider label="Favorite artworks" />

      <section className="mosaic-grid">
        {favorites.artworks.length ? (
          favorites.artworks.map((artwork: (typeof favorites.artworks)[number]) => <ArtworkPreviewCard key={artwork.slug} artwork={artwork} />)
        ) : (
          <GildedCard title="No favorite artworks yet" eyebrow="Public shelf">
            <p>This member has not marked any artworks as public favorites yet.</p>
          </GildedCard>
        )}
      </section>

      <BotanicalDivider label="Favorite artists" />

      <section className="three-up-grid">
        {favorites.artists.length ? (
          favorites.artists.map((artist: (typeof favorites.artists)[number]) => (
            <GildedCard key={artist.slug} title={artist.name} eyebrow={getMovement(artist.movementSlug)?.name}>
              <p>{artist.portraitLabel}</p>
              <div className="button-row">
                <EnamelButton href={`/artists/${artist.slug}`} variant="secondary">
                  View artist
                </EnamelButton>
              </div>
            </GildedCard>
          ))
        ) : (
          <GildedCard title="No favorite artists yet" eyebrow="Public shelf">
            <p>This member has not marked any artists as public favorites yet.</p>
          </GildedCard>
        )}
      </section>

      <BotanicalDivider label="Recent reviews" />


      <section className="review-grid">
        {reviews.length ? (
          reviews.map((review: (typeof reviews)[number]) => (
            <GildedCard key={review.slug} title={review.title} eyebrow={`${review.targetType} · ${review.publishedOn}`}>
              <p>{review.excerpt}</p>
            </GildedCard>
          ))
        ) : (
          <GildedCard title="No reviews yet" eyebrow="A new account">
            <p>This critic has an account, but they have not published any salon writing yet.</p>
          </GildedCard>
        )}
      </section>
    </div>
  );
}
