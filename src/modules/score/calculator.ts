/**
 * Score Calculator - weighted average score computation
 */

export function calculateWeightedScore(
  dimensions: Record<string, number>,
  weights: Record<string, number>,
): number {
  let total = 0;
  for (const key of Object.keys(dimensions)) {
    const score = dimensions[key];
    const weight = weights[key] ?? 0;
    total += score * weight;
  }
  return total;
}
