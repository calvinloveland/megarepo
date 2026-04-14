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

  if (code === 'email-in-use') {
    return 'That email address already belongs to an existing Vernissage account.';
  }

  if (code === 'handle-in-use') {
    return 'That handle is already claimed. Try another signature for the salon.';
  }

  if (code === 'reserved-handle') {
    return 'That handle is reserved for an editorial profile already present in the catalogue.';
  }

  if (code === 'invalid') {
    return 'Please fill every field correctly before creating the account.';
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
        <p>Create a real Vernissage account so your reviews, ratings, and future lists belong to you rather than a demo curator.</p>
      </section>

      <BotanicalDivider label="Create account" />

      {errorCode ? <p className="meta-note">{errorMessageFor(errorCode)}</p> : null}
      {!isDatabaseConfigured() ? (
        <p className="meta-note">Account creation is ready in code, but publishing is paused until the shared application database is connected.</p>
      ) : null}

      <form className="ornate-form ornate-form--stacked" method="post" action="/api/auth/register">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div className="two-up-grid two-up-grid--tight">
          <OrnateInput label="Display name" name="name" placeholder="Aurelia Vale" />
          <OrnateInput label="Handle" name="handle" placeholder="aurelia-vale" />
        </div>
        <OrnateInput label="Email" name="email" type="email" placeholder="you@example.com" />
        <div className="two-up-grid two-up-grid--tight">
          <OrnateInput label="Password" name="password" type="password" placeholder="At least 10 characters" />
          <OrnateInput label="Location" name="location" placeholder="Paris, London, Chicago…" />
        </div>
        <OrnateInput label="Bio" name="bio" multiline placeholder="A few lines about your taste, obsessions, or favorite rooms to wander." />
        <div className="button-row">
          <EnamelButton type="submit">Create account</EnamelButton>
          <EnamelButton href="/signin" variant="secondary">
            Already have an account?
          </EnamelButton>
        </div>
      </form>

      <p className="meta-note">
        Existing member? <Link href="/signin" className="text-link">Sign in instead</Link>.
      </p>
    </div>
  );
}
