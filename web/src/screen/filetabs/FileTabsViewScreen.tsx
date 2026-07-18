/**
 * tab 式文件视图静态屏（specs/behavior/file-tabs-view.md §1/§8）。纯 props 吃 fixture，永不 mock IPC。
 * fixture 载荷 → FileTabsView props：load 恒 loaded、回调全缺席（inert，golden 工艺）、
 * renderHole=false（终端 tab 出占位 div 而非真洞）。
 * 左树 withMeta=true 与 useLiveFileTree.selectEntries 同口径（golden 与 live 派生序/尺寸徽记字节一致）。
 */

import { FileTabsView } from './FileTabsView';
import { buildTerminalLights } from './FileTabBar';
import { cardTitle } from '../../tile/MiniTermCard';
import type { TerminalFixture } from '../../fixture/types';
import { flattenTree, type DirEntry } from '../file/file-tree-static';
import {
  TERMINAL_TAB_ID,
  type FileTab,
  type FileTabsDialog,
  type FileType,
  type TabLoad,
} from './fileTabsReducer';

interface FixtureTab {
  path: string;
  name: string;
  fileType: FileType;
  content: string;
  /** 缺省按 fileType 推断（image/pdf/spreadsheet=base64，其余 utf8） */
  encoding?: 'utf8' | 'base64';
  truncated?: boolean;
  /** 非空 = dirty（tab 头琥珀点 + 内容取草稿值） */
  dirtyValue?: string;
  mdSource?: boolean;
  saveError?: string;
}

interface FileTabsFixture {
  sourceTerminalId: string;
  /** 洞内显示终端（§2.5 灯组指示条落点）；缺省 = sourceTerminalId */
  displayedTerminalId?: string;
  projectCwd: string;
  /** 左树展开的目录绝对路径（多层展开：子目录也列于此，dirs 需含其列表） */
  expandFolders?: string[];
  tabs: FixtureTab[];
  activeId: string;
  dialog?: FileTabsDialog | null;
}

function needsBase64(fileType: FileType): boolean {
  return fileType === 'image' || fileType === 'pdf' || fileType === 'spreadsheet';
}

export function FileTabsViewScreen({ fx }: { fx: any }): JSX.Element {
  const f: FileTabsFixture = fx.fileTabs;
  const dirs: Record<string, DirEntry[]> = fx.dirs ?? {};
  const showHidden = !!fx.fileConfig?.showHiddenFiles;
  const entries = flattenTree(dirs, f.projectCwd, f.expandFolders ?? [], showHidden, true);

  const baseTerminals: TerminalFixture[] = fx.base?.terminals ?? [];
  const term = baseTerminals.find((t) => t.id === f.sourceTerminalId);
  const terminalLabel = term?.customName ?? (f.projectCwd.split('/').pop() || '~');
  // 灯组（§2.5）：与 Live 同一映射（buildTerminalLights）；onSelectTerminal 不传 = inert。
  // 单终端 fixture（如 ftabs-dirty-exit）灯组在 FileTabBar 层隐藏，DOM 恒等（golden 零字节）。
  const displayedId = f.displayedTerminalId ?? f.sourceTerminalId;
  const displayedTerm = baseTerminals.find((t) => t.id === displayedId);
  const lights = buildTerminalLights(baseTerminals, f.sourceTerminalId, displayedId);
  // 仅 displayed≠source 才覆盖终端 tab 名（缺省路径与既有 golden 字节恒等）
  const displayedTerminalLabel =
    displayedId !== f.sourceTerminalId && displayedTerm ? cardTitle(displayedTerm) : undefined;

  const tabs: FileTab[] = f.tabs.map((t) => {
    const encoding: 'utf8' | 'base64' = t.encoding ?? (needsBase64(t.fileType) ? 'base64' : 'utf8');
    const load: TabLoad = {
      k: 'loaded',
      content: t.content,
      encoding,
      truncated: !!t.truncated,
      mtimeMs: 0,
    };
    return {
      path: t.path,
      name: t.name,
      fileType: t.fileType,
      load,
      dirtyValue: t.dirtyValue ?? null,
      mdSource: !!t.mdSource,
      saving: false,
      saveError: t.saveError ?? null,
    };
  });

  return (
    <FileTabsView
      sourceTerminalId={f.sourceTerminalId}
      displayedTerminalId={displayedId}
      terminalLabel={terminalLabel}
      displayedTerminalLabel={displayedTerminalLabel}
      lights={lights}
      entries={entries}
      showHidden={showHidden}
      activeFilePath={f.activeId === TERMINAL_TAB_ID ? null : f.activeId}
      tabs={tabs}
      activeId={f.activeId}
      dialog={f.dialog ?? null}
      renderHole={false}
    />
  );
}
