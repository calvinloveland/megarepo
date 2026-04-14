import type { ReactNode } from 'react';
import Link from 'next/link';

type ThumbnailProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

type GildedCardProps = {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  href?: string;
  className?: string;
  thumbnail?: ThumbnailProps;
  eager?: boolean;
  children: ReactNode;
};

export function GildedCard({ title, eyebrow, subtitle, href, className = '', thumbnail, children }: GildedCardProps) {
  const content = (
    <>
      {thumbnail && (
        <div className="gilded-card__thumbnail">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnail.src}
            alt={thumbnail.alt}
            width={thumbnail.width}
            height={thumbnail.height}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="gilded-card__thumbnail-img"
          />
        </div>
      )}
      <header className="gilded-card__header">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3>{title}</h3>
        {subtitle ? <p className="gilded-card__subtitle">{subtitle}</p> : null}
      </header>
      <div className="gilded-card__body">{children}</div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`gilded-card ${className}`.trim()}>
        {content}
      </Link>
    );
  }

  return <section className={`gilded-card ${className}`.trim()}>{content}</section>;
}
