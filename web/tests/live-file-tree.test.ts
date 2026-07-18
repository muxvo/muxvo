// M6 批A 懒加载文件树 reducer 纯逻辑（useLiveFileTree 抽出的纯函数直测，不进 DOM）：
//   cache/pending/expanded 变迁、root 变清态、子目录失败静默 vs root 失败入空态、
//   flattenTree 派生序（文件夹优先/localeCompare/showHidden 滤点头/展开子级 indent+1）、
//   selectEmptyState 判空口径（readDir ok 且全量 0 条才算空；隐藏滤空 ≠ 空目录，不说谎）。
// DOM 集成路径由 file-panel-live / file-panel.spec-cases 覆盖；本文件守 reducer 契约。
import { describe, expect, test } from 'vitest';
import {
  initialTreeState,
  treeReducer,
  selectEntries,
  selectEmptyState,
  type TreeState,
} from '../src/screen/file/useLiveFileTree';
import type { DirEntry } from '../src/screen/file/file-tree-static';

const ROOT = '/proj';
const ROOT_ENTRIES: DirEntry[] = [
  { name: 'src', isDirectory: true },
  { name: 'a.txt', isDirectory: false, size: 10 },
  { name: '.hidden', isDirectory: false, size: 5 },
];
const SRC_ENTRIES: DirEntry[] = [{ name: 'index.ts', isDirectory: false, size: 20 }];

/** 走 reset → dirLoaded(root) 到达「root 已加载」的常用起点。 */
function loadedRoot(root = ROOT, entries = ROOT_ENTRIES): TreeState {
  let s = initialTreeState(root);
  s = treeReducer(s, { type: 'reset', root });
  s = treeReducer(s, { type: 'dirLoaded', path: root, entries });
  return s;
}

describe('useLiveFileTree reducer', () => {
  test('initialTreeState：空 cache/pending/expanded、rootError=null、root 记录', () => {
    const s = initialTreeState(ROOT);
    expect(s.cache).toEqual({});
    expect(s.pending.size).toBe(0);
    expect(s.expanded.size).toBe(0);
    expect(s.rootError).toBeNull();
    expect(s.root).toBe(ROOT);
  });

  test('reset：清 cache/expanded/rootError，pending 置 {root}，root 更新', () => {
    let s = loadedRoot();
    s = treeReducer(s, { type: 'expand', path: `${ROOT}/src` });
    s = treeReducer(s, { type: 'reset', root: '/other' });
    expect(s.root).toBe('/other');
    expect(s.cache).toEqual({});
    expect(s.expanded.size).toBe(0);
    expect(s.rootError).toBeNull();
    expect([...s.pending]).toEqual(['/other']); // 立即拉 root
  });

  test('requestDir → pending 增；dirLoaded → cache 落 + pending 清', () => {
    let s = loadedRoot();
    s = treeReducer(s, { type: 'expand', path: `${ROOT}/src` });
    s = treeReducer(s, { type: 'requestDir', path: `${ROOT}/src` });
    expect(s.pending.has(`${ROOT}/src`)).toBe(true);
    s = treeReducer(s, { type: 'dirLoaded', path: `${ROOT}/src`, entries: SRC_ENTRIES });
    expect(s.pending.has(`${ROOT}/src`)).toBe(false);
    expect(s.cache[`${ROOT}/src`]).toEqual(SRC_ENTRIES);
  });

  test('dirFailed(root) → rootError 置码 + pending 清；dirFailed(子目录) → rootError 不变（静默）', () => {
    // root 失败
    let s = treeReducer(initialTreeState(ROOT), { type: 'reset', root: ROOT });
    s = treeReducer(s, { type: 'dirFailed', path: ROOT, code: 'permissionDenied' });
    expect(s.rootError).toBe('permissionDenied');
    expect(s.pending.has(ROOT)).toBe(false);

    // 子目录失败：root 已就绪、rootError 恒 null
    let s2 = loadedRoot();
    s2 = treeReducer(s2, { type: 'requestDir', path: `${ROOT}/src` });
    s2 = treeReducer(s2, { type: 'dirFailed', path: `${ROOT}/src`, code: 'notFound' });
    expect(s2.rootError).toBeNull(); // 静默：不入面板级空态
    expect(s2.pending.has(`${ROOT}/src`)).toBe(false);
    expect(s2.cache[`${ROOT}/src`]).toBeUndefined(); // 无子项
  });

  test('dirLoaded(root) 清掉先前 root 失败态（重拉成功恢复）', () => {
    let s = treeReducer(initialTreeState(ROOT), { type: 'reset', root: ROOT });
    s = treeReducer(s, { type: 'dirFailed', path: ROOT, code: 'permissionDenied' });
    expect(s.rootError).toBe('permissionDenied');
    s = treeReducer(s, { type: 'dirLoaded', path: ROOT, entries: ROOT_ENTRIES });
    expect(s.rootError).toBeNull();
  });

  test('expand 增、collapse 删——但保 cache（重展不重拉）', () => {
    let s = loadedRoot();
    s = treeReducer(s, { type: 'expand', path: `${ROOT}/src` });
    s = treeReducer(s, { type: 'dirLoaded', path: `${ROOT}/src`, entries: SRC_ENTRIES });
    expect(s.expanded.has(`${ROOT}/src`)).toBe(true);
    s = treeReducer(s, { type: 'collapse', path: `${ROOT}/src` });
    expect(s.expanded.has(`${ROOT}/src`)).toBe(false);
    expect(s.cache[`${ROOT}/src`], 'collapse 保 cache').toEqual(SRC_ENTRIES); // 重展命中缓存
  });
});

