/**
 * markdown tab 内容：mdSource? 受控 textarea（Source 可编辑）: 只读渲染。
 * 顶部小工具条含 WYSIWYG/Source 切换钮（title="⌘/"，老屏同款）。
 * 只读渲染双轨（dogfood-r3 问题7，chat static/live 双渲染器同款工艺）：
 *  - renderMd 传入（live 容器动态 import markdown/md-view 注入）→ 真渲染 `.markdown-view`；
 *  - 缺省（golden/截图路径）→ md-static + .markdown-wysiwyg .tiptap 容器类，逐字节不变。
 * 回调缺省 = 静态只读（golden 工艺）。
 */

import type { ReactNode, Ref } from 'react';
import { renderMarkdown } from '../md-static';
import type { FileTab } from './fileTabsReducer';

interface MarkdownBodyProps {
  tab: FileTab;
  onEdit?: (path: string, value: string) => void;
  onToggleMdSource?: (path: string) => void;
  editorRef?: Ref<HTMLTextAreaElement>;
  renderMd?: (text: string) => ReactNode;
}

export function MarkdownBody({ tab, onEdit, onToggleMdSource, editorRef, renderMd }: MarkdownBodyProps): JSX.Element {
  const content = tab.load.k === 'loaded' ? tab.load.content : '';
  const value = tab.dirtyValue ?? content;
  return (
    <div className="file-tabs-view__md">
      <div className="file-tabs-view__md-toolbar">
        <button
          className={`file-tabs-view__md-mode${tab.mdSource ? ' file-tabs-view__md-mode--active' : ''}`}
          title="⌘/"
          onClick={onToggleMdSource ? () => onToggleMdSource(tab.path) : undefined}
        >
          {tab.mdSource ? 'WYSIWYG' : 'Source'}
        </button>
      </div>
      {tab.mdSource ? (
        <textarea
          ref={editorRef}
          className="file-tabs-view__editor"
          value={value}
          onChange={onEdit ? (e) => onEdit(tab.path, e.target.value) : undefined}
          readOnly={!onEdit}
          spellCheck={false}
        />
      ) : renderMd ? (
        renderMd(value)
      ) : (
        <div className="markdown-wysiwyg">
          <div>
            <div className="tiptap ProseMirror">{renderMarkdown(value)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
