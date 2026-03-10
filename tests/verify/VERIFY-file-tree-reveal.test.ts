/**
 * VERIFY-file-tree-reveal — Unit test for file tree auto-reveal logic
 *
 * Tests:
 * 1. getAncestorPaths computes correct ancestor directory paths
 * 2. insertAfter correctly builds expanded tree structure
 * 3. Edge cases: root-level file, file outside projectCwd, single-level nesting
 *
 * Run: npx vitest run tests/verify/VERIFY-file-tree-reveal.test.ts --config=tests/verify/vitest.verify.config.ts
 */

import { describe, it, expect } from 'vitest';
import { getAncestorPaths, insertAfter, type TreeEntry } from '@/renderer/utils/file-tree';

describe('getAncestorPaths', () => {
  it('returns ancestor paths for deeply nested file', () => {
    const result = getAncestorPaths(
      '/Users/rl/project',
      '/Users/rl/project/src/renderer/components/file/FileTempView.tsx'
    );
    expect(result).toEqual([
      '/Users/rl/project/src',
      '/Users/rl/project/src/renderer',
      '/Users/rl/project/src/renderer/components',
      '/Users/rl/project/src/renderer/components/file',
    ]);
  });

  it('returns empty array for file in root directory', () => {
    const result = getAncestorPaths('/Users/rl/project', '/Users/rl/project/README.md');
    expect(result).toEqual([]);
  });

  it('returns empty array when filePath is not under projectCwd', () => {
    const result = getAncestorPaths('/Users/rl/project', '/Users/rl/other/src/file.ts');
    expect(result).toEqual([]);
  });

  it('returns single ancestor for one level deep', () => {
    const result = getAncestorPaths('/Users/rl/project', '/Users/rl/project/src/index.ts');
    expect(result).toEqual(['/Users/rl/project/src']);
  });

  it('handles paths with similar prefixes correctly', () => {
    // /project-extra should NOT match /project
    const result = getAncestorPaths('/Users/rl/project', '/Users/rl/project-extra/src/file.ts');
    expect(result).toEqual([]);
  });

  it('handles two levels deep', () => {
    const result = getAncestorPaths('/a/b', '/a/b/c/d/file.txt');
    expect(result).toEqual(['/a/b/c', '/a/b/c/d']);
  });
});

describe('insertAfter builds expanded tree', () => {
  it('inserts children after parent folder entry', () => {
    const tree: TreeEntry[] = [
      { name: 'docs', type: 'folder', indent: 0, path: '/p/docs' },
      { name: 'src', type: 'folder', indent: 0, path: '/p/src' },
      { name: 'README.md', type: 'file', ext: 'md', indent: 0, path: '/p/README.md' },
    ];
    const parent = tree[1]; // src
    const children: TreeEntry[] = [
      { name: 'components', type: 'folder', indent: 1, path: '/p/src/components' },
      { name: 'index.ts', type: 'file', ext: 'ts', indent: 1, path: '/p/src/index.ts' },
    ];
    const result = insertAfter(tree, parent, children);

    expect(result).toEqual([
      { name: 'docs', type: 'folder', indent: 0, path: '/p/docs' },
      { name: 'src', type: 'folder', indent: 0, path: '/p/src' },
      { name: 'components', type: 'folder', indent: 1, path: '/p/src/components' },
      { name: 'index.ts', type: 'file', ext: 'ts', indent: 1, path: '/p/src/index.ts' },
      { name: 'README.md', type: 'file', ext: 'md', indent: 0, path: '/p/README.md' },
    ]);
  });

  it('simulates multi-level auto-expand', () => {
    // Simulate the reveal algorithm: expand src → then expand components inside src
    let tree: TreeEntry[] = [
      { name: 'src', type: 'folder', indent: 0, path: '/p/src' },
      { name: 'package.json', type: 'file', ext: 'json', indent: 0, path: '/p/package.json' },
    ];

    // Step 1: expand src
    const srcChildren: TreeEntry[] = [
      { name: 'components', type: 'folder', indent: 1, path: '/p/src/components' },
      { name: 'utils', type: 'folder', indent: 1, path: '/p/src/utils' },
    ];
    tree = insertAfter(tree, tree[0], srcChildren);

    expect(tree.map(e => e.name)).toEqual(['src', 'components', 'utils', 'package.json']);

    // Step 2: expand components (inside src)
    const compChildren: TreeEntry[] = [
      { name: 'file', type: 'folder', indent: 2, path: '/p/src/components/file' },
      { name: 'Button.tsx', type: 'file', ext: 'tsx', indent: 2, path: '/p/src/components/Button.tsx' },
    ];
    const componentsEntry = tree.find(e => e.path === '/p/src/components')!;
    tree = insertAfter(tree, componentsEntry, compChildren);

    expect(tree.map(e => e.name)).toEqual([
      'src', 'components', 'file', 'Button.tsx', 'utils', 'package.json',
    ]);
    expect(tree.map(e => e.indent)).toEqual([0, 1, 2, 2, 1, 0]);

    // Step 3: expand file (inside components)
    const fileChildren: TreeEntry[] = [
      { name: 'FileItem.tsx', type: 'file', ext: 'tsx', indent: 3, path: '/p/src/components/file/FileItem.tsx' },
      { name: 'FilePanel.tsx', type: 'file', ext: 'tsx', indent: 3, path: '/p/src/components/file/FilePanel.tsx' },
    ];
    const fileEntry = tree.find(e => e.path === '/p/src/components/file')!;
    tree = insertAfter(tree, fileEntry, fileChildren);

    expect(tree.map(e => e.name)).toEqual([
      'src', 'components', 'file', 'FileItem.tsx', 'FilePanel.tsx', 'Button.tsx', 'utils', 'package.json',
    ]);
    expect(tree.map(e => e.indent)).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);

    // After reveal, FilePanel.tsx is visible in the flat list — the feature works
    const targetFile = tree.find(e => e.path === '/p/src/components/file/FilePanel.tsx');
    expect(targetFile).toBeDefined();
    expect(targetFile!.indent).toBe(3);
  });
});
