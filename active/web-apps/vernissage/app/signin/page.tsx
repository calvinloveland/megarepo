import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { PageIntro } from '@/src/components/PageIntro';
import { SignInForm } from '@/src/components/SignInForm';
import { normalizeCallbackUrl } from '@/src/lib/account-registration';
import { authOptions } from '@/src/lib/auth';
import { isDatabaseConfigured } from '@/src/lib/prisma';

function errorMessageFor(code?: string) {
  if (code === 'CredentialsSignin') {
    return 'We could not match that handle or password. Check for typos and try again.';
  }

  if (code === 'database-unavailable') {
    return 'Sign-in is taking a brief pause right now. Please try again in a little while.';
  }

  if (code === 'rate-limited') {
    return 'You have tried a few times already. Please wait a little before trying again.';
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
  const callbackUrl = normalizeCallbackUrl(typeof params.callbackUrl === 'string' ? params.callbackUrl : undefined);
  const errorCode = typeof params.error === 'string' ? params.error : undefined;
  const registered = params.registered === '1';
  const identifier = typeof params.identifier === 'string' ? params.identifier : undefined;

  return (
    <div className="page-stack page-stack--narrow">
      <PageIntro eyebrow="Welcome back" title="Return to the salon">
        <p>Sign in to pick up your latest criticism, saved lists, and the conversations waiting around your desk.</p>
      </PageIntro>

      <BotanicalDivider label="Sign in" />

      {registered ? (
        <p className="meta-note">
          Your account is ready. Sign in{identifier ? ` as ${identifier}` : ''} and start your first review.
        </p>
      ) : null}

      <SignInForm callbackUrl={callbackUrl} databaseReady={isDatabaseConfigured()} initialError={errorMessageFor(errorCode)} />

      <p className="meta-note">
        Need a new account? <Link href="/join" className="text-link">Create one here</Link>.
      </p>
    </div>
  );
}
