import type { Artwork } from '@/src/lib/catalog';

type ArtworkFigureProps = {
  artwork: Artwork;
  src?: string;
  priority?: boolean;
  variant?: 'default' | 'immersive';
};

export function ArtworkFigure({ artwork, src, priority = false, variant = 'default' }: ArtworkFigureProps) {
  const imageSrc = src || artwork.image;
  return (
    <figure className={`artwork-figure${variant === 'immersive' ? ' artwork-figure--immersive' : ''}`}>
      <div className="artwork-figure__frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={artwork.title}
          width={artwork.width}
          height={artwork.height}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          className="artwork-figure__image"
        />
      </div>
      <figcaption className="artwork-figure__caption">
        <strong>{artwork.title}</strong>
        <span>{artwork.year}</span>
      </figcaption>
    </figure>
  );
}
