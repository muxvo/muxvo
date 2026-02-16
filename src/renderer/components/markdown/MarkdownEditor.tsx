/**
 * MarkdownEditor Component
 * G3: 编辑模式组件
 *
 * 显示原始 Markdown 文本的可编辑 textarea
 * 支持 Cmd+S 保存快捷键
 */

import React, { useEffect } from 'react';
import './MarkdownEditor.css';

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSave: () => void;
}

export function MarkdownEditor({ content, onChange, onSave }: MarkdownEditorProps) {
  // Cmd+S / Ctrl+S 保存快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave]);

  return (
    <textarea
      className="markdown-editor"
      value={content}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
    />
  );
}
