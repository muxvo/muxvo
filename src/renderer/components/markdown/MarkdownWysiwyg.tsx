/**
 * MarkdownWysiwyg — Typora-style WYSIWYG markdown editor
 *
 * Uses TipTap (ProseMirror) with markdown extension.
 * Outputs plain markdown text via onChange callback.
 */

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import './MarkdownWysiwyg.css';

interface MarkdownWysiwygProps {
  content: string;
  onChange: (md: string) => void;
}

export function MarkdownWysiwyg({ content, onChange }: MarkdownWysiwygProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content,
    contentType: 'markdown',
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getMarkdown());
    },
  });

  // Sync external content changes (file switch)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      const cur = editor.getMarkdown();
      if (cur !== content) {
        editor.commands.setContent(content, { contentType: 'markdown' });
      }
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="markdown-wysiwyg">
      <EditorContent editor={editor} />
    </div>
  );
}
