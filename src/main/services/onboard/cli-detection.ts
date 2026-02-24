import { execSync } from 'child_process';

const SCANNED_TOOLS = ['claude', 'codex', 'gemini'];

export async function detectCliTools() {
  const tools: Array<{ name: string; installed: boolean; path?: string }> = [];

  for (const tool of SCANNED_TOOLS) {
    try {
      const toolPath = execSync(`which ${tool}`, { encoding: 'utf-8' }).trim();
      tools.push({ name: tool, path: toolPath, installed: true });
    } catch {
      tools.push({ name: tool, installed: false });
    }
  }

  return { tools };
}
