import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
import { OrnateInput } from '@/src/components/OrnateInput';
import { authOptions } from '@/src/lib/auth';
import { isDatabaseConfigured } from '@/src/lib/prisma';

function errorMessageFor(code?: string) {
  if (code === 'database-unavailable') {
    return 'Account creation is blocked until the shared application database is configured.';
  }

  if (code === 'handle-in-use') {
    return 'That handle is already claimed. Try another signature for the salon.';
  }

  if (code === 'reserved-handle') {
    return 'That handle is reserved for an editorial profile already present in the catalogue.';
  }

  if (code === 'invalid') {
    return 'Choose a valid handle and a password with at least 10 characters.';
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
  const callbackUrl = typeof params.callbackUrl === 'string' ? params.callbackUrl : '/reviews/new';
  const errorCode = typeof params.error === 'string' ? params.error : undefined;

  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">New member</p>
        <h1>Take your place in the salon</h1>
        <p>Start with a handle and password, then fill in the rest of your profile later once you are inside the salon.</p>
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
            hint="This becomes your public signature and your default display name."
          />
          <OrnateInput label="Password" name="password" type="password" placeholder="At least 10 characters" />
        </div>
        <div className="button-row">
          <EnamelButton type="submit">Create account</EnamelButton>
          <EnamelButton href="/signin" variant="secondary">
            Already have an account?
          </EnamelButton>
        </div>
        <p className="meta-note">No email confirmation loop, location survey, or bio essay at signup.</p>
      </form>

      <p className="meta-note">
        Existing member? <Link href="/signin" className="text-link">Sign in instead</Link>.
      </p>
    </div>
  );
}
