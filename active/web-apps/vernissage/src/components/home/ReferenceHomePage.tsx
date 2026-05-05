import Link from 'next/link';

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
        <div className="reference-home__hero-copy">
          <header className="reference-home__topbar">
            <div>
              <p className="reference-home__brand">The Vernissage</p>
              <p className="reference-home__tagline">A social cataloguing platform for art lovers</p>
            </div>
            <nav className="reference-home__nav" aria-label="Reference homepage navigation">
              <Link href="#">Discover</Link>
              <Link href="#">Reviews</Link>
              <Link href="#">Lists</Link>
              <Link href="#">Artists</Link>
              <Link href="#">Exhibitions</Link>
            </nav>
            <div className="reference-home__auth">
              <Link href="#" className="reference-home__auth-link reference-home__auth-link--ghost">
                Log in
              </Link>
              <Link href="#" className="reference-home__auth-link reference-home__auth-link--solid">
                Sign up
              </Link>
            </div>
          </header>

          <div className="reference-home__hero-body">
            <h1>
              Your world
              <br />
              of art.
              <br />
              <span>Curated by you.</span>
            </h1>
            <div className="reference-home__divider" aria-hidden="true" />
            <p className="reference-home__intro">
              Discover, track, and share the art that inspires you. Join a global community of art lovers and see art differently.
            </p>
            <div className="reference-home__cta-row">
              <Link href="#" className="reference-home__cta reference-home__cta--solid">
                Sign up for free
              </Link>
              <Link href="#" className="reference-home__cta reference-home__cta--ghost">
                Explore the community
              </Link>
            </div>
          </div>
        </div>

        <div className="reference-home__hero-visual" aria-hidden="true">
          <div className="reference-home__gallery-wall" />
          <div className="reference-home__frame reference-home__frame--large" />
          <div className="reference-home__frame reference-home__frame--top" />
          <div className="reference-home__frame reference-home__frame--small" />
          <div className="reference-home__figure">
            <div className="reference-home__figure-head" />
            <div className="reference-home__figure-bun" />
            <div className="reference-home__figure-body" />
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
