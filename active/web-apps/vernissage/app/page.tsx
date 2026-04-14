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
  getFeaturedList,
  getMosaicArtworks,
  getRepresentativeArtwork,
  getReviewThumbnail,
  getVenue,
  reviews,
  site
} from '@/src/lib/catalog';

export default function HomePage() {
  const featuredArtworks = getFeaturedArtworks();
  const heroArtwork = featuredArtworks[0];
  const heroArtist = getArtist(heroArtwork.artistSlug);
  const heroImageUrl = getArtworkThumbnail(heroArtwork, 700);
  const mosaicArtworks = getMosaicArtworks([heroArtwork.slug]);
  const featuredExhibitions = getFeaturedExhibitions();
  const featuredArtists = getFeaturedArtists();
  const featuredList = getFeaturedList();
  const recentReviews = reviews.slice(0, 4);

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
            <ArtworkFigure artwork={heroArtwork} src={heroImageUrl} priority />
            <div className="stat-ribbon">
              <p>{heroArtist?.name}</p>
              <RatingStars rating={heroArtwork.rating} />
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

        <GildedCard
          title={featuredList?.title ?? 'Featured list'}
          eyebrow="Curated sequence"
          href={`/lists/${featuredList?.slug ?? ''}`}
          thumbnail={(() => {
            const firstArtwork = featuredList?.items[0] ? getArtwork(featuredList.items[0].artworkSlug) : undefined;
            return firstArtwork ? { src: getArtworkThumbnail(firstArtwork, 400), alt: firstArtwork.title, width: 400, height: 267 } : undefined;
          })()}
        >
          <p>{featuredList?.description}</p>
          <ol className="ordered-mini-list">
            {featuredList?.items.slice(0, 3).map((item) => {
              const artwork = getArtwork(item.artworkSlug);
              return <li key={item.artworkSlug}>{artwork?.title ?? item.artworkSlug.replaceAll('-', ' ')}</li>;
            })}
          </ol>
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
        {featuredExhibitions.map((exhibition) => {
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
              <p className="meta-note">Includes {exhibition.artworkSlugs.length} featured works and exhibition reviews.</p>
            </GildedCard>
          );
        })}
      </section>

      <BotanicalDivider label="Featured criticism" />

      <section className="review-grid">
        {recentReviews.map((review) => {
          const thumb = getReviewThumbnail(review, 400);
          return (
            <GildedCard
              key={review.slug}
              title={review.title}
              eyebrow={formatMemberAttribution(review.memberHandle, review.publishedOn)}
              thumbnail={thumb ? { src: thumb.src, alt: thumb.alt, width: 400, height: 200 } : undefined}
            >
              <RatingStars rating={review.rating} />
              <p>{review.excerpt}</p>
              <div className="chip-row chip-row--compact">
                {review.tags.map((tag, index) => (
                  <EnamelChip key={tag} tone={index % 2 === 0 ? 'gold' : 'rose'}>
                    {tag}
                  </EnamelChip>
                ))}
              </div>
            </GildedCard>
          );
        })}
      </section>
    </div>
  );
}
