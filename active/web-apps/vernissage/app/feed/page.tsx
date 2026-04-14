import Link from 'next/link';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { feed, formatMemberAttribution } from '@/src/lib/catalog';

export default function FeedPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Curated notebook</p>
        <h1>The launch notebook</h1>
        <p>
          This ribbon is editorial for launch: a guided notebook of reviews, lists, and museum logs from the house collection
          while live community activity accumulates on detail pages.
        </p>
      </section>

      <BotanicalDivider label="Curated dispatches" />

      <div className="timeline-list">
        {feed.map((item) => (
          <GildedCard
            key={`${item.type}-${item.memberHandle}-${item.publishedOn}`}
            title={item.headline}
            eyebrow={formatMemberAttribution(item.memberHandle, item.publishedOn)}
          >
            <p>{item.detail}</p>
            <p className="meta-note">Published community reviews appear on the linked artwork, artist, exhibition, or list pages.</p>
            <Link href={item.href} className="text-link">
              Open this entry
            </Link>
          </GildedCard>
        ))}
      </div>
    </div>
  );
}
