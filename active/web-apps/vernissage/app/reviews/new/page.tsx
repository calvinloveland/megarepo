import { getServerSession } from 'next-auth';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { EnamelButton } from '@/src/components/EnamelButton';
import { EnamelChip } from '@/src/components/EnamelChip';
import { OrnateInput } from '@/src/components/OrnateInput';
import { authOptions } from '@/src/lib/auth';
import { artworks, artists, exhibitions, visits } from '@/src/lib/catalog';
import { isDatabaseConfigured } from '@/src/lib/prisma';

const targetCollections = [
  { value: 'artwork', label: 'Artwork', items: artworks.map((artwork) => ({ value: artwork.slug, label: artwork.title })) },
  { value: 'artist', label: 'Artist', items: artists.map((artist) => ({ value: artist.slug, label: artist.name })) },
  { value: 'exhibition', label: 'Exhibition', items: exhibitions.map((exhibition) => ({ value: exhibition.slug, label: exhibition.title })) },
  { value: 'visit', label: 'Museum visit', items: visits.map((visit) => ({ value: visit.slug, label: visit.title })) }
].filter((group) => group.items.length > 0);

const targetOptions = targetCollections.map(({ value, label }) => ({ value, label }));
const targetChoices = targetCollections.flatMap((group) => group.items);
const defaultTargetType = targetOptions[0]?.value ?? 'artwork';
const defaultTargetSlug = targetChoices[0]?.value ?? '';

function messageFor(code?: string) {
  if (!code) {
    return '';
  }

  if (code === 'database-unavailable') {
    return 'Publishing is configured in code, but the shared application database is not connected yet.';
  }

  if (code === 'reviewed') {
    return 'Your review has been published to the salon ledger.';
  }

  if (code === 'already-reviewed') {
    return 'You already have a published review for that catalogue entry. Duplicate launch reviews are blocked for now.';
  }

  if (code === 'rate-limited') {
    return 'Publishing is moving a little too quickly. Please pause a moment before trying again.';
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

  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Compose criticism</p>
        <h1>Write with ornament, not clutter</h1>
        <p>
          Write criticism against real catalogue entries. Signed-in members can now publish database-backed reviews once the shared application database is available.
        </p>
      </section>

      <BotanicalDivider label="Review form" />

      {message ? <p className="meta-note">{message}</p> : null}

      {!session?.user ? (
        <section className="hero-shell hero-shell--compact">
          <p className="lead">You need a real Vernissage account before you can publish a review.</p>
          <div className="button-row">
            <EnamelButton href="/signin">Sign in</EnamelButton>
            <EnamelButton href="/join" variant="secondary">
              Create an account
            </EnamelButton>
          </div>
        </section>
      ) : (
        <>
          {!databaseReady ? <p className="meta-note">Your account is signed in, but publishing remains disabled until `DATABASE_URL` is configured for the app runtime.</p> : null}
          <form className="ornate-form ornate-form--stacked" method="post" action="/api/reviews">
            <div className="two-up-grid two-up-grid--tight">
              <OrnateInput label="Target type" name="targetType" options={targetOptions} defaultValue={defaultTargetType} />
              <OrnateInput label="Catalogue entry" name="targetSlug" options={targetChoices} defaultValue={defaultTargetSlug} />
            </div>
            <div className="two-up-grid two-up-grid--tight">
              <OrnateInput label="Review title" name="title" placeholder="What lingers after the frame?" />
              <OrnateInput label="Rating" name="rating" options={['5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1', '0.5'].map((value) => ({ value, label: `${value} stars` }))} defaultValue="4.5" />
            </div>
            <OrnateInput
              label="Review body"
              name="body"
              multiline
              placeholder="Write about sequencing, light, line, atmosphere, gesture, curation, or the building itself..."
              hint="Decorative language is welcome, but aim for specificity: light, pacing, material, and emotional effect."
            />
            <div className="two-up-grid two-up-grid--tight">
              <OrnateInput label="Tags" name="tags" placeholder="lighting, symbolism, staircase, atmosphere" />
              <OrnateInput label="Spoiler / content note" name="spoiler" options={[{ value: 'no', label: 'No spoiler note' }, { value: 'yes', label: 'Contains spoiler / sensitive content' }]} defaultValue="no" />
            </div>
            <div className="chip-row">
              <EnamelChip>Artworks</EnamelChip>
              <EnamelChip tone="moss">Artists</EnamelChip>
              <EnamelChip tone="rose">Exhibitions</EnamelChip>
              <EnamelChip tone="burgundy">Visits</EnamelChip>
            </div>
            <div className="button-row">
              <EnamelButton type="submit">Publish review</EnamelButton>
              <EnamelButton href="/feed" variant="secondary">
                Read the latest feed
              </EnamelButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
