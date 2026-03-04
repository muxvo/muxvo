/**
 * MarkdownWysiwyg — Typora-style WYSIWYG markdown editor
 *
 * Uses TipTap (ProseMirror) with markdown extension.
 * Outputs plain markdown text via onChange callback.
 * Renders Mermaid code blocks as SVG diagrams.
 */

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Markdown } from '@tiptap/markdown';
import { renderMermaid } from '@/renderer/utils/mermaid-init';
import './MarkdownWysiwyg.css';

/**
 * Custom CodeBlock extension that renders mermaid diagrams as SVG.
 * Non-mermaid code blocks use the default rendering.
 */
const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node }) => {
      if (node.attrs.language !== 'mermaid') {
        // Non-mermaid: default rendering with editable contentDOM
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        if (node.attrs.language) {
          code.className = `language-${node.attrs.language}`;
        }
        pre.appendChild(code);
        return { dom: pre, contentDOM: code };
      }

      // Mermaid: render as SVG diagram
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-block';

      const doRender = (text: string) => {
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
        renderMermaid(id, text).then((svg) => {
          if (svg) {
            wrapper.innerHTML = svg;
          } else {
            // Render error: show source as fallback
            wrapper.textContent = text;
            wrapper.classList.add('mermaid-block--error');
          }
        });
      };

      doRender(node.textContent);

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== 'codeBlock' || updatedNode.attrs.language !== 'mermaid') {
            return false;
          }
          doRender(updatedNode.textContent);
          return true;
        },
      };
    };
  },
});

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
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      MermaidCodeBlock,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      Markdown,
    ],
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
