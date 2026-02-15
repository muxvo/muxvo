/**
 * Risk Scanner - identifies dangerous command patterns
 */

const RISK_KEYWORDS = [
  'curl',
  'eval',
  'rm -rf',
  'wget',
  'sudo',
  'chmod 777',
];

export interface RiskKeywordsResult {
  list: string[];
  highlight: string;
}

export function getRiskKeywords(): RiskKeywordsResult {
  return {
    list: [...RISK_KEYWORDS],
    highlight: 'red',
  };
}
