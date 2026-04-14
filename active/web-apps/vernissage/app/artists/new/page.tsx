import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { ArtistRequestForm } from '@/src/components/ArtistRequestForm';

export default function NewArtistRequestPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Catalog expansion</p>
        <h1>Suggest an artist for Vernissage</h1>
        <p>
          Use this request form when the painter, printmaker, photographer, or sculptor you want to
          discuss is not in the room yet. We route these notes straight into the launch feedback queue.
        </p>
      </section>

      <BotanicalDivider label="Artist request" />

      <ArtistRequestForm />
    </div>
  );
}
