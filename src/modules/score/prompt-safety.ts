/**
 * Prompt Safety - sanitizes skill content to prevent prompt injection
 */

export function sanitizeSkillContent(content: string): string {
  return `<skill-content>\n${content}\n</skill-content>`;
}
