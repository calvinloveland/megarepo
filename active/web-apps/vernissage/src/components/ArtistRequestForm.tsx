'use client';

import { useState } from 'react';

import { EnamelButton } from '@/src/components/EnamelButton';
import { buildArtistRequestFeedbackText } from '@/src/lib/artist-requests';

type SubmissionState =
  | { kind: 'idle'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export function ArtistRequestForm() {
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle', message: '' });
  const [pending, setPending] = useState(false);

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
        message: 'Add the artist name and a quick note on why they belong in the catalog.'
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
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error((await response.text()) || 'Failed to submit artist request.');
      }

      form.reset();
      setSubmission({
        kind: 'success',
        message: 'Artist request sent. We will review it as the catalog expands.'
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
          <span className="ornate-field__label">Movement or scene</span>
          <input
            name="movement"
            className="ornate-field__control"
            placeholder="Symbolism, early abstraction, ukiyo-e..."
            maxLength={160}
          />
        </label>
      </div>

      <label className="ornate-field">
        <span className="ornate-field__label">Works to start with</span>
        <input
          name="starterWorks"
          className="ornate-field__control"
          placeholder="The Ten Largest, The Swan, Altarpieces..."
          maxLength={240}
        />
        <span className="ornate-field__hint">Optional, but helpful if there is a clear entry point.</span>
      </label>

      <label className="ornate-field">
        <span className="ornate-field__label">Why this artist belongs here</span>
        <textarea
          name="rationale"
          rows={5}
          className="ornate-field__control ornate-field__control--textarea"
          placeholder="Tell us why this artist matters, what conversations they open up, or what works people will want to review."
          maxLength={5000}
          required
        />
      </label>

      <div className="button-row">
        <button type="submit" className="enamel-button enamel-button--primary" disabled={pending}>
          {pending ? 'Sending request…' : 'Suggest this artist'}
        </button>
        <EnamelButton href="/search" variant="secondary">
          Back to search
        </EnamelButton>
      </div>

      {submission.kind !== 'idle' ? (
        <p className={`feedback-widget__status feedback-widget__status--${submission.kind}`} role={submission.kind === 'error' ? 'alert' : 'status'}>
          {submission.message}
        </p>
      ) : null}
    </form>
  );
}
