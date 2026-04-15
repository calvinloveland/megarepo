import type { Metadata } from 'next';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Launch-era terms for using Vernissage and publishing criticism on the site.'
};

export default function TermsPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Terms</p>
        <h1>Launch terms for the salon</h1>
        <p>
          Vernissage is a public review site for visual art. These terms set the launch baseline for
          participation, publication, and site operations.
        </p>
      </section>

      <BotanicalDivider label="Use of service" />

      <section className="gilded-card">
        <div className="gilded-card__body trust-copy">
          <h2>Accounts and authorship</h2>
          <p>
            You are responsible for the account you create and for the criticism, ratings, and profile
            details you publish through it.
          </p>

          <h2>Acceptable use</h2>
          <p>
            Do not use Vernissage to harass others, impersonate institutions or artists, spam catalogue
            entries, or publish unlawful content. Launch protections may rate-limit or block abusive
            behavior automatically.
          </p>

          <h2>User-generated writing</h2>
          <p>
            You keep ownership of your writing, but you grant Vernissage permission to display and
            distribute it within the product so reviews can appear on public site pages.
          </p>

          <h2>Catalogue imagery</h2>
          <p>
            Vernissage uses museum-hosted public-domain artwork imagery when possible and may also
            display clearly reusable open-license documentation or locally stored derivative files when
            the source terms permit it. Those materials remain subject to the source institution&apos;s or
            photographer&apos;s stated usage terms and attribution practices.
          </p>

          <h2>Moderation and availability</h2>
          <p>
            The service may remove content, restrict accounts, or temporarily disable features when
            needed for safety, maintenance, or launch stability.
          </p>
        </div>
      </section>
    </div>
  );
}
