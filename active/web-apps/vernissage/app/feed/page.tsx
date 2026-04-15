import Link from 'next/link';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { formatMemberAttribution, getReviewTargetHref, getReviewThumbnail } from '@/src/lib/catalog';
import { getPersistedRecentReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const reviews = await getPersistedRecentReviews(24);

  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Community activity</p>
        <h1>Recent writing</h1>
        <p>
          Only published member reviews appear here now. There is no seeded notebook or fake launch activity left in the feed.
        </p>
      </section>

      <BotanicalDivider label="Published reviews" />

      <div className="timeline-list">
        {reviews.length ? (
          reviews.map((review: (typeof reviews)[number]) => {
            const href = getReviewTargetHref(review);
            const thumb = getReviewThumbnail(review, 400);
            return (
              <GildedCard
                key={review.slug}
                title={review.title}
                eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}
                href={href}
                thumbnail={thumb ? { src: thumb.src, alt: thumb.alt, width: 400, height: 200 } : undefined}
              >
                <p>{review.excerpt}</p>
                <p className="meta-note">Open the linked artwork, artist, or exhibition page to read this published response in context.</p>
              </GildedCard>
            );
          })
        ) : (
          <GildedCard title="No published reviews yet" eyebrow="A quiet feed">
            <p>There is no seeded notebook anymore. This page stays empty until a real member publishes criticism.</p>
            <Link href="/reviews/new" className="text-link">
              Go to the review composer
            </Link>
          </GildedCard>
        )}
      </div>
    </div>
  );
}
