export type RatedLike = {
  rating: number;
};

export function getAverageRating<TItem extends RatedLike>(items: TItem[]) {
  if (items.length === 0) {
    return null;
  }

  return items.reduce((sum, item) => sum + item.rating, 0) / items.length;
}
