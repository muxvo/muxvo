/**
 * Version Resolver - determines version number for publishing
 */

export interface VersionInput {
  previouslyPublished: boolean;
  currentVersion?: string;
}

export function resolveVersion(input: VersionInput): string {
  if (!input.previouslyPublished) {
    return '1.0.0';
  }
  // For subsequent publishes, bump patch version
  const parts = (input.currentVersion || '1.0.0').split('.').map(Number);
  parts[2] += 1;
  return parts.join('.');
}
