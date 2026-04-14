import type { Metadata } from 'next';
import Link from 'next/link';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to report launch issues, moderation concerns, or account problems for Vernissage.'
};

export default function ContactPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Contact</p>
        <h1>How to reach the launch operator</h1>
        <p>
          Vernissage does not yet publish a separate support inbox. During launch, the built-in feedback
          channel is the supported path for bug reports, account issues, and moderation questions.
        </p>
      </section>

      <BotanicalDivider label="Support path" />

      <section className="gilded-card">
        <div className="gilded-card__body trust-copy">
          <h2>Use the feedback widget</h2>
          <p>
            Open the floating feedback control from any page and describe the issue you hit. Include your
            account handle, the page involved, and enough detail to reproduce the problem.
          </p>

          <h2>For account or moderation requests</h2>
          <p>
            State clearly that the note is about access, privacy, or moderation so it can be triaged
            separately from design feedback.
          </p>

          <h2>Before filing a note</h2>
          <ul className="plain-list">
            <li>Link the affected artwork, artist, exhibition, or member page.</li>
            <li>Include screenshots only when they help explain the issue.</li>
            <li>Mention whether the problem happened while signed in.</li>
          </ul>

          <p>
            You can return to the <Link href="/">salon front page</Link> after sending a note.
          </p>
        </div>
      </section>
    </div>
  );
}
