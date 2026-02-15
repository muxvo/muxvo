/**
 * Name Checker - checks for marketplace name conflicts
 */

export interface NameConflictResult {
  conflict: boolean;
  suggestion?: string;
}

export async function checkNameConflict(name: string): Promise<NameConflictResult> {
  // Simulate: any non-empty name is treated as conflicting for safety
  return {
    conflict: true,
    suggestion: `${name}-2`,
  };
}
