const SCANNED_TOOLS = ['claude', 'codex', 'gemini'];

export async function detectCliTools() {
  const detectedTools: Array<{ name: string; path: string; version?: string }> = [];

  for (const tool of SCANNED_TOOLS) {
    // In a real implementation, this would scan PATH
    // For now, return empty detections (tools not found is valid)
    try {
      // Placeholder: actual detection would use child_process.execSync(`which ${tool}`)
    } catch {
      // Tool not found, skip
    }
  }

  return {
    detectedTools,
    scannedTools: SCANNED_TOOLS,
  };
}
