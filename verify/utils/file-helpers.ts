import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob as globFn } from 'glob';

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function dirExists(dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

export function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  return globFn(pattern, { cwd, absolute: true });
}

export function resolveProjectPath(projectRoot: string, ...segments: string[]): string {
  return path.join(projectRoot, ...segments);
}
