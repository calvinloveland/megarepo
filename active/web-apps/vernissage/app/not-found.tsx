import { EnamelButton } from '@/src/components/EnamelButton';
import { PageIntro } from '@/src/components/PageIntro';

export default function NotFound() {
  return (
    <section className="page-stack page-stack--narrow">
      <PageIntro eyebrow="Lost in the winter garden" title="This page has slipped behind the curtain.">
        <p>
          The requested catalogue entry could not be found. Try returning to the salon or browse the current exhibition surfaces.
        </p>
        <div className="button-row">
          <EnamelButton href="/">Return home</EnamelButton>
          <EnamelButton href="/search" variant="secondary">
            Browse the collection
          </EnamelButton>
        </div>
      </PageIntro>
    </section>
  );
}
