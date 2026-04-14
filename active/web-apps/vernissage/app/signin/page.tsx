import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { SignInForm } from '@/src/components/SignInForm';
import { authOptions } from '@/src/lib/auth';
import { isDatabaseConfigured } from '@/src/lib/prisma';

function errorMessageFor(code?: string) {
  if (code === 'CredentialsSignin') {
    return 'That sign-in attempt did not match a saved account.';
  }

  if (code === 'database-unavailable') {
    return 'The shared account database is not configured yet, so sign-in is temporarily unavailable.';
  }

  return '';
}

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect('/reviews/new');
  }

  const params = await searchParams;
  const callbackUrl = typeof params.callbackUrl === 'string' ? params.callbackUrl : '/reviews/new';
  const errorCode = typeof params.error === 'string' ? params.error : undefined;
  const registered = params.registered === '1';
  const identifier = typeof params.identifier === 'string' ? params.identifier : undefined;

  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">House access</p>
        <h1>Return to the salon</h1>
        <p>Sign in with the account you use to publish criticism, collect lists, and leave a public trace in the gallery ledger.</p>
      </section>

      <BotanicalDivider label="Sign in" />

      {registered ? (
        <p className="meta-note">
          Your account has been created. Sign in{identifier ? ` as ${identifier}` : ''} to start publishing.
        </p>
      ) : null}

      <SignInForm callbackUrl={callbackUrl} databaseReady={isDatabaseConfigured()} initialError={errorMessageFor(errorCode)} />

      <p className="meta-note">
        Need a new account? <Link href="/join" className="text-link">Create one here</Link>.
      </p>
    </div>
  );
}
