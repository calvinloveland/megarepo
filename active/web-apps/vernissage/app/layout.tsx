import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Noto_Serif, Playfair_Display, Work_Sans } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { FeedbackWidget } from '@/src/components/FeedbackWidget';
import { FloatingNav } from '@/src/components/FloatingNav';
import { Providers } from '@/src/components/Providers';

const bodyFont = Noto_Serif({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '700']
});

const displayFont = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700']
});

const labelFont = Work_Sans({
  subsets: ['latin'],
  variable: '--font-label',
  weight: ['400', '500', '600']
});

export const metadata: Metadata = {
  metadataBase: new URL('https://vernissage.shsw.dev'),
  title: {
    default: 'Vernissage',
    template: '%s · Vernissage'
  },
  description:
    'Art Nouveau social catalog for artworks, artists, exhibitions, and museum visits.',
  alternates: {
    canonical: '/'
  },
  openGraph: {
    title: 'Vernissage',
    description: 'Art Nouveau social catalog for artworks, artists, exhibitions, and museum visits.',
    url: 'https://vernissage.shsw.dev',
    siteName: 'Vernissage',
    locale: 'en_US',
    type: 'website'
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vernissage',
    description: 'Art Nouveau social catalog for artworks, artists, exhibitions, and museum visits.'
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable} ${labelFont.variable}`}>
        <Providers>
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <div className="page-ornament page-ornament--left" aria-hidden="true" />
          <div className="page-ornament page-ornament--right" aria-hidden="true" />
          <FloatingNav />
          <main id="main-content" className="site-shell">
            {children}
          </main>
          <FeedbackWidget />
          <footer className="footer-shell">
            <p>Vernissage is a salon for reviewing visual art with a gilded, editorial interface.</p>
            <nav className="footer-shell__links" aria-label="Footer">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/contact">Contact</Link>
            </nav>
            <p className="footer-shell__meta">Artworks by Monet, Van Gogh, Seurat, and Cassatt courtesy of the Art Institute of Chicago via IIIF.</p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
