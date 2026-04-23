import Link from 'next/link';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { PageIntro } from '@/src/components/PageIntro';
import { formatMemberAttribution, getReviewTargetHref, getReviewThumbnail } from '@/src/lib/catalog';
import { getPersistedRecentReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

function getFeedReviewLabel(targetType: string) {
  if (targetType === 'artist') {
    return 'Artist review';
  }

  if (targetType === 'exhibition') {
    return 'Exhibition review';
  }

  if (targetType === 'visit') {
    return 'Museum visit';
  }

  return 'Artwork review';
}

export default async function FeedPage() {
  const reviews = await getPersistedRecentReviews(24);

  return (
    <div className="page-stack page-stack--narrow">
      <PageIntro eyebrow="Member reviews & responses" title="What Vernissage members are writing">
        <p>
          Every piece here is written by a real member of Vernissage. Follow the newest arguments, discoveries, and
          reactions as the collection gets read in public.
        </p>
      </PageIntro>

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
                eyebrow={`${formatMemberAttribution(review.memberHandle, review.publishedOn)} · ${getFeedReviewLabel(review.targetType)}`}
                href={href}
                thumbnail={thumb ? { src: thumb.src, alt: thumb.alt, width: 400, height: 200 } : undefined}
              >
                <p>{review.excerpt}</p>
                <p className="meta-note">Open the linked page to read the full response in context and follow the conversation there.</p>
              </GildedCard>
            );
          })
        ) : (
          <GildedCard title="Be the first voice" eyebrow="Empty, not abandoned">
            <p>Vernissage starts with real people writing about art they care about. Your first published review helps set the tone.</p>
            <Link href="/reviews/new" className="text-link">
              Publish your first review
            </Link>
          </GildedCard>
        )}
      </div>
    </div>
  );
}
