import Link from 'next/link';
import { RatingStars } from '@/src/components/RatingStars';
import type { HomePageData } from '@/src/components/home/types';
import {
  formatMemberAttribution,
  getArtworkThumbnail,
  getRepresentativeArtwork,
  getReviewTargetHref,
  getReviewThumbnail
} from '@/src/lib/catalog';

type RevampedHomePageProps = {
  data: HomePageData;
};

type ExploreCard = {
  label: string;
  title: string;
  meta: string;
  description: string;
  href: string;
  image?: {
    src: string;
    alt: string;
  };
};

const valueItems = [
  {
    title: 'Track what you love',
    body: 'Log paintings, prints, and museum visits without turning the experience into a spreadsheet.'
  },
  {
    title: 'Catalog artworks and artists',
    body: 'Keep artworks, artists, and exhibitions tied together in one shared art record.'
  },
  {
    title: 'See what others love',
    body: 'Follow emerging taste, browse public notes, and notice which works keep resurfacing.'
  },
  {
    title: 'Curate your own lists',
    body: 'Build thematic collections, favorites, and future viewing paths as the catalog grows.'
  }
];

export function RevampedHomePage({ data }: RevampedHomePageProps) {
  const { featuredArtworks, featuredArtists, heroArtist, heroArtwork, heroImageUrl, primaryVenue, recentReviews } = data;
  const supportingArtwork = featuredArtworks[1] ?? featuredArtworks[0];
  const communityArtwork = featuredArtworks[2] ?? supportingArtwork ?? heroArtwork;
  const spotlightArtist = featuredArtists[0] ?? heroArtist;
  const spotlightArtwork = spotlightArtist ? getRepresentativeArtwork(spotlightArtist.slug) : undefined;
  const recentReview = recentReviews[0];

  const exploreCards: ExploreCard[] = [
    {
      label: 'Artwork',
      title: heroArtwork.title,
      meta: heroArtist ? `${heroArtist.name} · ${heroArtwork.year}` : heroArtwork.year,
      description: heroArtwork.summary,
      href: `/artworks/${heroArtwork.slug}`,
      image: heroImageUrl ? { src: heroImageUrl, alt: heroArtwork.title } : undefined
    },
    spotlightArtist
      ? {
          label: 'Artist spotlight',
          title: spotlightArtist.name,
          meta: spotlightArtist.years,
          description: spotlightArtist.portraitLabel,
          href: `/artists/${spotlightArtist.slug}`,
          image: spotlightArtwork
            ? {
                src: getArtworkThumbnail(spotlightArtwork, 720) ?? '',
                alt: `${spotlightArtwork.title} by ${spotlightArtist.name}`
              }
            : undefined
        }
      : {
          label: 'Artist spotlight',
          title: 'Artist dossiers are opening soon',
          meta: 'Artists',
          description: 'Vernissage keeps room for long-form artist pages alongside the image-first catalog.',
          href: '/search'
        },
    {
      label: 'Exhibitions',
      title: primaryVenue ? `Log visits at ${primaryVenue.name}` : 'Exhibitions are coming into view',
      meta: primaryVenue ? `${primaryVenue.city}, ${primaryVenue.country}` : 'Museum visits',
      description: primaryVenue
        ? `Exhibition records are still being added, but venues like ${primaryVenue.name} are already part of the world the app is built for.`
        : 'Track what you have seen in museums and exhibitions as soon as the records are ready.',
      href: '/search',
      image: supportingArtwork
        ? {
            src: getArtworkThumbnail(supportingArtwork, 720) ?? '',
            alt: supportingArtwork.title
          }
        : undefined
    },
    recentReview
      ? {
          label: 'Review',
          title: recentReview.title,
          meta: formatMemberAttribution(recentReview.memberHandle, recentReview.publishedOn),
          description: recentReview.excerpt,
          href: getReviewTargetHref(recentReview),
          image: (() => {
            const thumbnail = getReviewThumbnail(recentReview, 720);
            return thumbnail ? { src: thumbnail.src, alt: thumbnail.alt } : undefined;
          })()
        }
      : {
          label: 'Community',
          title: 'Be the first voice in the room',
          meta: 'Published criticism',
          description: 'There are no seeded reviews now. The homepage stays honest until a real member publishes the first response.',
          href: '/reviews/new',
          image: communityArtwork
            ? {
                src: getArtworkThumbnail(communityArtwork, 720) ?? '',
                alt: communityArtwork.title
              }
            : undefined
        }
  ].map((card) => ({
    ...card,
    image: card.image?.src ? card.image : undefined
  }));

  return (
    <div className="revamp-home">
      <section className="revamp-home__hero">
        <div className="revamp-home__hero-copy">
          <p className="revamp-home__eyebrow">A social catalog for art</p>
          <h1>Track the art you love.</h1>
          <p className="revamp-home__lede">Discover, rate, and catalog artworks, exhibitions, and artists.</p>
          <p className="revamp-home__body">
            Vernissage turns art discovery into something closer to an exhibition diary than a generic app dashboard: a place to remember what you saw, what you loved, and what you want to revisit.
          </p>
          <div className="revamp-home__actions">
            <Link href="/join" className="deco-button deco-button--primary">
              Sign up for free
            </Link>
            <Link href="/search" className="deco-button deco-button--secondary">
              Explore the community
            </Link>
          </div>
          <dl className="revamp-home__hero-stats">
            <div>
              <dt>Featured works</dt>
              <dd>{featuredArtworks.length}</dd>
            </div>
            <div>
              <dt>Artist dossiers</dt>
              <dd>{featuredArtists.length}</dd>
            </div>
            <div>
              <dt>Live reviews</dt>
              <dd>{recentReviews.length}</dd>
            </div>
          </dl>
        </div>

        <div className="revamp-home__hero-visual">
          <div className="revamp-home__hero-frame">
            {heroImageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroImageUrl} alt={heroArtwork.title} className="revamp-home__hero-image" width={900} height={1100} />
                <div className="revamp-home__log-card">
                  <div className="revamp-home__log-card-header">
                    {heroImageUrl ? (
                      <div className="revamp-home__log-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={heroImageUrl} alt="" width={96} height={96} aria-hidden="true" />
                      </div>
                    ) : null}
                    <div>
                      <p className="revamp-home__card-label">Logged artwork</p>
                      <h2>{heroArtwork.title}</h2>
                      <p>{heroArtist?.name ?? 'Artist forthcoming'}</p>
                    </div>
                  </div>
                  <div className="revamp-home__log-meta">
                    <div>
                      <span>Seen at</span>
                      <strong>{primaryVenue?.name ?? 'Museum visit'}</strong>
                    </div>
                    <div>
                      <span>Date</span>
                      <strong>Opening night</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <strong>Logged</strong>
                    </div>
                  </div>
                  <RatingStars rating={4} />
                </div>
              </>
            ) : (
              <div className="revamp-home__hero-placeholder">
                <p>Artwork imagery is still being prepared for this hero placement.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="revamp-value-strip" aria-label="Why join Vernissage">
        {valueItems.map((item) => (
          <article key={item.title} className="revamp-value-strip__item">
            <span className="revamp-value-strip__icon" aria-hidden="true">
              ◇
            </span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="revamp-explore">
        <div className="revamp-explore__header">
          <div>
            <p className="revamp-home__eyebrow">Explore The Vernissage</p>
            <h2>Browse the catalog the way you browse taste.</h2>
          </div>
          <Link href="/search" className="revamp-explore__view-all">
            View all →
          </Link>
        </div>

        <div className="revamp-explore__grid">
          {exploreCards.map((card) => (
            <Link key={`${card.label}-${card.title}`} href={card.href} className="revamp-explore-card">
              {card.image ? (
                <div className="revamp-explore-card__image-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.image.src} alt={card.image.alt} className="revamp-explore-card__image" width={720} height={480} />
                </div>
              ) : null}
              <div className="revamp-explore-card__body">
                <p className="revamp-explore-card__label">{card.label}</p>
                <h3>{card.title}</h3>
                <p className="revamp-explore-card__meta">{card.meta}</p>
                <p>{card.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="revamp-community-cta">
        <div className="revamp-community-cta__art" aria-hidden="true">
          <div className="revamp-community-cta__frame">
            <span className="revamp-community-cta__monogram">V</span>
            <span>Track artworks</span>
            <span>Review artists</span>
            <span>Log museum visits</span>
          </div>
        </div>
        <div className="revamp-community-cta__copy">
          <p className="revamp-home__eyebrow">Community</p>
          <h2>Join a community that catalogs art.</h2>
          <p>
            Build your profile, track what you have seen, and discover new work through the taste of other members. Signup stays lightweight: choose a handle, set a password, and start logging.
          </p>
          <div className="revamp-home__actions">
            <Link href="/join" className="deco-button deco-button--primary">
              Claim your handle
            </Link>
            <Link href="/reviews/new" className="deco-button deco-button--secondary">
              Start with a review
            </Link>
          </div>
          <p className="revamp-community-cta__note">No email-confirmation maze. Just enough ceremony to start cataloging art.</p>
        </div>
      </section>
    </div>
  );
}
