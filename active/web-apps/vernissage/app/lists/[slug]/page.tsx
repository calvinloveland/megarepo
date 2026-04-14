import { notFound } from 'next/navigation';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { artworkLists, formatMemberAttribution, getArtwork, getList } from '@/src/lib/catalog';

export function generateStaticParams() {
  return artworkLists.map((list) => ({ slug: list.slug }));
}

export default async function ListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const list = getList(slug);
  if (!list) {
    notFound();
  }

  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">{formatMemberAttribution(list.memberHandle, list.visibility)}</p>
        <h1>{list.title}</h1>
        <p className="lead">{list.description}</p>
      </section>

      <BotanicalDivider label="Ordered sequence" />

      <ol className="ordered-catalog">
        {list.items.map((item, index) => {
          const artwork = getArtwork(item.artworkSlug);
          if (!artwork) return null;
          return (
            <li key={item.artworkSlug}>
              <GildedCard title={`${index + 1}. ${artwork.title}`} eyebrow={artwork.year} subtitle={artwork.medium} href={`/artworks/${artwork.slug}`}>
                <p>{item.note}</p>
                <p className="meta-note">{artwork.summary}</p>
              </GildedCard>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
