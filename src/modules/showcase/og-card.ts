/**
 * OG Card Generator - generates Open Graph card data for social sharing
 */

export interface OgCardInput {
  skillName: string;
  grade: string;
  totalScore: number;
}

export interface OgCardResult {
  ogTitle: string;
  ogDescription: string;
  ogImage: {
    url: string;
    width: number;
    height: number;
  };
  twitterCard: string;
}

export async function generateOgCard(input: OgCardInput): Promise<OgCardResult> {
  return {
    ogTitle: `${input.skillName} - ${input.grade} (${input.totalScore})`,
    ogDescription: `AI Skill "${input.skillName}" scored ${input.totalScore} - Grade: ${input.grade}`,
    ogImage: {
      url: `https://showcase.muxvo.com/og/${input.skillName}.png`,
      width: 1200,
      height: 630,
    },
    twitterCard: 'summary_large_image',
  };
}
