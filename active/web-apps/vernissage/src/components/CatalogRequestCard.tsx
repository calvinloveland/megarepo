import { OpenFeedbackButton } from '@/src/components/OpenFeedbackButton';
import { GildedCard } from '@/src/components/GildedCard';

type CatalogRequestCardProps = {
  title?: string;
  eyebrow?: string;
  body?: string;
  buttonLabel?: string;
  initialText?: string;
};

export function CatalogRequestCard({
  title = 'Missing an artist or artwork?',
  eyebrow = 'Collection requests',
  body = 'Use the feedback channel to request additions to the launch catalog. We review these notes as we expand the museum-backed collection.',
  buttonLabel = 'Request a catalog addition',
  initialText = "I'd love to see an artist or artwork added to the Vernissage catalog."
}: CatalogRequestCardProps) {
  return (
    <GildedCard title={title} eyebrow={eyebrow}>
      <p>{body}</p>
      <div className="button-row">
        <OpenFeedbackButton variant="secondary" initialText={initialText}>
          {buttonLabel}
        </OpenFeedbackButton>
      </div>
    </GildedCard>
  );
}
