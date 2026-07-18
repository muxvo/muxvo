/**
 * Markdown wysiwyg/source 双模编辑器（M6 批1；批3 file-temp-view 复用）。
 *
 * golden 铁律：TipTap 只经下方 React.lazy(() => import('./TiptapEditor')) 加载——TipTap 全量落
 * 独立 chunk，绝不进初始/截图 bundle。source 模式为纯 <textarea>（不涉 TipTap，sk-dirty golden 同款）。
 *
 * 契约：wysiwyg 编辑 → tiptap-markdown 序列化为 markdown → onChange(md)（上抛 dirty）；
 * ⌘/（Cmd/Ctrl+Slash）切 source/wysiwyg；类名对齐 `.markdown-wysiwyg .tiptap`（golden DOM 形状）。
 */
import { Suspense, lazy, useCallback } from 'react';
import type { KeyboardEvent } from 'react';

const TiptapEditor = lazy(() => import('./TiptapEditor'));

export type MarkdownEditorMode = 'wysiwyg' | 'source';

export interface MarkdownWysiwygLiveProps {
  value: string;
  onChange: (md: string) => void;
  mode: MarkdownEditorMode;
  onModeChange: (mode: MarkdownEditorMode) => void;
  className?: string;
}

export function MarkdownWysiwygLive({
  value,
  onChange,
  mode,
  onModeChange,
  className,
}: MarkdownWysiwygLiveProps): JSX.Element {
  const onKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        onModeChange(mode === 'wysiwyg' ? 'source' : 'wysiwyg');
      }
    },
    [mode, onModeChange],
  );

  return (
    <div
      className={`markdown-wysiwyg-live${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
    >
      {mode === 'source' ? (
        <textarea
          className="markdown-wysiwyg-live__source"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        // .markdown-wysiwyg > div(EditorContent) > .tiptap（golden 契约形状；TipTap 懒加载）
        <div className="markdown-wysiwyg">
          <Suspense fallback={<div className="markdown-wysiwyg-live__loading" />}>
            <TiptapEditor value={value} onChange={onChange} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
