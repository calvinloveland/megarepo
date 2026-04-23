import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
import { OrnateInput } from '@/src/components/OrnateInput';
import { PageIntro } from '@/src/components/PageIntro';
import { MIN_PASSWORD_LENGTH, normalizeCallbackUrl } from '@/src/lib/account-registration';
import { authOptions } from '@/src/lib/auth';
import { isDatabaseConfigured } from '@/src/lib/prisma';

function errorMessageFor(code?: string) {
  if (code === 'database-unavailable') {
    return 'New accounts are taking a brief pause right now. Please try again in a little while.';
  }

  if (code === 'handle-unavailable') {
    return 'That handle is already spoken for. Try another name for your reviews.';
  }

  if (code === 'invalid') {
    return `Choose a handle with 3-32 lowercase letters, numbers, or hyphens, and a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (code === 'rate-limited') {
    return 'You have tried a few times already. Please wait a little before trying again.';
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
      <PageIntro eyebrow="New member" title="Take your place in the salon">
        <p>Claim your handle, set a password, and start publishing reviews and lists in a minute.</p>
      </PageIntro>

      <BotanicalDivider label="Create account" />

      {errorCode ? <p className="meta-note">{errorMessageFor(errorCode)}</p> : null}
      {!isDatabaseConfigured() ? (
        <p className="meta-note">New accounts are on a brief pause right now. If you already belong here, you can still sign in.</p>
      ) : null}

      <form className="ornate-form ornate-form--stacked" method="post" action="/api/auth/register">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <div className="two-up-grid two-up-grid--tight">
          <OrnateInput
            label="Handle"
            name="handle"
            placeholder="atelier-name"
            hint="This is the name people will see on your reviews. Use 3-32 lowercase letters, numbers, or hyphens."
          />
          <OrnateInput
            label="Password"
            name="password"
            type="password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            hint={`Use at least ${MIN_PASSWORD_LENGTH} characters so your account is easy to keep and hard to guess.`}
          />
        </div>
        <div className="button-row">
          <EnamelButton type="submit">Create account</EnamelButton>
          <EnamelButton href="/signin" variant="secondary">
            Already have an account?
          </EnamelButton>
        </div>
        <p className="meta-note">Start writing first. You can shape the rest of your profile after you are inside.</p>
      </form>

      <p className="meta-note">
        Existing member? <Link href="/signin" className="text-link">Sign in instead</Link>.
      </p>
    </div>
  );
}
