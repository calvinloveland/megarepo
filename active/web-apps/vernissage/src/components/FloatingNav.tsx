import Link from 'next/link';
import { AuthStatus } from '@/src/components/AuthStatus';

const navItems = [
  { href: '/', label: 'Salon' },
  { href: '/feed', label: 'Notebook' },
  { href: '/search', label: 'Browse' },
  { href: '/reviews/new', label: 'Write' }
];

export function FloatingNav() {
  return (
    <header className="floating-nav">
      <Link href="/" className="floating-nav__brand">
        <span className="floating-nav__crest">V</span>
        <span>
          <strong>Vernissage</strong>
          <small>The Gilded Manuscript</small>
        </span>
      </Link>
      <nav className="floating-nav__links" aria-label="Primary navigation">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className="floating-nav__link">
            {item.label}
          </Link>
        ))}
      </nav>
      <AuthStatus />
    </header>
  );
}
