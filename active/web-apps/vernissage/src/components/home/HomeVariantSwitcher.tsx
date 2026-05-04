import Link from 'next/link';
import type { HomeVariant } from '@/src/components/home/types';

type HomeVariantSwitcherProps = {
  currentVariant: HomeVariant;
};

const variantOptions: Array<{ href: string; label: string; variant: HomeVariant }> = [
  { href: '/', label: 'Revamped homepage', variant: 'revamp' },
  { href: '/?home=classic', label: 'Classic launch homepage', variant: 'classic' }
];

export function HomeVariantSwitcher({ currentVariant }: HomeVariantSwitcherProps) {
  return (
    <section className="home-variant-switcher" aria-label="Homepage comparison controls">
      <div>
        <p className="eyebrow">Homepage comparison</p>
        <h2>Compare the revamp with the original launch page.</h2>
        <p className="home-variant-switcher__copy">
          Use either view while the new landing page settles in. The classic homepage remains available for side-by-side judgment.
        </p>
      </div>
      <div className="home-variant-switcher__links" role="tablist" aria-label="Homepage variants">
        {variantOptions.map((option) => (
          <Link
            key={option.variant}
            href={option.href}
            className="home-variant-switcher__link"
            aria-current={currentVariant === option.variant ? 'page' : undefined}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
