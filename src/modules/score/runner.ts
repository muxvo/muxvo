/**
 * Score Runner - runs AI scoring for skills
 */

export interface RunScoreInput {
  skillPath: string;
  includeUsageData?: boolean;
}

export interface RunScoreResult {
  success: boolean;
  taskId?: string;
  error?: { code: string; message: string };
}

export async function runScore(_input: RunScoreInput): Promise<RunScoreResult> {
  // Default: CC is not running
  return {
    success: false,
    error: {
      code: 'CC_NOT_RUNNING',
      message: '请先启动一个 Claude Code 终端',
    },
  };
}
