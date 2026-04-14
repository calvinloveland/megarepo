'use client';

import { FormEvent, useState } from 'react';
import { signIn } from 'next-auth/react';

import { EnamelButton } from '@/src/components/EnamelButton';
import { OrnateInput } from '@/src/components/OrnateInput';

type SignInFormProps = {
  callbackUrl: string;
  databaseReady: boolean;
  initialError?: string;
};

export function SignInForm({ callbackUrl, databaseReady, initialError }: SignInFormProps) {
  const [errorMessage, setErrorMessage] = useState(initialError ?? '');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage('');

    const formData = new FormData(event.currentTarget);
    const identifier = `${formData.get('identifier') ?? ''}`.trim();
    const password = `${formData.get('password') ?? ''}`;

    const result = await signIn('credentials', {
      identifier,
      password,
      callbackUrl,
      redirect: false
    });

    if (!result || result.error) {
      setPending(false);
      setErrorMessage('The handle/email and password did not match a Vernissage account.');
      return;
    }

    window.location.assign(result.url ?? callbackUrl);
  }

  return (
    <form className="ornate-form ornate-form--stacked" onSubmit={handleSubmit}>
      <OrnateInput label="Email or handle" name="identifier" placeholder="you@example.com or atelier-name" />
      <OrnateInput label="Password" name="password" type="password" placeholder="Your Vernissage password" />
      {errorMessage ? <p className="meta-note">{errorMessage}</p> : null}
      {!databaseReady ? <p className="meta-note">Account sign-in will become available once the shared application database is configured.</p> : null}
      <div className="button-row">
        <EnamelButton type="submit">{pending ? 'Signing in…' : 'Sign in'}</EnamelButton>
        <EnamelButton href="/join" variant="secondary">
          Create an account
        </EnamelButton>
      </div>
    </form>
  );
}
