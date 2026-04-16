import { EnamelButton } from '@/src/components/EnamelButton';
import { EnamelChip } from '@/src/components/EnamelChip';
import type { Artwork } from '@/src/lib/catalog';
import { getArtist, getArtworkThumbnail } from '@/src/lib/catalog';

type ArtworkPreviewCardProps = {
  artwork: Artwork;
  showArtistLink?: boolean;
};

export function ArtworkPreviewCard({ artwork, showArtistLink = true }: ArtworkPreviewCardProps) {
  const artist = getArtist(artwork.artistSlug);

  return (
    <section className="gilded-card artwork-preview-card">
      <div className="gilded-card__thumbnail artwork-preview-card__thumbnail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getArtworkThumbnail(artwork, 500)}
          alt={artwork.title}
          width={500}
          height={334}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          className="gilded-card__thumbnail-img"
        />
      </div>
      <header className="gilded-card__header">
        {artist ? <p className="eyebrow">{artist.name}</p> : null}
        <h3>{artwork.title}</h3>
        <p className="gilded-card__subtitle">{artwork.year} · {artwork.medium}</p>
      </header>
      <div className="chip-row chip-row--compact">
        {artwork.tags.slice(0, 3).map((tag, index) => (
          <EnamelChip key={tag} tone={index === 1 ? 'moss' : 'gold'}>
            {tag}
          </EnamelChip>
        ))}
      </div>
      <div className="button-row artwork-preview-card__actions">
        <EnamelButton href={`/artworks/${artwork.slug}`}>View artwork</EnamelButton>
        {showArtistLink && artist ? (
          <EnamelButton href={`/artists/${artist.slug}`} variant="secondary">
            View artist
          </EnamelButton>
        ) : null}
      </div>
    </section>
  );
}
