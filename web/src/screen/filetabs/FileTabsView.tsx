/**
 * tab 式文件视图壳（specs/behavior/file-tabs-view.md §1）：左树 250 常驻 + tab 栏 + 内容区，
 * dialog!=null 时 UnsavedDialog 覆盖层。纯 View：回调全可选（未传=静态 inert，golden 工艺）。
 *
 * 内容区分发：终端 tab 活跃→真洞（`.tile-term-hole`，native 洞后合成，task-center 岛/洞并存先例）；
 * 文件 tab→按 load 态（loading/error/loaded）再按 fileType 分发 body。
 */

import type { MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react';
import { DEFAULT_FTV_LEFT_WIDTH } from '../../config/defaults';
import type { FlatEntry } from '../file/file-tree-static';
import { FileTreeRows } from '../file/FileTreeRows';
import { EyeOnIcon, EyeOffIcon } from '../file/EyeIcons';
import { FileTabBar, type TerminalLight } from './FileTabBar';
import { MarkdownBody } from './MarkdownBody';
import { TextEditBody } from './TextEditBody';
import { ImageBody } from './ImageBody';
import { PdfBody } from './PdfBody';
import { SpreadsheetBody } from './SpreadsheetBody';
import { UnsavedDialog, type DialogAction } from './UnsavedDialog';
import { TERMINAL_TAB_ID, type FileTab, type FileTabsDialog } from './fileTabsReducer';
import './file-tabs.css';

export interface FileTabsViewProps {
  sourceTerminalId: string;
  /** 洞内当前显示的终端（§2.5）；缺省 = sourceTerminalId（既有单终端语义零变） */
  displayedTerminalId?: string;
  /** owner 终端名：左栏头恒用它 */
  terminalLabel: string;
  /** 终端 tab 显示名跟随 displayed（§2.5）；缺省 = terminalLabel */
  displayedTerminalLabel?: string;
  /** 终端状态灯组（§2.5）；缺席或 <2 灯不渲染（判断在 FileTabBar 一处） */
  lights?: TerminalLight[];
  /** 点灯 → showTerminal。未传不挂监听（inert）。 */
  onSelectTerminal?: (id: string) => void;
  entries: FlatEntry[];
  emptyState?: 'empty' | 'permission' | null;
  showHidden: boolean;
  /** 左树当前活跃文件行高亮（file-item--active） */
  activeFilePath: string | null;
  tabs: FileTab[];
  activeId: string;
  dialog: FileTabsDialog | null;
  /** 终端 tab 活跃时是否渲染真洞（live=true）；静态屏不传/false → 渲染占位同款 div */
  renderHole?: boolean;
  onSelectTab?: (id: string) => void;
  onCloseTab?: (path: string) => void;
  onExit?: () => void;
  onItemClick?: (entry: FlatEntry) => void;
  /** 左树行右键 → showFileMenu（live 挂；静态屏不传 → 行不挂 onContextMenu，DOM 恒等）。 */
  onItemContextMenu?: (entry: FlatEntry, e: ReactMouseEvent) => void;
  /** 内容区右键 → 活跃文件 showFileMenu（textarea/选区/终端 tab 豁免在 live 侧守卫）。 */
  onContentContextMenu?: (e: ReactMouseEvent) => void;
  onToggleHidden?: () => void;
  onEdit?: (path: string, value: string) => void;
  onToggleMdSource?: (path: string) => void;
  onDialogAction?: (a: DialogAction) => void;
  editorRef?: Ref<HTMLTextAreaElement>;
  /** markdown 只读真渲染（live 动态注入 markdown/md-view）；不传 = md-static golden 路径（MarkdownBody）。 */
  renderMd?: (text: string) => ReactNode;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

function imageSrc(name: string, content: string, encoding: 'utf8' | 'base64'): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  const mime = IMAGE_MIME[ext] ?? 'image/png';
  return encoding === 'base64'
    ? `data:${mime};base64,${content}`
    : `data:${mime};utf8,${encodeURIComponent(content)}`;
}

export function FileTabsView(props: FileTabsViewProps): JSX.Element {
  const {
    sourceTerminalId,
    displayedTerminalId,
    terminalLabel,
    displayedTerminalLabel,
    lights,
    onSelectTerminal,
    entries,
    emptyState,
    showHidden,
    activeFilePath,
    tabs,
    activeId,
    dialog,
    renderHole,
    onSelectTab,
    onCloseTab,
    onExit,
    onItemClick,
    onItemContextMenu,
    onContentContextMenu,
    onToggleHidden,
    onEdit,
    onToggleMdSource,
    onDialogAction,
    editorRef,
    renderMd,
  } = props;

  const activeTab = activeId === TERMINAL_TAB_ID ? undefined : tabs.find((t) => t.path === activeId);
  // 洞绑 displayed（§2.5）；key 强制重挂是切显生效的命门——useLayoutReport 的 MutationObserver
  // 只观察 childList，属性级 data-term-id 变更零上报，重挂才触发重采集。
  const holeTerminalId = displayedTerminalId ?? sourceTerminalId;

  function renderBody(): JSX.Element {
    if (activeId === TERMINAL_TAB_ID) {
      return renderHole === false ? (
        <div key={holeTerminalId} className="file-tabs-view__term-placeholder" data-term-id={holeTerminalId} />
      ) : (
        <div key={holeTerminalId} className="tile-term-hole" data-term-id={holeTerminalId} data-term-role="grid" />
      );
    }
    if (!activeTab) return <div className="file-tabs-view__loading" />;
    if (activeTab.load.k === 'loading') return <div className="file-tabs-view__loading">加载中…</div>;
    if (activeTab.load.k === 'error') {
      return <div className="file-tabs-view__error">{activeTab.load.message}</div>;
    }
    const content = activeTab.load.content;
    switch (activeTab.fileType) {
      case 'markdown':
        return (
          <MarkdownBody
            tab={activeTab}
            onEdit={onEdit}
            onToggleMdSource={onToggleMdSource}
            editorRef={editorRef}
            renderMd={renderMd}
          />
        );
      case 'code':
      case 'text':
        return <TextEditBody tab={activeTab} onEdit={onEdit} editorRef={editorRef} />;
      case 'image':
        return <ImageBody src={imageSrc(activeTab.name, content, activeTab.load.encoding)} alt={activeTab.name} />;
      case 'spreadsheet':
        return <SpreadsheetBody base64={content} />;
      case 'pdf':
        // key=path：pdf→pdf 切 tab 强制重挂——PdfBody 以命令式 append canvas 渲染，
        // 复用实例会残留前一文件的页面画布（对抗验收 MINOR-1）。
        return <PdfBody key={activeTab.path} base64={content} />;
    }
  }

  // 终端 tab 活跃且渲染真洞时挂 --hole 修饰类：live-transparent.css 据此把 root（--bg-deep）
  // 与 content（--bg-primary）打成透明，native 直渲的终端才可见（洞矩形外由左栏/tab 栏
  // 自有背景盖住，观感不变）。3 张 golden 均为文件 tab 活跃态，此类不出现，零像素影响。
  const holeActive = activeId === TERMINAL_TAB_ID && renderHole !== false;

  return (
    <div className={`file-tabs-view${holeActive ? ' file-tabs-view--hole' : ''}`}>
      <div className="file-tabs-view__left" style={{ width: DEFAULT_FTV_LEFT_WIDTH }}>
        <div className="file-tabs-view__left-header">
          <span className="file-tabs-view__left-title">{terminalLabel}</span>
          <button
            className={`file-tabs-view__toggle-hidden${showHidden ? ' file-tabs-view__toggle-hidden--active' : ''}`}
            title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
            onClick={onToggleHidden}
          >
            {showHidden ? <EyeOnIcon /> : <EyeOffIcon />}
          </button>
        </div>
        <div className="file-tabs-view__left-content">
          {emptyState ? (
            <div className="file-tabs-view__empty">
              <span className="file-tabs-view__empty-icon">{emptyState === 'permission' ? '🔒' : '📁'}</span>
              <span className="file-tabs-view__empty-text">
                {emptyState === 'permission' ? '无法读取此目录，请检查权限' : '此目录为空'}
              </span>
            </div>
          ) : (
            <FileTreeRows
              entries={entries}
              activeFilePath={activeFilePath}
              onItemClick={onItemClick}
              onItemContextMenu={onItemContextMenu}
            />
          )}
        </div>
      </div>

      <div className="file-tabs-view__main">
        <FileTabBar
          terminalLabel={displayedTerminalLabel ?? terminalLabel}
          tabs={tabs}
          activeId={activeId}
          lights={lights}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onSelectTerminal={onSelectTerminal}
          onExit={onExit}
        />
        <div
          className={`file-tabs-view__content${holeActive ? ' file-tabs-view__content--hole' : ''}`}
          onContextMenu={onContentContextMenu}
        >
          {activeTab?.saveError && <div className="file-tabs-view__save-error">{activeTab.saveError}</div>}
          {renderBody()}
        </div>
      </div>

      {dialog && <UnsavedDialog dialog={dialog} onAction={onDialogAction} />}
    </div>
  );
}
