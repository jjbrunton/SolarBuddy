/**
 * Linear-interpolated percentile of a numeric array that is already sorted
 * ascending. p is 0..100 inclusive.
 *
 * Empty arrays return 0. Single-element arrays return that element for any p.
 *
 * Matches the "linear" method used by numpy.percentile and most common
 * statistics packages, so results match the hand-rolled expectations in tests.
 */
export function percentileSorted(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];

  const clampedP = Math.max(0, Math.min(100, p));
  const rank = (clampedP / 100) * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedAsc[lower];

  const fraction = rank - lower;
  return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * fraction;
}
