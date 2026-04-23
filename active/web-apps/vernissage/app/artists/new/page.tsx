import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { ArtistRequestForm } from '@/src/components/ArtistRequestForm';
import { PageIntro } from '@/src/components/PageIntro';

export default function NewArtistRequestPage() {
  return (
    <div className="page-stack page-stack--narrow">
      <PageIntro eyebrow="Shape what gets catalogued" title="Nominate an artist Vernissage should focus on">
        <p>
          If an artist you want to write about is still missing, tell us why they matter here and what conversations
          they open. We use requests like this to judge catalog fit, starting points, and where the biggest gaps still are.
        </p>
      </PageIntro>

      <BotanicalDivider label="Make the case" />

      <ArtistRequestForm />
    </div>
  );
}