describe('selectEntries（flattenTree 派生序）', () => {
  test('文件夹优先 + localeCompare；showHidden=off 滤点头', () => {
    const s = loadedRoot();
    const names = selectEntries(s, false).map((e) => e.name);
    expect(names).toEqual(['src', 'a.txt']); // 文件夹先，.hidden 滤掉
  });

  test('showHidden=on → 点头条目回归（文件段 localeCompare：. 排在字母前）', () => {
    const s = loadedRoot();
    const names = selectEntries(s, true).map((e) => e.name);
    expect(names).toEqual(['src', '.hidden', 'a.txt']);
  });

  test('展开子级 indent+1、expanded 标记随派生', () => {
    let s = loadedRoot();
    s = treeReducer(s, { type: 'expand', path: `${ROOT}/src` });
    s = treeReducer(s, { type: 'dirLoaded', path: `${ROOT}/src`, entries: SRC_ENTRIES });
    const entries = selectEntries(s, false);
    const src = entries.find((e) => e.name === 'src')!;
    const child = entries.find((e) => e.name === 'index.ts')!;
    expect(src.indent).toBe(0);
    expect(src.expanded).toBe(true);
    expect(child.indent).toBe(1); // 子级缩进 +1
    expect(child.path).toBe(`${ROOT}/src/index.ts`);
  });

  test('折叠后后代不渲染（flattenTree 天然不下钻），保 cache 重展恢复', () => {
    let s = loadedRoot();
    s = treeReducer(s, { type: 'expand', path: `${ROOT}/src` });
    s = treeReducer(s, { type: 'dirLoaded', path: `${ROOT}/src`, entries: SRC_ENTRIES });
    expect(selectEntries(s, false).some((e) => e.name === 'index.ts')).toBe(true);
    s = treeReducer(s, { type: 'collapse', path: `${ROOT}/src` });
    expect(selectEntries(s, false).some((e) => e.name === 'index.ts')).toBe(false);
    s = treeReducer(s, { type: 'expand', path: `${ROOT}/src` });
    expect(selectEntries(s, false).some((e) => e.name === 'index.ts')).toBe(true); // cache 命中
  });
});

describe('selectEmptyState（判空口径）', () => {
  test('root permissionDenied → permission（🔒）', () => {
    let s = treeReducer(initialTreeState(ROOT), { type: 'reset', root: ROOT });
    s = treeReducer(s, { type: 'dirFailed', path: ROOT, code: 'permissionDenied' });
    expect(selectEmptyState(s)).toBe('permission');
  });

  test('readDir ok 且全量 0 条 → empty（📁）', () => {
    const s = loadedRoot(ROOT, []);
    expect(selectEmptyState(s)).toBe('empty');
  });

  test('root 未加载（loading，cache 缺）→ null（不误判空）', () => {
    const s = treeReducer(initialTreeState(ROOT), { type: 'reset', root: ROOT });
    expect(selectEmptyState(s)).toBeNull();
  });

  test('隐藏被滤空 ≠ 空目录：全量 >0（仅 .hidden）→ null，不说谎', () => {
    const s = loadedRoot(ROOT, [{ name: '.env', isDirectory: false, size: 3 }]);
    // selectEmptyState 按全量计数（1 条），与 showHidden 无关 → 非空态
    expect(selectEmptyState(s)).toBeNull();
    // 而 showHidden=off 时树区确实无行（滤空），面板留白但不显「此目录为空」
    expect(selectEntries(s, false)).toEqual([]);
  });

  test('root notFound（非 permission）→ null（留白，不误显请检查权限）', () => {
    let s = treeReducer(initialTreeState(ROOT), { type: 'reset', root: ROOT });
    s = treeReducer(s, { type: 'dirFailed', path: ROOT, code: 'notFound' });
    expect(selectEmptyState(s)).toBeNull();
  });
});
