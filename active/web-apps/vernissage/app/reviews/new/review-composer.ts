import type { ReviewTargetType } from '../../../src/lib/review-submission';

export type ComposerOption = {
  value: string;
  label: string;
};

export type ComposerTargetCollection = {
  value: ReviewTargetType;
  label: string;
  items: ComposerOption[];
};

export type ReviewTargetGuide = {
  scope: string;
  description: string;
  selectionHint: string;
  titlePlaceholder: string;
  bodyPlaceholder: string;
  ratingHint: string;
  tagHint: string;
  publishNote: string;
};

export const reviewTargetGuides: Record<ReviewTargetType, ReviewTargetGuide> = {
  artwork: {
    scope: 'Single work',
    description:
      'Choose an artwork when the judgment turns on one object: its composition, scale, surface, handling of material, or how it behaves in the room.',
    selectionHint: 'Pick the exact artwork page that should carry the review.',
    titlePlaceholder: 'A canvas that earns its stillness',
    bodyPlaceholder:
      'Describe the work itself first: composition, surface, scale, color, pacing, or how the room changes what the eye can hold.',
    ratingHint: 'Rate the work in front of you, not the artist’s whole career.',
    tagHint: 'Use a few recurring concerns such as brushwork, negative space, framing, or color temperature.',
    publishNote:
      'Publishing makes the review public on that artwork page under your handle and records the same star rating there.'
  },
  artist: {
    scope: 'Body of work',
    description:
      'Choose an artist when your judgment is about patterns across a body of work, not just one standout piece.',
    selectionHint: 'Use the artist page only if the piece-by-piece view would be too narrow.',
    titlePlaceholder: 'A painter whose discipline matters more than bravura',
    bodyPlaceholder:
      'Name the recurring decisions you noticed across the work: motifs, risk, restraint, ambition, repetition, or where the practice opens up.',
    ratingHint: 'Rate the body of work represented here, not the mythology around the artist.',
    tagHint: 'Tag the habits that define the work: draftsmanship, repetition, palette, iconography, or scale.',
    publishNote:
      'Publishing makes the review public on that artist page under your handle and records the same star rating there.'
  },
  exhibition: {
    scope: 'Curatorial sequence',
    description:
      'Choose an exhibition when the review is really about the show’s sequence, loans, wall text, installation, or curatorial thesis.',
    selectionHint: 'Pick the exhibition page where readers will expect the review.',
    titlePlaceholder: 'A survey that sharpens its thesis room by room',
    bodyPlaceholder:
      'Write about the route through the show: what the first room promises, what the last room proves, and where the installation helps or hurts.',
    ratingHint: 'Rate the exhibition experience, not the museum in general.',
    tagHint: 'Useful tags here are pacing, installation, wall text, loans, sequence, or thesis.',
    publishNote:
      'Publishing makes the review public on that exhibition page under your handle and records the same star rating there.'
  },
  visit: {
    scope: 'Building and day-of experience',
    description:
      'Choose a museum visit when the review belongs to the day itself: the building, signage, crowds, access, fatigue, and how those conditions shaped the art.',
    selectionHint: 'Use a museum visit when the judgment belongs to the overall day more than any single show.',
    titlePlaceholder: 'A visit shaped as much by crowd flow as by the collection',
    bodyPlaceholder:
      'Cover the practical experience as well as the art: approach, entry, routing, access, crowding, light, and what the building does to attention.',
    ratingHint: 'Rate the visit you had, including the conditions that shaped it.',
    tagHint: 'Tag the practical factors that mattered: crowding, signage, accessibility, sightlines, or architecture.',
    publishNote:
      'Publishing makes the review public under your handle and records the rating for that visit. For now, visit reviews return you here after posting.'
  }
};

export function resolveReviewComposerSelection(
  targetCollections: ComposerTargetCollection[],
  requestedType?: string,
  requestedSlug?: string
) {
  const activeCollection = targetCollections.find((group) => group.value === requestedType) ?? targetCollections[0];
  const targetType = activeCollection?.value ?? 'artwork';
  const targetSlug = activeCollection?.items.some((item) => item.value === requestedSlug)
    ? requestedSlug ?? ''
    : activeCollection?.items[0]?.value ?? '';

  return {
    activeCollection,
    targetType,
    targetSlug
  };
}
