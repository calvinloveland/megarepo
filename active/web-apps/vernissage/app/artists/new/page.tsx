import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { ArtistRequestForm } from '@/src/components/ArtistRequestForm';

export default function NewArtistRequestPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Shape what gets catalogued</p>
        <h1>Nominate an artist Vernissage should focus on</h1>
        <p>
          If an artist you want to write about is still missing, tell us why they matter here and what conversations
          they open. We use requests like this to judge catalog fit, starting points, and where the biggest gaps still are.
        </p>
      </section>

      <BotanicalDivider label="Make the case" />

      <ArtistRequestForm />
    </div>
  );
}
