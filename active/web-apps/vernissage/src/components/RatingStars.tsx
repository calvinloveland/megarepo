type RatingStarsProps = {
  rating: number;
};

export function RatingStars({ rating }: RatingStarsProps) {
  const stars = [1, 2, 3, 4, 5];

  return (
    <div className="rating-stars" role="img" aria-label={`Rated ${rating} out of 5`}>
      {stars.map((star) => (
        <span key={star} aria-hidden="true" className={star <= Math.round(rating) ? 'rating-stars__star is-filled' : 'rating-stars__star'}>
          ★
        </span>
      ))}
      <span aria-hidden="true" className="rating-stars__value">{rating.toFixed(1)}</span>
    </div>
  );
}
