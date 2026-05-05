import Image from 'next/image';
import Link from 'next/link';
import { RatingStars } from '@/src/components/RatingStars';

const topbarItems = [
  { label: 'Discover', href: '/search' },
  { label: 'Diary', href: '/feed' },
  { label: 'Lists', href: '/search?view=lists' },
  { label: 'Artists', href: '/search?view=artists' },
  { label: 'Exhibitions', href: '/search?view=exhibitions' }
];

const heroArtwork = {
  title: 'Chaos No. 2',
  artist: 'Hilma af Klint',
  imageSrc: '/artworks/hilma-af-klint-chaos-no-2.jpg',
  imageAlt: 'Chaos No. 2 by Hilma af Klint',
  seenAt: 'Moderna Museet',
  date: 'May 2',
  status: 'Logged'
};

const featureItems = [
  {
    icon: '🖼',
    title: 'Track what you love',
    body: 'Catalog artworks, exhibitions, and artists in your personal collection.'
  },
  {
    icon: '◐',
    title: 'See what others love',
    body: 'Follow friends and art lovers. Discover recommendations you’ll actually care about.'
  },
  {
    icon: '✒',
    title: 'Share your voice',
    body: 'Review exhibitions and artworks. Join real conversations about art.'
  },
  {
    icon: '◌',
    title: 'Curate your lists',
    body: 'Build and share beautiful lists about themes, artists, movements, and more.'
  }
];

const exploreItems = [
  {
    label: 'Trending list',
    title: 'Iconic paintings of the 20th century',
    meta: '78 artworks • 1.2K saves',
    artClass: 'reference-home__art reference-home__art--abstract'
  },
  {
    label: 'Artist spotlight',
    title: 'Frida Kahlo',
    meta: '45 artworks • 3.7K followers',
    artClass: 'reference-home__art reference-home__art--frida'
  },
  {
    label: 'Exhibition',
    title: 'Yayoi Kusama: Infinity Mirror Rooms',
    meta: 'Tate Modern • London',
    artClass: 'reference-home__art reference-home__art--lights'
  },
  {
    label: 'Review',
    title: 'Michelangelo: The Eternal Genius',
    meta: '★★★★★ 4.8',
    artClass: 'reference-home__art reference-home__art--statue'
  }
];

const footerColumns = [
  {
    title: 'Explore',
    links: ['Discover', 'Reviews', 'Lists', 'Exhibitions', 'Artists']
  },
  {
    title: 'Community',
    links: ['Guidelines', 'Blog', 'Help Center', 'Contact']
  },
  {
    title: 'Company',
    links: ['About', 'Careers', 'Press', 'Privacy', 'Terms']
  }
];

