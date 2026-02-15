/**
 * Score Manager
 *
 * AI scoring with retry logic, JSON parsing validation,
 * and CC terminal availability check.
 */

export function createScoreManager() {
  let apiFailure = false;
  let invalidJson = false;
  let ccTerminalRunning = true;

  function simulateApiFailure(enabled: boolean): void {
    apiFailure = enabled;
  }

  function simulateInvalidJsonResponse(enabled: boolean): void {
    invalidJson = enabled;
  }

  function setCCTerminalRunning(running: boolean): void {
    ccTerminalRunning = running;
  }

  function runScoring() {
    // Check CC terminal availability first
    if (!ccTerminalRunning) {
      return {
        success: false,
        blocked: true,
        message: '请先启动一个 Claude Code 终端',
        retryCount: 0,
      };
    }

    // Simulate API failure with 3 retries
    if (apiFailure) {
      return {
        success: false,
        retryCount: 3,
        error: { message: '评分失败：API 调用连续失败' },
      };
    }

    // Simulate invalid JSON response
    if (invalidJson) {
      return {
        success: false,
        retryCount: 1,
        error: { message: '评分结果格式异常，已自动重试' },
      };
    }

    return {
      success: true,
      retryCount: 0,
      score: 0,
    };
  }

  return {
    simulateApiFailure,
    simulateInvalidJsonResponse,
    setCCTerminalRunning,
    runScoring,
  };
}
