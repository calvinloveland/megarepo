export type RatedArtworkLike = {
  rating: number;
};

export function getArtistAverageRating<TArtwork extends RatedArtworkLike>(works: TArtwork[]) {
  if (works.length === 0) {
    return null;
  }

  return works.reduce((sum, work) => sum + work.rating, 0) / works.length;
}
