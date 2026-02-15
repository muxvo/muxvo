/**
 * Share Content Generator - generates share content for various platforms
 */

export interface ShareInput {
  skillName: string;
  grade: string;
  score: number;
  url: string;
}

export interface ShareContent {
  text: string;
  url: string;
}

export function generateShareContent(channel: string, input: ShareInput): ShareContent {
  switch (channel) {
    case 'Twitter/X':
      return {
        text: `Check out ${input.skillName} - Grade: ${input.grade} (${input.score}) #ClaudeCode #Muxvo`,
        url: input.url,
      };
    case 'LinkedIn':
      return {
        text: `I published ${input.skillName} on Muxvo - Grade: ${input.grade}`,
        url: input.url,
      };
    default:
      return {
        text: `${input.skillName} - ${input.grade} (${input.score})`,
        url: input.url,
      };
  }
}

export interface WeChatShareInput {
  skillName: string;
  grade: string;
  score: number;
  radarData: Array<{ name: string; value: number }>;
}

export interface WeChatShareImage {
  width: number;
  height: number;
  elements: Array<{ type: string; data?: unknown }>;
}

export async function generateWeChatShareImage(
  input: WeChatShareInput,
): Promise<WeChatShareImage> {
  return {
    width: 750,
    height: 1334,
    elements: [
      { type: 'radar-chart', data: input.radarData },
      { type: 'skill-name', data: input.skillName },
      { type: 'score-display', data: { score: input.score, grade: input.grade } },
      { type: 'qr-code', data: `https://showcase.muxvo.com/s/${input.skillName}` },
      { type: 'brand', data: 'Muxvo' },
    ],
  };
}

export interface BadgeInput {
  grade: string;
  score: number;
  url: string;
}

export function generateBadgeMarkdown(input: BadgeInput): string {
  return `[![Muxvo Score: ${input.grade} (${input.score})](https://img.shields.io/badge/Muxvo-${input.grade}%20${input.score}-blue)](${input.url})`;
}
