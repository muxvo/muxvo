/**
 * Showcase Generator - generates showcase drafts from skill + score data
 */

export interface GenerateShowcaseInput {
  skillPath: string;
  scoreResult: unknown;
}

export interface ShowcaseDraft {
  name: string;
  description: string;
  features: string[];
  template: string;
}

export async function generateShowcase(input: GenerateShowcaseInput): Promise<ShowcaseDraft> {
  const skillName = input.skillPath.split('/').pop() || 'untitled';
  return {
    name: skillName,
    description: `Showcase for ${skillName}`,
    features: [],
    template: 'developer-dark',
  };
}
