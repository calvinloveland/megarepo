import type { ReactNode } from 'react';
import Link from 'next/link';

type EnamelButtonProps = {
  children: ReactNode;
  href?: string;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary';
};

export function EnamelButton({ children, href, type = 'button', variant = 'primary' }: EnamelButtonProps) {
  const className = `enamel-button enamel-button--${variant}`;

  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={className}>
      {children}
    </button>
  );
}
