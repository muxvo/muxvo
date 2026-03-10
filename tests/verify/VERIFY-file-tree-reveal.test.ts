/**
 * VERIFY-file-tree-reveal — Unit test for file tree auto-reveal logic
 *
 * Tests the public insertAfter utility by simulating the multi-level
 * sequential expand that the auto-reveal useEffect performs.
 * Does NOT test private functions (getAncestorPaths stays internal to FileTempView).
 *
 * Run: npx vitest run tests/verify/VERIFY-file-tree-reveal.test.ts --config=tests/verify/vitest.verify.config.ts
 */

import { describe, it, expect } from 'vitest';
import { insertAfter, type TreeEntry } from '@/renderer/utils/file-tree';

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

  it('simulates multi-level auto-expand (the reveal algorithm)', () => {
    // This simulates exactly what FileTempView's useEffect does:
    // sequentially expand ancestors to reveal a deep file
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
