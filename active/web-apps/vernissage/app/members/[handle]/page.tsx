import { permanentRedirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ArtworkPreviewCard } from '@/src/components/ArtworkPreviewCard';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelChip } from '@/src/components/EnamelChip';
import { EnamelButton } from '@/src/components/EnamelButton';
import { FollowMemberButton } from '@/src/components/FollowMemberButton';
import { GildedCard } from '@/src/components/GildedCard';
import { PageIntro } from '@/src/components/PageIntro';
import { authOptions } from '@/src/lib/auth';
import { getArtist, getArtwork, getExhibition, getMovement, getReviewTargetHref, type Review as CatalogReview } from '@/src/lib/catalog';
import { getIsFollowingMemberByUser, getPersistedMemberFavorites, getPersistedMemberProfile, getPersistedReviewsByMember } from '@/src/lib/live-data';
import { isDatabaseConfigured } from '@/src/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return [];
}

function formatCount(count: number, singular: string, plural: string = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getReviewLabel(targetType: CatalogReview['targetType']) {
  if (targetType === 'artwork') {
    return 'Artwork review';
  }

  if (targetType === 'artist') {
    return 'Artist review';
  }

  if (targetType === 'exhibition') {
    return 'Exhibition review';
  }

  return 'Salon note';
}

function getReviewTargetTitle(review: CatalogReview) {
  if (review.targetType === 'artwork') {
    return getArtwork(review.targetSlug)?.title;
  }

  if (review.targetType === 'artist') {
    return getArtist(review.targetSlug)?.name;
  }

  if (review.targetType === 'exhibition') {
    return getExhibition(review.targetSlug)?.title;
  }

  return undefined;
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
  const eyebrowParts = [
    'Salon member',
    persistedMember.location || undefined,
    persistedMember.favoriteMovement ? `returns to ${persistedMember.favoriteMovement}` : undefined
  ].filter(Boolean);
  const publicShelfCount = favorites.artworks.length + favorites.artists.length;
  const hasActivity = Boolean(reviews.length || publicShelfCount || persistedMember.stats.followers || persistedMember.stats.following);
  const lead = persistedMember.bio
    ? persistedMember.bio
    : isOwnProfile
      ? 'You have not written a formal bio yet, so this page introduces you through your shelves, your criticism, and the members you keep close.'
      : `${persistedMember.displayName} has skipped the formal bio for now, so this page has to introduce them through shelves, criticism, and the company they keep.`;
  const writingSummary = reviews.length
    ? isOwnProfile
      ? `You already have ${formatCount(reviews.length, 'published review')}. “${reviews[0].title}” is a strong place to start if you want visitors to hear your voice quickly.`
      : `${persistedMember.displayName} already has ${formatCount(reviews.length, 'published review')}. “${reviews[0].title}” is a strong place to start if you want to hear their voice quickly.`
    : isOwnProfile
      ? 'No published criticism yet. Your first finished review will define this page more sharply than any stat chip above.'
      : `No published criticism yet. Until ${persistedMember.displayName} writes in public, this profile leans on shelves and social cues.`;
  const shelfSummary = publicShelfCount
    ? isOwnProfile
      ? `Your public shelves currently hold ${formatCount(favorites.artworks.length, 'favorite artwork')} and ${formatCount(favorites.artists.length, 'favorite artist')}. Visitors can read your taste at a glance there.`
      : `${persistedMember.displayName}'s public shelves hold ${formatCount(favorites.artworks.length, 'favorite artwork')} and ${formatCount(favorites.artists.length, 'favorite artist')}. It is the quickest read on what they keep returning to.`
    : isOwnProfile
      ? 'Both public shelves are still blank. A few carefully chosen favorites would say more than a long profile explanation.'
      : `${persistedMember.displayName} has not made any favorites public yet, so the page is still missing its quickest visual read on taste.`;
  const socialSummary = persistedMember.stats.followers || persistedMember.stats.following
    ? isOwnProfile
      ? `${formatCount(persistedMember.stats.followers, 'member')} follow you, and you follow ${formatCount(persistedMember.stats.following, 'member')}. That tells visitors whose eyes you trust and who is already paying attention.`
      : `${formatCount(persistedMember.stats.followers, 'member')} follow ${persistedMember.displayName}, and ${persistedMember.displayName} follows ${formatCount(persistedMember.stats.following, 'member')}. That gives this profile a real social perimeter.`
    : isOwnProfile
      ? 'Your follow circle is still quiet. Following a few members would show visitors whose taste you want to keep near.'
      : `${persistedMember.displayName} has not built a public follow circle yet, so this profile still feels more private than social.`;
  const artworkShelfIntro = isOwnProfile
    ? 'These are the works visitors see first when they want your taste in objects.'
    : `These are the works ${persistedMember.displayName} thinks deserve a place on a public wall.`;
  const artistShelfIntro = isOwnProfile
    ? 'These are the artists you want attached to your public taste.'
    : `These are the names ${persistedMember.displayName} keeps close in public.`;
  const reviewsIntro = isOwnProfile
    ? 'Published criticism is still the clearest way for other members to understand how you look.'
    : `If you want to know how ${persistedMember.displayName} looks at art, start with the published criticism below.`;

  return (
    <div className="page-stack">
      <PageIntro eyebrow={eyebrowParts.length ? eyebrowParts.join(' · ') : undefined} title={persistedMember.displayName}>
        <p className="meta-note">@{persistedMember.handle}</p>
        <p className="lead">{lead}</p>
        <p>
          {hasActivity
            ? isOwnProfile
              ? 'Visitors should be able to tell what kind of eye you bring to the room from this page alone.'
              : 'A visitor should be able to tell what kind of eye this member brings to the room from this page alone.'
            : isOwnProfile
              ? 'Right now this page is still waiting for your first public marks.'
              : 'Right now this page is still quiet, but it is ready for more of this member to show through.'}
        </p>
        <div className="chip-row">
          <EnamelChip>{formatCount(persistedMember.stats.reviews, 'published review')}</EnamelChip>
          <EnamelChip tone="moss">{formatCount(persistedMember.stats.lists, 'public list')}</EnamelChip>
          <EnamelChip tone="rose">follows {formatCount(persistedMember.stats.following, 'member')}</EnamelChip>
          <EnamelChip tone="burgundy">followed by {formatCount(persistedMember.stats.followers, 'member')}</EnamelChip>
        </div>
        {!isOwnProfile ? (
          <FollowMemberButton
            memberHandle={persistedMember.handle}
            memberName={persistedMember.displayName}
            initialFollowing={isFollowing}
            databaseReady={databaseReady}
            signInHref={databaseReady && !session?.user ? `/signin?callbackUrl=/members/${persistedMember.handle}` : undefined}
          />
        ) : (
          <div className="button-row">
            <EnamelButton href="/reviews/new">Write a review</EnamelButton>
            <EnamelButton href="/search" variant="secondary">
              Find something worth writing about
            </EnamelButton>
          </div>
        )}
      </PageIntro>

      <GildedCard
        title={isOwnProfile ? 'What visitors can read here' : `Why ${persistedMember.displayName} matters here`}
        eyebrow={hasActivity ? 'A quick public read' : 'A profile still taking shape'}
      >
        <p>
          <strong>Writing.</strong> {writingSummary}
        </p>
        <p>
          <strong>Shelves.</strong> {shelfSummary}
        </p>
        <p>
          <strong>Circle.</strong> {socialSummary}
        </p>
      </GildedCard>

      <BotanicalDivider label="Artwork shelf" />
      <p className="meta-note">{artworkShelfIntro}</p>

      <section className="mosaic-grid">
        {favorites.artworks.length ? (
          favorites.artworks.map((artwork: (typeof favorites.artworks)[number]) => <ArtworkPreviewCard key={artwork.slug} artwork={artwork} />)
        ) : (
          <GildedCard title={isOwnProfile ? 'Your artwork shelf is still blank' : 'No artworks on the public shelf yet'} eyebrow="Artwork shelf">
            <p>
              {isOwnProfile
                ? 'Choose a few works you want attached to your name. Even a small shelf gives visitors a quick sense of your taste.'
                : `${persistedMember.displayName} has not pinned any artworks here yet. When that wall fills in, it will be the quickest clue to what they keep returning to.`}
            </p>
            {isOwnProfile ? (
              <div className="button-row">
                <EnamelButton href="/search" variant="secondary">
                  Browse the catalog
                </EnamelButton>
              </div>
            ) : null}
          </GildedCard>
        )}
      </section>

      <BotanicalDivider label="Artist shelf" />
      <p className="meta-note">{artistShelfIntro}</p>

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
          <GildedCard title={isOwnProfile ? 'Your artist shelf needs a few names' : 'No artists on the public shelf yet'} eyebrow="Artist shelf">
            <p>
              {isOwnProfile
                ? 'A public shelf of artists tells visitors which lineages matter to you before they read a single paragraph.'
                : `${persistedMember.displayName} has not named any artists here yet. Check back when they decide which names belong in their orbit.`}
            </p>
          </GildedCard>
        )}
      </section>

      <BotanicalDivider label="Published criticism" />
      <p className="meta-note">{reviewsIntro}</p>

      <section className="review-grid">
        {reviews.length ? (
          reviews.map((review: (typeof reviews)[number]) => (
            <GildedCard
              key={review.slug}
              title={review.title}
              eyebrow={`${getReviewLabel(review.targetType)} · ${review.publishedOn}`}
              subtitle={getReviewTargetTitle(review)}
              href={getReviewTargetHref(review)}
            >
              <p>{review.excerpt}</p>
              <p className="meta-note">Open the subject page to read the full response in place.</p>
            </GildedCard>
          ))
        ) : (
          <GildedCard title={isOwnProfile ? 'No published criticism yet' : 'No public criticism yet'} eyebrow="Published criticism">
            <p>
              {isOwnProfile
                ? 'Your first public review will do more to define this page than any profile sentence. Publish when you are ready to be read.'
                : `${persistedMember.displayName} has not published criticism yet. Until that changes, this page has to speak through shelves and company kept rather than finished writing.`}
            </p>
            {isOwnProfile ? (
              <div className="button-row">
                <EnamelButton href="/reviews/new">Write the first review</EnamelButton>
              </div>
            ) : null}
          </GildedCard>
        )}
      </section>
    </div>
  );
}
