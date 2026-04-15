import { permanentRedirect } from 'next/navigation';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { getPersistedMemberProfile, getPersistedReviewsByMember } from '@/src/lib/live-data';

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

  const reviews = await getPersistedReviewsByMember(persistedMember.handle);
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
        </div>
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
