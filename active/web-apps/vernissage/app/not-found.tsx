import { EnamelButton } from '@/src/components/EnamelButton';

export default function NotFound() {
  return (
    <section className="page-stack page-stack--narrow">
      <div className="hero-shell hero-shell--compact">
        <p className="eyebrow">Lost in the winter garden</p>
        <h1>This page has slipped behind the curtain.</h1>
        <p>
          The requested catalogue entry could not be found. Try returning to the salon or browse the current exhibition surfaces.
        </p>
        <div className="button-row">
          <EnamelButton href="/">Return home</EnamelButton>
          <EnamelButton href="/search" variant="secondary">
            Browse the collection
          </EnamelButton>
        </div>
      </div>
    </section>
  );
}
