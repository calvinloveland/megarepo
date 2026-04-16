import { ArtworkFigure } from '@/src/components/ArtworkFigure';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { CatalogRequestCard } from '@/src/components/CatalogRequestCard';
import { DropCap } from '@/src/components/DropCap';
import { EnamelButton } from '@/src/components/EnamelButton';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { RatingStars } from '@/src/components/RatingStars';
import {
  formatMemberAttribution,
  getArtist,
  getArtwork,
  getArtworkThumbnail,
  getFeaturedArtists,
  getFeaturedArtworks,
  getFeaturedExhibitions,
  getMosaicArtworks,
  getRepresentativeArtwork,
  getReviewTargetHref,
  getReviewThumbnail,
  getVenue,
  site
} from '@/src/lib/catalog';
import { getPersistedRecentReviews } from '@/src/lib/live-data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const featuredArtworks = getFeaturedArtworks();
  const heroArtwork = featuredArtworks[0];
  const heroArtist = getArtist(heroArtwork.artistSlug);
  const heroImageUrl = getArtworkThumbnail(heroArtwork, 700);
  const mosaicArtworks = getMosaicArtworks([heroArtwork.slug]);
  const featuredExhibitions = getFeaturedExhibitions();
  const featuredArtists = getFeaturedArtists();
  const recentReviews = await getPersistedRecentReviews(4);

  return (
    <div className="page-stack">
      <link rel="preload" as="image" href={heroImageUrl} />
      <section className="hero-shell">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">An art review salon in emerald, gold, and parchment</p>
            <h1>{site.tagline}</h1>
            <DropCap text={site.intro} />
            <div className="button-row">
              <EnamelButton href="/reviews/new">Write a review</EnamelButton>
              <EnamelButton href="/search" variant="secondary">
                Browse the catalog
              </EnamelButton>
            </div>
            <div className="chip-row">
              <EnamelChip>Artworks</EnamelChip>
              <EnamelChip tone="moss">Artists</EnamelChip>
              <EnamelChip tone="rose">Exhibitions</EnamelChip>
              <EnamelChip tone="burgundy">Museum visits</EnamelChip>
            </div>
          </div>
          <div className="hero-artwork">
            <ArtworkFigure artwork={heroArtwork} src={heroImageUrl} priority variant="immersive" />
            <div className="stat-ribbon">
              <p>{heroArtist?.name}</p>
              <span>{heroArtwork.year} · {heroArtwork.medium}</span>
            </div>
          </div>
        </div>
      </section>

      <BotanicalDivider label="From the launch collection" />

      <section className="mosaic-grid">
        {mosaicArtworks.map((artwork) => {
          const artist = getArtist(artwork.artistSlug);
          return (
            <GildedCard
              key={artwork.slug}
              title={artwork.title}
              eyebrow={artist?.name}
              subtitle={`${artwork.year} · ${artwork.medium}`}
              href={`/artworks/${artwork.slug}`}
              thumbnail={{ src: getArtworkThumbnail(artwork, 400), alt: artwork.title, width: 400, height: 267 }}
            >
              <p>{artwork.summary}</p>
              <div className="chip-row chip-row--compact">
                {artwork.tags.slice(0, 3).map((tag, index) => (
                  <EnamelChip key={tag} tone={index === 1 ? 'moss' : 'gold'}>
                    {tag}
                  </EnamelChip>
                ))}
              </div>
            </GildedCard>
          );
        })}
      </section>

      <section className="three-up-grid">
        <GildedCard title="Featured artists" eyebrow="House favorites">
          <ul className="plain-list artist-list">
            {featuredArtists.map((artist) => {
              const repArtwork = getRepresentativeArtwork(artist.slug);
              return (
                <li key={artist.slug} className="artist-row">
                  {repArtwork && (
                    <span className="artist-row__thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={getArtworkThumbnail(repArtwork, 120)} alt={`${repArtwork.title} by ${artist.name}`} width={48} height={48} />
                    </span>
                  )}
                  <div className="artist-row__info">
                    <strong>{artist.name}</strong>
                    <p>{artist.portraitLabel}</p>
                  </div>
                  <EnamelButton href={`/artists/${artist.slug}`} variant="secondary">
                    View
                  </EnamelButton>
                </li>
              );
            })}
          </ul>
        </GildedCard>

        <GildedCard title="Community writing" eyebrow="Published activity" href="/feed">
          {recentReviews.length ? (
            <ol className="ordered-mini-list">
              {recentReviews.slice(0, 3).map((review: (typeof recentReviews)[number]) => (
                <li key={review.slug}>{review.title}</li>
              ))}
            </ol>
          ) : (
            <p>No member reviews have been published yet. The first real response will appear here once someone writes it.</p>
          )}
        </GildedCard>

        <CatalogRequestCard
          title="Request an artist or artwork"
          eyebrow="Collection requests"
          body="If the launch catalog is missing a painter, printmaker, or specific work you want to discuss, send a catalog request straight from the site."
          initialText="I'd love to see this artist or artwork added to the Vernissage catalog."
        />
      </section>

      <BotanicalDivider label="Current exhibitions" />

      <section className="two-up-grid">
        {featuredExhibitions.length ? (
          featuredExhibitions.map((exhibition) => {
            const venue = getVenue(exhibition.venueSlug);
            const heroArt = getArtwork(exhibition.heroArtworkSlug);
            return (
              <GildedCard
                key={exhibition.slug}
                title={exhibition.title}
                eyebrow={venue ? `${venue.name} · ${venue.city}` : 'Venue'}
                subtitle={exhibition.dateLabel}
                href={`/exhibitions/${exhibition.slug}`}
                thumbnail={heroArt ? { src: getArtworkThumbnail(heroArt, 500), alt: heroArt.title, width: 500, height: 250 } : undefined}
              >
                <p>{exhibition.description}</p>
                <p className="meta-note">{exhibition.artworkSlugs.length} catalogued works are currently attached to this exhibition record.</p>
              </GildedCard>
            );
          })
        ) : (
          <GildedCard title="Exhibitions forthcoming" eyebrow="No verified show records yet">
            <p>Vernissage has venues ready, but no exhibition records are published yet because we are not seeding synthetic show history.</p>
          </GildedCard>
        )}
      </section>

      <BotanicalDivider label="Featured criticism" />

      <section className="review-grid">
        {recentReviews.length ? (
          recentReviews.map((review: (typeof recentReviews)[number]) => {
            const thumb = getReviewThumbnail(review, 400);
            return (
              <GildedCard
                key={review.slug}
                title={review.title}
                eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}
                href={getReviewTargetHref(review)}
                thumbnail={thumb ? { src: thumb.src, alt: thumb.alt, width: 400, height: 200 } : undefined}
              >
                <RatingStars rating={review.rating} />
                <p>{review.excerpt}</p>
                <div className="chip-row chip-row--compact">
                  {review.tags.map((tag: string, index: number) => (
                    <EnamelChip key={tag} tone={index % 2 === 0 ? 'gold' : 'rose'}>
                      {tag}
                    </EnamelChip>
                  ))}
                </div>
              </GildedCard>
            );
          })
        ) : (
          <GildedCard title="No published criticism yet" eyebrow="Waiting for the first review">
            <p>There are no seeded salon reviews anymore. This section will stay empty until a real member publishes one.</p>
          </GildedCard>
        )}
      </section>
    </div>
  );
}
