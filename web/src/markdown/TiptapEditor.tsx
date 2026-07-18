/**
 * TipTap wysiwyg 编辑器（本仓库唯一静态 import @tiptap/* 的模块）。
 *
 * golden 铁律：只经 MarkdownWysiwygLive 的 React.lazy(() => import()) 动态加载 → Vite 把 TipTap
 * 全量切进独立 chunk，绝不进初始/截图可达 bundle；`?screenshot=1` 走静态 SkillsPanelScreen
 * （md-static.renderMarkdown），本模块一行不执行。default 导出供 React.lazy 消费。
 *
 * DOM 形状对齐 golden：`.markdown-wysiwyg > div(EditorContent) > .tiptap.ProseMirror`
 * （MarkdownWysiwyg.tsx legacy 产物同构，md-static 头注登记）。
 */
import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

export interface TiptapEditorProps {
  value: string;
  onChange: (md: string) => void;
}

export default function TiptapEditor({ value, onChange }: TiptapEditorProps): JSX.Element {
  // tiptap-markdown 注入 storage.markdown.getMarkdown()，但未增广 @tiptap/core 的 Storage 类型 → 局部取值。
  const getMd = (ed: Editor): string => {
    const store = ed.storage as unknown as Record<string, { getMarkdown?: () => string } | undefined>;
    return store.markdown?.getMarkdown?.() ?? '';
  };

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    immediatelyRender: false,
    editorProps: { attributes: { class: 'tiptap ProseMirror' } },
    onUpdate: ({ editor: ed }) => onChange(getMd(ed)),
  });

  // 外部 value 变化（切换 SKILL.md）→ 覆盖编辑器；仅当与当前序列化 markdown 不同才 setContent，
  // 且 emitUpdate:false 防回环（否则 setContent 触发 onUpdate → onChange → 误置 dirty）。
  useEffect(() => {
    if (!editor) return;
    if (value !== getMd(editor)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  return <EditorContent editor={editor} />;
}
