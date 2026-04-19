import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
import { OrnateInput } from '@/src/components/OrnateInput';
import { MIN_PASSWORD_LENGTH, normalizeCallbackUrl } from '@/src/lib/account-registration';
import { authOptions } from '@/src/lib/auth';
import { isDatabaseConfigured } from '@/src/lib/prisma';

function errorMessageFor(code?: string) {
  if (code === 'database-unavailable') {
    return 'Account creation is blocked until the shared application database is configured.';
  }

  if (code === 'handle-unavailable') {
    return 'That handle is unavailable. Try another signature for the salon.';
  }

  if (code === 'invalid') {
    return `Choose a valid handle and a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (code === 'rate-limited') {
    return 'Too many signup attempts came from this address. Please wait a little before trying again.';
  }

  return '';
}

export default async function JoinPage({
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

  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">New member</p>
        <h1>Take your place in the salon</h1>
        <p>Start with a handle and password. Nothing else is required to get inside the salon.</p>
      </section>

      <BotanicalDivider label="Create account" />

      {errorCode ? <p className="meta-note">{errorMessageFor(errorCode)}</p> : null}
      {!isDatabaseConfigured() ? (
        <p className="meta-note">Account creation is ready in code, but publishing is paused until the shared application database is connected.</p>
      ) : null}

      <form className="ornate-form ornate-form--stacked" method="post" action="/api/auth/register">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div className="two-up-grid two-up-grid--tight">
          <OrnateInput
            label="Handle"
            name="handle"
            placeholder="atelier-name"
            hint="Use 3-32 lowercase letters, numbers, or hyphens."
          />
          <OrnateInput label="Password" name="password" type="password" placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
        </div>
        <div className="button-row">
          <EnamelButton type="submit">Create account</EnamelButton>
          <EnamelButton href="/signin" variant="secondary">
            Already have an account?
          </EnamelButton>
        </div>
        <p className="meta-note">No email confirmation loop, display-name prompt, location survey, or bio essay at signup.</p>
      </form>

      <p className="meta-note">
        Existing member? <Link href="/signin" className="text-link">Sign in instead</Link>.
      </p>
    </div>
  );
}
