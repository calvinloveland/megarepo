import Link from 'next/link';
import { getServerSession } from 'next-auth';

import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { GildedCard } from '@/src/components/GildedCard';
import { authOptions } from '@/src/lib/auth';
import {
  feedbackStatuses,
  feedbackTrackingPath,
  formatFeedbackStatusLabel,
  isFeedbackAdminHandle,
  type FeedbackEntry,
  readFeedbackEntries,
  readFeedbackEntriesBySubmitterHandle,
  readFeedbackEntryByTrackingToken
} from '@/src/lib/feedback';

export const runtime = 'nodejs';

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'Unknown time';
  }

  try {
    return new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return value;
  }
}

function getFeedbackTitle(entry: FeedbackEntry) {
  return entry.page_title?.trim() || entry.page_path?.trim() || `Feedback ${entry.id}`;
}

const statusDescriptions: Record<(typeof feedbackStatuses)[number], string> = {
  open: 'We have the note and it is waiting to be picked up.',
  planned: 'The request is accepted and work is being scoped.',
  in_progress: 'Someone is actively working on it or preparing the fix.',
  shipped: 'The change is live, with a note or reference left behind.'
};

function FeedbackEntryCard({
  entry,
  returnTo,
  editable
}: {
  entry: FeedbackEntry;
  returnTo: string;
  editable: boolean;
}) {
  const statusLabel = formatFeedbackStatusLabel(entry.status);

  return (
    <GildedCard
      title={getFeedbackTitle(entry)}
      eyebrow={`${statusLabel} · ${formatTimestamp(entry.updated_timestamp ?? entry.server_timestamp)}`}
      subtitle={entry.page_path ?? undefined}
    >
      <div className="feedback-updates__card">
        <p>{entry.feedback_text}</p>

        <dl className="feedback-updates__meta">
          <div>
            <dt>Submitted</dt>
            <dd>{formatTimestamp(entry.server_timestamp)}</dd>
          </div>
          <div>
            <dt>Reporter</dt>
            <dd>
              {entry.submitted_by_handle ? (
                <Link href={`/members/${entry.submitted_by_handle}`} className="text-link">
                  @{entry.submitted_by_handle}
                </Link>
              ) : (
                'Anonymous'
              )}
            </dd>
          </div>
          <div>
            <dt>Working on it</dt>
            <dd>
              {entry.assigned_to_handle ? (
                <Link href={`/members/${entry.assigned_to_handle}`} className="text-link">
                  @{entry.assigned_to_handle}
                </Link>
              ) : (
                'Unassigned'
              )}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`feedback-status feedback-status--${entry.status}`}>{statusLabel}</span>
            </dd>
          </div>
          {entry.addressed_by_commit ? (
            <div>
              <dt>Fix reference</dt>
              <dd>{entry.addressed_by_commit}</dd>
            </div>
          ) : null}
          {entry.selected_element ? (
            <div>
              <dt>Selected element</dt>
              <dd>{entry.selected_element}</dd>
            </div>
          ) : null}
        </dl>

        {entry.status_note ? (
          <div className="feedback-updates__note">
            <p className="eyebrow">Latest update</p>
            <p>{entry.status_note}</p>
          </div>
        ) : null}

        {entry.tracking_token ? (
          <p className="meta-note">
            This private link is unique to this note. Anyone with it can see the status, so keep it somewhere you trust:{' '}
            <Link href={feedbackTrackingPath(entry.tracking_token)} className="text-link">
              {feedbackTrackingPath(entry.tracking_token)}
            </Link>
          </p>
        ) : null}

        {editable ? (
          <form method="post" action="/feedback/update" className="feedback-updates__form">
            <input type="hidden" name="id" value={entry.id ?? ''} />
            <input type="hidden" name="return_to" value={returnTo} />
            <div className="two-up-grid two-up-grid--tight">
              <label className="ornate-field">
                <span className="ornate-field__label">Status</span>
                <select name="status" className="ornate-field__control" defaultValue={entry.status}>
                  {feedbackStatuses.map((status) => (
                    <option key={status} value={status}>
                      {formatFeedbackStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ornate-field">
                <span className="ornate-field__label">Assigned to</span>
                <input
                  name="assigned_to_handle"
                  className="ornate-field__control"
                  defaultValue={entry.assigned_to_handle ?? ''}
                  placeholder="alex"
                  maxLength={80}
                />
              </label>
            </div>

            <div className="two-up-grid two-up-grid--tight">
              <label className="ornate-field">
                <span className="ornate-field__label">Fix reference</span>
                <input
                  name="addressed_by_commit"
                  className="ornate-field__control"
                  defaultValue={entry.addressed_by_commit ?? ''}
                  placeholder="PR #583"
                  maxLength={200}
                />
              </label>
            </div>

            <label className="ornate-field">
              <span className="ornate-field__label">Update</span>
              <textarea
                name="status_note"
                rows={4}
                className="ornate-field__control ornate-field__control--textarea"
                defaultValue={entry.status_note ?? ''}
                placeholder="Assigned, blocked, waiting on content, or shipped with a link to the live change."
                maxLength={1000}
              />
            </label>

            <div className="button-row">
              <button type="submit" className="enamel-button enamel-button--primary">
                Save update
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </GildedCard>
  );
}

export default async function FeedbackUpdatesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const viewerHandle = session?.user?.handle?.trim().toLowerCase() || null;
  const isAdmin = isFeedbackAdminHandle(viewerHandle);
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token.trim() : '';
  const updated = typeof params.updated === 'string' ? params.updated.trim() : '';

  const [openEntries, shippedEntries, ownEntries, tokenEntry] = await Promise.all([
    isAdmin ? readFeedbackEntries(false) : Promise.resolve([] as FeedbackEntry[]),
    isAdmin ? readFeedbackEntries(true) : Promise.resolve([] as FeedbackEntry[]),
    viewerHandle ? readFeedbackEntriesBySubmitterHandle(viewerHandle) : Promise.resolve([] as FeedbackEntry[]),
    token ? readFeedbackEntryByTrackingToken(token) : Promise.resolve(null)
  ]);

  const visibleOwnEntries = tokenEntry
    ? ownEntries.filter((entry) => entry.id !== tokenEntry.id)
    : ownEntries;
  const returnTo = token ? `/feedback/updates?token=${encodeURIComponent(token)}` : '/feedback/updates';

  return (
    <div className="page-stack">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Feedback follow-up</p>
        <h1>See what happened after you sent a note</h1>
        <p>
          Signed-in members can follow every note tied to their handle here. Anonymous notes stay private and trackable
          through the one-off link returned at submission time.
        </p>
      </section>

      <BotanicalDivider label="Current status" />

      {updated ? <p className="meta-note">Saved feedback update for {updated}.</p> : null}

      <GildedCard title="How to read this page" eyebrow="Tracking guide">
        <p>
          <strong>Signed in:</strong> notes submitted under your handle appear automatically below.
        </p>
        <p>
          <strong>Anonymous:</strong> only the private tracking link can reopen a note later.
        </p>
        <p>
          <strong>Status changes:</strong> the first visible sign of movement is usually a new status, an assignee, or
          a short update from the team.
        </p>
      </GildedCard>

      <GildedCard title="What the status means" eyebrow="Status guide">
        {feedbackStatuses.map((status) => (
          <p key={status}>
            <strong>{formatFeedbackStatusLabel(status)}.</strong> {statusDescriptions[status]}
          </p>
        ))}
      </GildedCard>

      {token ? (
        tokenEntry ? (
          <section className="page-stack page-stack--narrow">
            <p className="eyebrow">Private tracking view</p>
            <FeedbackEntryCard entry={tokenEntry} returnTo={returnTo} editable={isAdmin} />
          </section>
        ) : (
          <GildedCard title="Tracking link not found" eyebrow="Private link">
            <p>This link does not match a live feedback record. Double-check the full URL that was returned when the note was submitted.</p>
          </GildedCard>
        )
      ) : null}

      {viewerHandle ? (
        <section className="page-stack page-stack--narrow">
          <p className="eyebrow">Notes tied to your handle</p>
          {visibleOwnEntries.length ? (
            visibleOwnEntries.map((entry) => (
              <FeedbackEntryCard key={entry.id} entry={entry} returnTo={returnTo} editable={false} />
            ))
          ) : (
            <GildedCard title="No signed notes yet" eyebrow="Your queue">
              <p>Submit feedback while signed in and it will collect here automatically, along with any future status notes.</p>
            </GildedCard>
          )}
        </section>
      ) : null}

      {!viewerHandle && !token ? (
        <GildedCard title="Bring a private link or sign in" eyebrow="How tracking works">
          <p>
            Have a private link from an anonymous submission? Open it here to see the latest status and team notes.
            Signed-in members can also come back here to see every note tied to their handle in one place.
          </p>
        </GildedCard>
      ) : null}

      {isAdmin ? (
        <>
          <BotanicalDivider label="Admin board" />
          <section className="page-stack page-stack--narrow">
            <p className="eyebrow">Still open</p>
            {openEntries.length ? (
              openEntries.map((entry) => (
                <FeedbackEntryCard key={entry.id} entry={entry} returnTo={returnTo} editable />
              ))
            ) : (
              <GildedCard title="No open feedback" eyebrow="Admin board">
                <p>The queue is clear for now.</p>
              </GildedCard>
            )}
          </section>

          <section className="page-stack page-stack--narrow">
            <p className="eyebrow">Shipped work</p>
            {shippedEntries.length ? (
              shippedEntries.map((entry) => (
                <FeedbackEntryCard key={entry.id} entry={entry} returnTo={returnTo} editable />
              ))
            ) : (
              <GildedCard title="No shipped feedback yet" eyebrow="Admin board">
                <p>Completed notes will appear here once they are marked shipped.</p>
              </GildedCard>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
