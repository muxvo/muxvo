/**
 * 右滑出文件树面板屏（specs/behavior/file-panel.md）。纯 props 吃 fixture，永不 mock IPC。
 * terminal-grid 底图 + 320px 右侧面板；树由 dirs 字典 + expandFolders 静态扁平化
 * （排序/过滤/缩进与 legacy 同构，file-tree-static.ts）。
 * M6 批A 起面板 DOM 抽进 FilePanelView（复刻屏与 live 组件共用）；本屏仅剩底图 + overlay + 传参。
 * ⚠️ NEW 徽标不可达（legacy mapIpcEntries 不产出 isNew，behavior spec §0）——不渲染。
 * `.file-panel__content[data-fx-ready]`：golden 侧 driver 展开完才打标，web 渲染即终态直接带。
 */

import { TerminalScreen } from '../TerminalScreen';
import { baseFixture } from '../popover/base';
import { flattenTree, type DirEntry } from './file-tree-static';
import { FilePanelView } from './FilePanelView';
import '../panels/panels.css'; // .file-item 基础行样式（legacy FilePanel.css 共享段）
import './file.css';

export function FilePanelScreen({ fx }: { fx: any }): JSX.Element {
  const base = baseFixture(fx);
  const fp: { projectCwd: string; expandFolders?: { name: string }[] } = fx.filePanel ?? {
    projectCwd: '/',
  };
  const dirs: Record<string, DirEntry[]> = fx.dirs ?? {};
  const showHidden = !!fx.fileConfig?.showHiddenFiles;
  // expandFolders 为顶层文件夹名（与 golden 驱动序一致；嵌套展开需要时再扩成路径）
  const expanded = (fp.expandFolders ?? []).map((f) => `${fp.projectCwd}/${f.name}`);
  const entries = flattenTree(dirs, fp.projectCwd, expanded, showHidden, true);
  const projectName = fp.projectCwd.split('/').pop() || '~';

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <TerminalScreen fx={base} />
      <div className="file-panel-overlay" />
      <FilePanelView projectName={projectName} entries={entries} showHidden={showHidden} open />
    </div>
  );
}
