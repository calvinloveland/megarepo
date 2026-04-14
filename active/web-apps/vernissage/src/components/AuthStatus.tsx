'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';

import { EnamelButton } from '@/src/components/EnamelButton';

export function AuthStatus() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="floating-nav__action">
        <span className="eyebrow">Checking session…</span>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="floating-nav__action button-row">
        <EnamelButton href="/signin" variant="secondary">
          Sign in
        </EnamelButton>
        <EnamelButton href="/join">Join Vernissage</EnamelButton>
      </div>
    );
  }

  return (
    <div className="floating-nav__action button-row">
      <Link href={session.user.handle ? `/members/${session.user.handle}` : '/reviews/new'} className="floating-nav__link">
        {session.user.name ?? session.user.email ?? 'Account'}
      </Link>
      <EnamelButton href="/reviews/new">Compose a review</EnamelButton>
      <button type="button" className="enamel-button enamel-button--secondary" onClick={() => signOut({ callbackUrl: '/' })}>
        Sign out
      </button>
    </div>
  );
}
