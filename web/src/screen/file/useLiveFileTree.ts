/**
 * 懒加载文件树 live 版（specs/behavior/file-panel.md §0.5/§3）。
 * 复用 flattenTree 派生扁平列表（缓存字典与 fixture dirs 完全同构 → golden 与 live 行为字节一致）。
 *
 * reducer 纯函数（treeReducer/selectEntries/selectEmptyState 直测，不进 DOM）：
 *  - root 变化/面板重开：清态重拉 readDir(root)（卸载即弃缓存，与 legacy 每次开面板重拉一致）。
 *  - toggleDir：已展开 → collapse（**保 cache** 重展不重拉；后代展开态 flattenTree 天然不渲染）；
 *    未展开 → expand，cache 缺则拉，**子目录失败静默**，仅 root 失败入面板级空态。
 *  - 判空口径：readDir ok 且**全量** 0 条才算空目录（隐藏被 showHidden=off 滤空 ≠ 空目录，不说谎）。
 */

import { useEffect, useReducer, useRef } from 'react';
import type { FsRequest, FsResponse } from '../../bridge/gen/protocol';
import { flattenTree, type DirEntry, type FlatEntry } from './file-tree-static';

export type RootError = 'permissionDenied' | 'notFound' | null;

export interface TreeState {
  cache: Record<string, DirEntry[]>; // path → 已拉取子项（含 dotfiles）
  pending: Set<string>; // 拉取中（展开加载反馈 REQ-027）
  expanded: Set<string>; // 展开集合（含嵌套路径）
  rootError: RootError; // 仅 root 失败入面板级空态
  root: string;
}

export function initialTreeState(root = ''): TreeState {
  return { cache: {}, pending: new Set(), expanded: new Set(), rootError: null, root };
}

export type TreeAction =
  | { type: 'reset'; root: string }
  | { type: 'requestDir'; path: string }
  | { type: 'dirLoaded'; path: string; entries: DirEntry[] }
  | { type: 'dirFailed'; path: string; code: RootError }
  | { type: 'expand'; path: string }
  | { type: 'collapse'; path: string };

export function treeReducer(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case 'reset':
      return { ...initialTreeState(action.root), pending: new Set([action.root]) };
    case 'requestDir': {
      const pending = new Set(state.pending);
      pending.add(action.path);
      return { ...state, pending };
    }
    case 'dirLoaded': {
      const pending = new Set(state.pending);
      pending.delete(action.path);
      const rootError = action.path === state.root ? null : state.rootError;
      return { ...state, cache: { ...state.cache, [action.path]: action.entries }, pending, rootError };
    }
    case 'dirFailed': {
      const pending = new Set(state.pending);
      pending.delete(action.path);
      // 仅 root 失败给面板文案；子目录失败静默（pending 清掉即可，无子项）。
      const rootError = action.path === state.root ? action.code : state.rootError;
      return { ...state, pending, rootError };
    }
    case 'expand': {
      const expanded = new Set(state.expanded);
      expanded.add(action.path);
      return { ...state, expanded };
    }
    case 'collapse': {
      const expanded = new Set(state.expanded);
      expanded.delete(action.path);
      return { ...state, expanded }; // 保 cache
    }
    default:
      return state;
  }
}

/** entries = flattenTree(cache, root, [...expanded], showHidden, true)（派生序与 golden 同构）。 */
export function selectEntries(state: TreeState, showHidden: boolean): FlatEntry[] {
  return flattenTree(state.cache, state.root, [...state.expanded], showHidden, true);
}

/** 面板级空态：permission → 🔒；readDir ok 且全量 0 条 → empty(📁)；否则 null（有条目/加载中/隐藏滤空）。 */
export function selectEmptyState(state: TreeState): 'empty' | 'permission' | null {
  if (state.rootError === 'permissionDenied') return 'permission';
  const full = state.cache[state.root];
  if (full && full.length === 0) return 'empty';
  return null;
}

/** rejected.code → RootError（permission 走 🔒，其余归 notFound=blank，不误显「请检查权限」）。 */
function toRootError(code: string): RootError {
  return code === 'permissionDenied' ? 'permissionDenied' : 'notFound';
}

export interface LiveFileTree {
  state: TreeState;
  entries: FlatEntry[];
  emptyState: 'empty' | 'permission' | null;
  toggleDir(path: string): void;
}

/**
 * onFsRequest 存 ref（LiveSearchBar 范式）：桥线缆每 push 换新引用，若入 effect 依赖会每快照重拉整树。
 * reset effect 只依赖 root；请求令牌丢弃 root 切换后的迟到应答（重开竞态防线）。
 */
export function useLiveFileTree(
  root: string,
  showHidden: boolean,
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>,
): LiveFileTree {
  const [state, dispatch] = useReducer(treeReducer, root, initialTreeState);
  const onFsRequestRef = useRef(onFsRequest);
  onFsRequestRef.current = onFsRequest;
  const tokenRef = useRef(0);

  useEffect(() => {
    dispatch({ type: 'reset', root });
    const token = ++tokenRef.current;
    const fn = onFsRequestRef.current;
    if (!fn || !root) return;
    void fn({ kind: 'readDir', path: root })
      .then((resp: FsResponse) => {
        if (token !== tokenRef.current) return; // root 已切换，迟到应答丢弃
        if (resp.kind === 'dir') dispatch({ type: 'dirLoaded', path: root, entries: resp.entries });
        else if (resp.kind === 'rejected')
          dispatch({ type: 'dirFailed', path: root, code: toRootError(resp.code) });
      })
      .catch(() => {});
  }, [root]);

  const toggleDir = (path: string): void => {
    if (state.expanded.has(path)) {
      dispatch({ type: 'collapse', path });
      return;
    }
    dispatch({ type: 'expand', path });
    if (state.cache[path] || state.pending.has(path)) return; // 保 cache 重展不重拉 / 防重入
    dispatch({ type: 'requestDir', path });
    const fn = onFsRequestRef.current;
    if (!fn) return;
    void fn({ kind: 'readDir', path })
      .then((resp: FsResponse) => {
        if (resp.kind === 'dir') dispatch({ type: 'dirLoaded', path, entries: resp.entries });
        // 子目录失败静默：清 pending（dirFailed 对非 root 不置 rootError）。
        else if (resp.kind === 'rejected') dispatch({ type: 'dirFailed', path, code: 'notFound' });
      })
      .catch(() => dispatch({ type: 'dirFailed', path, code: 'notFound' }));
  };

  return { state, entries: selectEntries(state, showHidden), emptyState: selectEmptyState(state), toggleDir };
}
