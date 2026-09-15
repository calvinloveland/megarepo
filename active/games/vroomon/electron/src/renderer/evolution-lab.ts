// The evolution lab's decision logic, kept pure so it can be tested without
// a browser: when a generation is an OUTLIER worth celebrating, and whether
// an auto-run should keep going, stop for feed, or stop at a plateau.

/** A best score that jumps by at least `threshold` (default 2%) is an
 * outlier — the "lucky generation" the whole loop is chasing. */
export function isOutlier(
  previousBest: number,
  nextBest: number,
  threshold = 0.02,
): boolean {
  if (!Number.isFinite(nextBest) || nextBest <= 0) {
    return false;
  }
  if (!Number.isFinite(previousBest) || previousBest <= 0) {
    return true; // the first real result always counts
  }
  return nextBest >= previousBest * (1 + threshold);
}

export type AutoRunVerdict = "continue" | "out-of-feed" | "plateau";

export interface AutoRunState {
  /** Feed left in the carrier; breeding spends one per generation. */
  feed: number;
  /** Consecutive generations without an outlier. */
  dryStreak: number;
  /** How many dry generations the player tolerates before stopping. */
  plateauLimit: number;
  /** Whether the player asked to stop at a plateau. */
  stopAtPlateau: boolean;
}

export function autoRunVerdict(state: AutoRunState): AutoRunVerdict {
  if (state.feed < 1) {
    return "out-of-feed";
  }
  if (state.stopAtPlateau && state.dryStreak >= state.plateauLimit) {
    return "plateau";
  }
  return "continue";
}

/** Growth of a new best over the previous one, as a fraction (0.07 = +7%). */
export function improvementRatio(previousBest: number, nextBest: number): number {
  if (!Number.isFinite(previousBest) || previousBest <= 0) {
    return 0;
  }
  return (nextBest - previousBest) / previousBest;
}
