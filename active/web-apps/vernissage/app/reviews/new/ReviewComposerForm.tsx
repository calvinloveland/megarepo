'use client';

import { useEffect, useState } from 'react';

import { EnamelButton } from '@/src/components/EnamelButton';
import { OrnateInput } from '@/src/components/OrnateInput';

import {
  reviewTargetGuides,
  resolveReviewComposerSelection,
  type ComposerTargetCollection
} from './review-composer';

type ReviewComposerFormProps = {
  targetCollections: ComposerTargetCollection[];
  defaultTargetType?: string;
  defaultTargetSlug?: string;
  databaseReady: boolean;
};

export function ReviewComposerForm({
  targetCollections,
  defaultTargetType,
  defaultTargetSlug,
  databaseReady
}: ReviewComposerFormProps) {
  const initialSelection = resolveReviewComposerSelection(targetCollections, defaultTargetType, defaultTargetSlug);
  const [targetType, setTargetType] = useState(initialSelection.targetType);
  const [targetSlug, setTargetSlug] = useState(initialSelection.targetSlug);

  const activeCollection = targetCollections.find((group) => group.value === targetType) ?? initialSelection.activeCollection;

  useEffect(() => {
    if (!activeCollection) {
      return;
    }

    if (!activeCollection.items.some((item) => item.value === targetSlug)) {
      setTargetSlug(activeCollection.items[0]?.value ?? '');
    }
  }, [activeCollection, targetSlug]);

  if (!activeCollection) {
    return null;
  }

  const guide = reviewTargetGuides[activeCollection.value];

  return (
    <form
      className="ornate-form ornate-form--stacked"
      method="post"
      action="/api/reviews"
      onSubmit={(event) => {
        if (!databaseReady) {
          event.preventDefault();
        }
      }}
    >
      <div className="trust-copy">
        <h2>1. Choose what the review belongs to</h2>
        <p>Start with the narrowest catalogue page that can honestly hold the judgment.</p>
        <p>
          <strong>{guide.scope}.</strong> {guide.description}
        </p>
      </div>

      <div className="button-row">
        {targetCollections.map((group) => {
          const selected = group.value === activeCollection.value;

          return (
            <button
              key={group.value}
              type="button"
              className={`enamel-button enamel-button--${selected ? 'primary' : 'secondary'}`}
              aria-pressed={selected}
              onClick={() => {
                setTargetType(group.value);
                setTargetSlug(group.items[0]?.value ?? '');
              }}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      <input type="hidden" name="targetType" value={activeCollection.value} />
      <label className="ornate-field">
        <span className="ornate-field__label">Choose the {activeCollection.label.toLowerCase()} page</span>
        <select
          name="targetSlug"
          value={targetSlug}
          onChange={(event) => setTargetSlug(event.target.value)}
          className="ornate-field__control"
        >
          {activeCollection.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="ornate-field__hint">{guide.selectionHint}</span>
      </label>

      <div className="trust-copy">
        <h2>2. Make the case</h2>
        <p>
          Strong reviews move from observation to judgment. Name what you noticed, then explain why it earns praise,
          disappointment, or ambivalence.
        </p>
      </div>

      <div className="two-up-grid two-up-grid--tight">
        <OrnateInput
          label="Review title"
          name="title"
          placeholder={guide.titlePlaceholder}
          hint="Write the claim, not a teaser. Someone skimming the catalogue should know your angle at a glance."
        />
        <OrnateInput
          label="Rating"
          name="rating"
          options={['5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1', '0.5'].map((value) => ({
            value,
            label: `${value} stars`
          }))}
          defaultValue="4.5"
          hint={guide.ratingHint}
        />
      </div>

      <OrnateInput
        label="Review body"
        name="body"
        multiline
        placeholder={guide.bodyPlaceholder}
        hint="Point to evidence inside the work, room, show, or visit: scale, sequencing, material, access, lighting, pacing, or what changed your mind."
      />

      <div className="two-up-grid two-up-grid--tight">
        <OrnateInput
          label="Tags"
          name="tags"
          placeholder="lighting, pacing, draftsmanship"
          hint={guide.tagHint}
        />
        <OrnateInput
          label="Content note"
          name="spoiler"
          options={[
            { value: 'no', label: 'No content note' },
            { value: 'yes', label: 'Contains spoilers or sensitive material' }
          ]}
          defaultValue="no"
          hint="Use this when the review discusses disturbing imagery, memorial material, or other details readers may want signposted."
        />
      </div>

      <div className="trust-copy">
        <h2>3. Publish when the verdict is clear</h2>
        <p>{guide.publishNote}</p>
        <p>At launch, each member can publish one review per catalogue entry, so wait until the judgment can stand on its own.</p>
        {!databaseReady ? <p>Publishing is temporarily unavailable right now.</p> : null}
      </div>

      <div className="button-row">
        <button type="submit" className="enamel-button enamel-button--primary" disabled={!databaseReady}>
          {databaseReady ? 'Publish review' : 'Publishing unavailable'}
        </button>
        <EnamelButton href="/search" variant="secondary">
          Search the catalogue
        </EnamelButton>
      </div>
    </form>
  );
}
