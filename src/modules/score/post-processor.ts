/**
 * Score Post-Processor - validates score consistency
 */

export interface ConsistencyInput {
  reportedTotal: number;
  weightedAvg: number;
  tolerance: number;
}

export interface ConsistencyResult {
  passed: boolean;
  action?: string;
  diff?: number;
}

export function validateScoreConsistency(input: ConsistencyInput): ConsistencyResult {
  const diff = Math.abs(input.reportedTotal - input.weightedAvg);
  if (diff <= input.tolerance) {
    return { passed: true, diff };
  }
  return {
    passed: false,
    action: 're-score',
    diff,
  };
}
