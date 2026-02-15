/**
 * Security Scanner
 *
 * Detects risk keywords in hook source code and highlights them.
 */

export interface RiskKeywordResult {
  highlightedKeywords: string[];
  highlightCount: number;
  highlightColor: string;
}

export function detectRiskKeywords(
  sourceCode: string,
  riskKeywords: string[],
): RiskKeywordResult {
  const found: string[] = [];

  for (const keyword of riskKeywords) {
    if (sourceCode.includes(keyword)) {
      found.push(keyword);
    }
  }

  return {
    highlightedKeywords: found,
    highlightCount: found.length,
    highlightColor: 'red',
  };
}
