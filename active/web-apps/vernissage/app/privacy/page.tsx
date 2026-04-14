import type { Metadata } from 'next';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Vernissage handles account, review, and feedback data at launch.'
};

export default function PrivacyPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Privacy</p>
        <h1>What Vernissage stores at launch</h1>
        <p>
          Vernissage keeps only the account and publishing data it needs to run the public art-review
          site. This page describes the launch-era baseline rather than an inflated legal fiction.
        </p>
      </section>

      <BotanicalDivider label="Launch policy" />

      <section className="gilded-card">
        <div className="gilded-card__body trust-copy">
          <h2>Account data</h2>
          <p>
            If you create an account, Vernissage stores your handle, email address, password hash,
            optional profile fields, and the reviews or ratings you publish. Passwords are not stored
            in plain text.
          </p>

          <h2>Catalogue and review data</h2>
          <p>
            Reviews, ratings, timestamps, and target references are stored in the shared application
            database so they can appear on artwork, artist, exhibition, and member pages.
          </p>

          <h2>Feedback submissions</h2>
          <p>
            The site-wide feedback widget stores the note you send, the page context you were on, the
            current app version, and associated timestamps so launch issues can be triaged.
          </p>

          <h2>Operational logs</h2>
          <p>
            Basic request metadata, health checks, and deployment information may be visible through the
            hosting platform and reverse proxy while the service is operated.
          </p>

          <h2>How to request help</h2>
          <p>
            At launch, privacy, moderation, and account questions should be sent through the in-app
            feedback widget with enough detail to identify the affected account or review.
          </p>
        </div>
      </section>
    </div>
  );
}
