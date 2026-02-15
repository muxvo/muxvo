/**
 * Score-Showcase Bridge - orchestrates generating showcase from score results
 */

interface ScoreDimension {
  name: string;
  score: number;
}

interface ScoreResult {
  totalScore: number;
  grade: string;
  dimensions: ScoreDimension[];
}

interface GenerateInput {
  skillPath: string;
  scoreResult: ScoreResult;
}

interface GenerateResult {
  cachedScoreUsed: boolean;
  radarChart: { dimensions: ScoreDimension[]; totalScore: number };
  skillContent: { path: string; grade: string };
  ogMeta: { ogTitle: string; ogDescription: string; ogImage: string };
}

export function createScoreToShowcaseOrchestrator() {
  return {
    async generateFromScore(input: GenerateInput): Promise<GenerateResult> {
      const { skillPath, scoreResult } = input;
      return {
        cachedScoreUsed: true,
        radarChart: {
          dimensions: scoreResult.dimensions,
          totalScore: scoreResult.totalScore,
        },
        skillContent: {
          path: skillPath,
          grade: scoreResult.grade,
        },
        ogMeta: {
          ogTitle: `${scoreResult.grade} Skill`,
          ogDescription: `Score: ${scoreResult.totalScore}`,
          ogImage: `https://showcase.muxvo.com/og/${encodeURIComponent(skillPath)}`,
        },
      };
    },
  };
}
