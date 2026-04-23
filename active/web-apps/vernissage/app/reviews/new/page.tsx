import { getServerSession } from 'next-auth';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
import { PageIntro } from '@/src/components/PageIntro';
import { authOptions } from '@/src/lib/auth';
import { artworks, artists, exhibitions, visits } from '@/src/lib/catalog';
import { isDatabaseConfigured } from '@/src/lib/prisma';

import { ReviewComposerForm } from './ReviewComposerForm';
import { resolveReviewComposerSelection, type ComposerTargetCollection } from './review-composer';

const targetCollections = [
  { value: 'artwork', label: 'Artwork', items: artworks.map((artwork) => ({ value: artwork.slug, label: artwork.title })) },
  { value: 'artist', label: 'Artist', items: artists.map((artist) => ({ value: artist.slug, label: artist.name })) },
  { value: 'exhibition', label: 'Exhibition', items: exhibitions.map((exhibition) => ({ value: exhibition.slug, label: exhibition.title })) },
  { value: 'visit', label: 'Museum visit', items: visits.map((visit) => ({ value: visit.slug, label: visit.title })) }
] satisfies ComposerTargetCollection[];

const availableTargetCollections = targetCollections.filter((group) => group.items.length > 0);

function messageFor(code?: string) {
  if (!code) {
    return '';
  }

  if (code === 'database-unavailable') {
    return 'Publishing is temporarily paused right now. Please try again in a little while.';
  }

  if (code === 'reviewed') {
    return 'Your review has been published.';
  }

  if (code === 'already-reviewed') {
    return 'You already published a review for that entry. At launch, each member gets one public review per catalogue page.';
  }

  if (code === 'rate-limited') {
    return 'You have published a few reviews in quick succession. Pause for a moment, then try again.';
  }

  return code;
}

export default async function ReviewComposerPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const params = await searchParams;
  const message = typeof params.error === 'string' ? messageFor(params.error) : params.reviewed === '1' ? messageFor('reviewed') : '';
  const databaseReady = isDatabaseConfigured();
  const requestedTargetType = typeof params.targetType === 'string' ? params.targetType : undefined;
  const requestedTargetSlug = typeof params.targetSlug === 'string' ? params.targetSlug : undefined;
  const initialSelection = resolveReviewComposerSelection(availableTargetCollections, requestedTargetType, requestedTargetSlug);

  return (
    <div className="page-stack page-stack--narrow">
      <PageIntro eyebrow="Review composer" title="Choose the page, then make the case.">
        <p>
          A Vernissage review belongs to a specific catalogue entry. First decide whether your judgment is about one
          artwork, an artist&apos;s body of work, an exhibition, or the experience of a museum visit.
        </p>
        <p>
          Then write the claim, the evidence, and the rating together. Publishing makes the review public under your
          handle and ties the rating to the entry you chose.
        </p>
      </PageIntro>

      <BotanicalDivider label="Start the review" />

      {message ? <p className="meta-note">{message}</p> : null}

      {!session?.user ? (
        <section className="hero-shell hero-shell--compact">
          <p className="lead">You need a Vernissage account because reviews publish under your public handle.</p>
          <p>Sign in if you already write here, or create an account before you start composing.</p>
          <div className="button-row">
            <EnamelButton href="/signin">Sign in</EnamelButton>
            <EnamelButton href="/join" variant="secondary">
              Create an account
            </EnamelButton>
          </div>
        </section>
      ) : !availableTargetCollections.length ? (
        <section className="hero-shell hero-shell--compact">
          <p className="lead">There are no reviewable catalogue entries available yet.</p>
          <p>Use search to confirm what is already in the catalogue, then come back once entries are ready for review.</p>
          <div className="button-row">
            <EnamelButton href="/search">Search the catalogue</EnamelButton>
          </div>
        </section>
      ) : (
        <>
          {!databaseReady ? (
            <section className="gilded-card">
              <div className="gilded-card__body trust-copy">
                <h2>Publishing is paused for now</h2>
                <p>
                  You can still shape the review below, but the publish button stays off until posting comes back.
                </p>
              </div>
            </section>
          ) : null}
          <ReviewComposerForm
            targetCollections={availableTargetCollections}
            defaultTargetType={initialSelection.targetType}
            defaultTargetSlug={initialSelection.targetSlug}
            databaseReady={databaseReady}
          />
        </>
      )}
    </div>
  );
}
