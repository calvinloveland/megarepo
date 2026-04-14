export type ArtistRequestFields = {
  artistName: string;
  movement: string;
  starterWorks: string;
  rationale: string;
};

function cleanLine(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildArtistRequestFeedbackText(fields: ArtistRequestFields) {
  const artistName = cleanLine(fields.artistName);
  const movement = cleanLine(fields.movement);
  const starterWorks = cleanLine(fields.starterWorks);
  const rationale = cleanLine(fields.rationale);

  const details = [
    `Artist request: ${artistName}`,
    movement ? `Movement or scene: ${movement}` : '',
    starterWorks ? `Works to start with: ${starterWorks}` : '',
    `Why add them: ${rationale}`
  ].filter(Boolean);

  return details.join('\n');
}
