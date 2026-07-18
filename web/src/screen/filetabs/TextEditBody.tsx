/**
 * code/text tab 内容：行号列 + 受控 textarea（行号列随 textarea 滚动同步）。
 * truncated（超大文件 >2MB）→ 顶部只读横幅 + textarea readOnly。code 与 text 共用，仅样式 hook 差异。
 * 回调缺省（onEdit 未传）= 静态只读（golden 工艺）。
 */

import { useRef, type Ref, type UIEvent } from 'react';
import type { FileTab } from './fileTabsReducer';

interface TextEditBodyProps {
  tab: FileTab;
  onEdit?: (path: string, value: string) => void;
  editorRef?: Ref<HTMLTextAreaElement>;
}

export function TextEditBody({ tab, onEdit, editorRef }: TextEditBodyProps): JSX.Element {
  const content = tab.load.k === 'loaded' ? tab.load.content : '';
  const truncated = tab.load.k === 'loaded' && tab.load.truncated;
  const value = tab.dirtyValue ?? content;
  const lineCount = value.length === 0 ? 1 : value.split('\n').length;
  const gutterRef = useRef<HTMLDivElement>(null);
  const readOnly = !onEdit || truncated;

  const onScroll = (e: UIEvent<HTMLTextAreaElement>): void => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className={`file-tabs-view__text${tab.fileType === 'code' ? ' file-tabs-view__text--code' : ''}`}>
      {truncated && (
        <div className="file-tabs-view__truncated-banner">文件过大，仅显示部分内容（只读）</div>
      )}
      <div className="file-tabs-view__editor-wrap">
        <div className="file-tabs-view__gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="file-tabs-view__gutter-line">
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={editorRef}
          className="file-tabs-view__editor"
          value={value}
          onChange={onEdit && !truncated ? (e) => onEdit(tab.path, e.target.value) : undefined}
          onScroll={onScroll}
          readOnly={readOnly}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
