/**
 * VERIFY-folder-drag-to-terminal
 *
 * Verifies that folder items in FilePanel are draggable to terminal,
 * same as file items. The isDraggable condition should allow both
 * file and folder types when filePath is present.
 */

import { describe, it, expect } from 'vitest';
import { shellEscapePath } from '@/renderer/utils/shell-escape';

// ─── isDraggable condition (extracted from FileItem.tsx line 48) ────

describe('FileItem isDraggable for folders', () => {
  // Read the actual source to verify the condition
  it('source code should NOT restrict isDraggable to file type only', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../src/renderer/components/file/FileItem.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // The old buggy condition: type === 'file' && !!filePath
    // Should NOT match — folders must also be draggable
    const hasBuggyCondition = /isDraggable\s*=\s*type\s*===\s*['"]file['"]/.test(source);
    expect(hasBuggyCondition).toBe(false);
  });

  it('source code should set isDraggable based on filePath only', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../../src/renderer/components/file/FileItem.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // The fixed condition: !!filePath (no type check)
    const hasFixedCondition = /isDraggable\s*=\s*!!filePath/.test(source);
    expect(hasFixedCondition).toBe(true);
  });
});

// ─── Shell escape works for folder paths ────────────────────────

describe('shellEscapePath for folder paths', () => {
  it('handles simple folder path (no trailing slash)', () => {
    expect(shellEscapePath('/Users/foo/my-project')).toBe('/Users/foo/my-project');
  });

  it('escapes folder with spaces', () => {
    expect(shellEscapePath('/Users/foo/my project')).toBe("'/Users/foo/my project'");
  });

  it('escapes folder with parentheses', () => {
    expect(shellEscapePath('/Users/foo/dir (copy)')).toBe("'/Users/foo/dir (copy)'");
  });

  it('escapes folder with special chars', () => {
    expect(shellEscapePath('/Users/foo/$HOME')).toBe("'/Users/foo/$HOME'");
  });
});
