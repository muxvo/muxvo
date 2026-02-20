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
  const initializedRef = useRef(false);
  const isInternalRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content,
    contentType: 'markdown',
    onCreate: () => {
      requestAnimationFrame(() => { initializedRef.current = true; });
    },
    onUpdate: ({ editor }) => {
      if (!initializedRef.current) return;
      isInternalRef.current = true;
      onChangeRef.current(editor.getMarkdown());
    },
  });

  // Sync external content changes only (file switch), skip internal edits
  useEffect(() => {
    if (isInternalRef.current) {
      isInternalRef.current = false;
      return;
    }
    if (editor && !editor.isDestroyed) {
      initializedRef.current = false;
      editor.commands.setContent(content, { contentType: 'markdown' });
      requestAnimationFrame(() => { initializedRef.current = true; });
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="markdown-wysiwyg">
      <EditorContent editor={editor} />
    </div>
  );
}
