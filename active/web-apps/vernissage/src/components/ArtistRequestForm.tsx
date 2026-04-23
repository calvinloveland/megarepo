'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSession } from 'next-auth/react';

import { EnamelButton } from '@/src/components/EnamelButton';
import { buildArtistRequestFeedbackText } from '@/src/lib/artist-requests';

type SubmissionState =
  | { kind: 'idle'; message: string; linkHref?: undefined; linkLabel?: undefined }
  | { kind: 'success'; message: string; linkHref?: string; linkLabel?: string }
  | { kind: 'error'; message: string; linkHref?: undefined; linkLabel?: undefined };

export function ArtistRequestForm() {
  const { data: session, status } = useSession();
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle', message: '' });
  const [pending, setPending] = useState(false);
  const [submitAnonymously, setSubmitAnonymously] = useState(false);

  async function readResponseMessage(response: Response) {
    const text = await response.text();
    if (!text) {
      return 'Failed to submit artist request.';
    }

    try {
      const payload = JSON.parse(text) as { message?: string };
      return payload.message || text;
    } catch {
      return text;
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSubmission({ kind: 'idle', message: '' });

    const form = event.currentTarget;
    const formData = new FormData(form);
    const artistName = `${formData.get('artistName') ?? ''}`.trim();
    const rationale = `${formData.get('rationale') ?? ''}`.trim();

    if (!artistName || !rationale) {
      setPending(false);
      setSubmission({
        kind: 'error',
        message: 'Add the artist name and a quick note on why Vernissage should make room for them.'
      });
      return;
    }

    try {
      const response = await fetch('/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          feedback_text: buildArtistRequestFeedbackText({
            artistName,
            movement: `${formData.get('movement') ?? ''}`,
            starterWorks: `${formData.get('starterWorks') ?? ''}`,
            rationale
          }),
          design: 'gilded-manuscript',
          page_path: '/artists/new',
          page_title: 'Suggest an artist',
          timestamp: new Date().toISOString(),
          submit_anonymously: submitAnonymously
        })
      });

      if (!response.ok) {
        throw new Error(await readResponseMessage(response));
      }

      const result = (await response.json()) as {
        tracking_path?: string;
        dashboard_path?: string | null;
        submitted_with_account?: boolean;
      };
      form.reset();
      setSubmitAnonymously(false);
      setSubmission({
        kind: 'success',
        message: result.submitted_with_account
          ? 'Request received. We will use it to judge catalog fit and priority, and you can follow the status from your feedback updates page.'
          : 'Request received. Save this private tracking link now. It is the only way to follow an anonymous request later.',
        linkHref: result.submitted_with_account ? result.dashboard_path ?? result.tracking_path : result.tracking_path,
        linkLabel: result.submitted_with_account ? 'Open feedback updates' : 'Open private tracking link'
      });
    } catch (error) {
      setSubmission({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to submit artist request.'
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ornate-form ornate-form--stacked" onSubmit={handleSubmit}>
      <div className="two-up-grid two-up-grid--tight">
        <label className="ornate-field">
          <span className="ornate-field__label">Artist name</span>
          <input
            name="artistName"
            className="ornate-field__control"
            placeholder="Hilma af Klint"
            maxLength={160}
            required
          />
        </label>
        <label className="ornate-field">
          <span className="ornate-field__label">Movement, scene, or lineage</span>
          <input
            name="movement"
            className="ornate-field__control"
            placeholder="Symbolism, early abstraction, ukiyo-e..."
            maxLength={160}
          />
          <span className="ornate-field__hint">Optional, but it helps place the request inside the catalog.</span>
        </label>
      </div>

      <label className="ornate-field">
        <span className="ornate-field__label">A few works to start with</span>
        <input
          name="starterWorks"
          className="ornate-field__control"
          placeholder="The Ten Largest, The Swan, Altarpieces..."
          maxLength={240}
        />
        <span className="ornate-field__hint">Optional, but named entry points help us judge whether the first artist page can be strong.</span>
      </label>

      <label className="ornate-field">
        <span className="ornate-field__label">Why Vernissage should make room for this artist</span>
        <textarea
          name="rationale"
          rows={5}
          className="ornate-field__control ornate-field__control--textarea"
          placeholder="What role do they play, what gap would they fill, and what works or conversations would give members something real to review?"
          maxLength={5000}
          required
        />
        <span className="ornate-field__hint">The sharper the case, the easier it is to prioritize.</span>
      </label>

      <p className="feedback-widget__hint">
        {status === 'authenticated' && session?.user?.handle
          ? submitAnonymously
            ? `Signed in as ${session.user.handle}, but this request will be stripped of your handle before it reaches the queue. Save the private tracking link if you want to check back later.`
            : `Signed in as ${session.user.handle}. This request will also appear on your feedback updates page, along with any status notes we leave behind.`
          : 'Not signed in? That is fine. The request is still allowed, but the private tracking link is the only way to follow progress later.'}
      </p>

      {status === 'authenticated' && session?.user?.handle ? (
        <label className="feedback-widget__checkbox">
          <input
            type="checkbox"
            checked={submitAnonymously}
            onChange={(event) => setSubmitAnonymously(event.target.checked)}
          />
          <span>Send this request anonymously instead</span>
        </label>
      ) : null}

      <div className="button-row">
        <button type="submit" className="enamel-button enamel-button--primary" disabled={pending}>
          {pending ? 'Sending request…' : 'Send request'}
        </button>
        <EnamelButton href="/search" variant="secondary">
          Back to search
        </EnamelButton>
      </div>

      {submission.kind !== 'idle' ? (
        <div className={`feedback-widget__status feedback-widget__status--${submission.kind}`} role={submission.kind === 'error' ? 'alert' : 'status'}>
          <p>{submission.message}</p>
          {submission.linkHref && submission.linkLabel ? (
            <p>
              <Link href={submission.linkHref} className="text-link">
                {submission.linkLabel}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