export function ReferenceHomePage() {
  return (
    <div className="reference-home">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .skip-link,
            .page-ornament,
            .floating-nav,
            .footer-shell {
              display: none !important;
            }

            .site-shell {
              width: 100% !important;
              max-width: none !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            body {
              background: #091010 !important;
            }
          `
        }}
      />

      <section className="reference-home__hero">
        <header className="reference-home__topbar">
          <div className="reference-home__brand-lockup">
            <p className="reference-home__brand">The Vernissage</p>
            <p className="reference-home__tagline">A social catalog for art</p>
          </div>
          <nav className="reference-home__nav" aria-label="Reference homepage navigation">
            {topbarItems.map((item) => (
              <Link key={item.label} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="reference-home__auth">
            <Link href="/signin" className="reference-home__auth-link reference-home__auth-link--ghost">
              Log in
            </Link>
            <Link href="/join" className="reference-home__auth-link reference-home__auth-link--solid">
              Sign up
            </Link>
          </div>
        </header>

        <div className="reference-home__hero-copy">
          <div className="reference-home__hero-body">
            <p className="reference-home__hero-kicker">Art diary · reviews · lists</p>
            <h1>Track the art you love.</h1>
            <div className="reference-home__divider" aria-hidden="true" />
            <p className="reference-home__intro">Discover, rate, and catalog artworks, exhibitions, and artists.</p>
            <div className="reference-home__cta-row">
              <Link href="/join" className="reference-home__cta reference-home__cta--solid">
                Sign up for free
              </Link>
              <Link href="/feed" className="reference-home__cta reference-home__cta--ghost">
                Explore the community
              </Link>
            </div>
          </div>
        </div>

        <div className="reference-home__hero-visual">
          <div className="reference-home__hero-stage">
            <div className="reference-home__hero-orbit reference-home__hero-orbit--outer" aria-hidden="true" />
            <div className="reference-home__hero-orbit reference-home__hero-orbit--inner" aria-hidden="true" />
            <div className="reference-home__hero-note" aria-hidden="true">
              <span>Recently saved</span>
              <strong>Build a diary of paintings, artists, and museum visits.</strong>
            </div>
            <div className="reference-home__hero-artwork-frame">
              <div className="reference-home__hero-artwork-matte">
                <Image
                  src={heroArtwork.imageSrc}
                  alt={heroArtwork.imageAlt}
                  className="reference-home__hero-artwork-image"
                  width={462}
                  height={560}
                  priority
                />
              </div>
            </div>
            <article className="reference-home__log-card">
              <div className="reference-home__log-card-header">
                <div className="reference-home__log-thumb">
                  <Image src={heroArtwork.imageSrc} alt="" width={92} height={112} aria-hidden="true" />
                </div>
                <div>
                  <p className="reference-home__card-label">Logged artwork</p>
                  <h2>{heroArtwork.title}</h2>
                  <p>{heroArtwork.artist}</p>
                </div>
              </div>
              <dl className="reference-home__log-meta reference-home__log-meta--detailed">
                <div>
                  <span>Seen at</span>
                  <strong>{heroArtwork.seenAt}</strong>
                </div>
                <div>
                  <span>Date</span>
                  <strong>{heroArtwork.date}</strong>
                </div>
                <div>
                  <span>Rating</span>
                  <RatingStars rating={4} />
                </div>
                <div>
                  <span>Status</span>
                  <strong>{heroArtwork.status}</strong>
                </div>
              </dl>
            </article>
          </div>
        </div>
      </section>

      <section className="reference-home__features">
        {featureItems.map((item) => (
          <article key={item.title} className="reference-home__feature-card">
            <div className="reference-home__feature-icon" aria-hidden="true">
              {item.icon}
            </div>
            <h2>{item.title}</h2>
            <div className="reference-home__tiny-divider" aria-hidden="true" />
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="reference-home__explore">
        <div className="reference-home__section-header">
          <h2>Explore The Vernissage</h2>
          <Link href="#">View all →</Link>
        </div>
        <div className="reference-home__card-grid">
          {exploreItems.map((item) => (
            <article key={item.title} className="reference-home__explore-card">
              <div className={item.artClass} aria-hidden="true" />
              <div className="reference-home__explore-body">
                <p className="reference-home__eyebrow">{item.label}</p>
                <h3>{item.title}</h3>
                <p className="reference-home__meta">{item.meta}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="reference-home__join-banner">
        <div className="reference-home__join-art" aria-hidden="true">
          <div className="reference-home__join-figure" />
        </div>
        <div className="reference-home__join-copy">
          <h2>
            Join a community
            <br />
            that sees art
            <br />
            differently.
          </h2>
          <p>
            The Vernissage is free to join. Build your profile, curate your world, and connect with art lovers around the globe.
          </p>
        </div>
        <div className="reference-home__join-form">
          <div className="reference-home__join-input-row">
            <div className="reference-home__input">Enter your email</div>
            <div className="reference-home__join-button">Sign up for free</div>
          </div>
          <div className="reference-home__avatars" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p>Join thousands of art lovers already on The Vernissage.</p>
        </div>
      </section>

      <footer className="reference-home__footer">
        <div className="reference-home__footer-brand">
          <div className="reference-home__footer-mark">V</div>
          <div>
            <p className="reference-home__brand">The Vernissage</p>
            <p>A social cataloguing platform for art lovers.</p>
          </div>
        </div>
        <div className="reference-home__footer-columns">
          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3>{column.title}</h3>
              {column.links.map((link) => (
                <p key={link}>{link}</p>
              ))}
            </div>
          ))}
        </div>
        <div className="reference-home__footer-art" aria-hidden="true" />
      </footer>
    </div>
  );
}
