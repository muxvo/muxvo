/**
 * MarkdownViewer Component
 * G3: 预览/编辑模式容器
 *
 * 管理 Markdown 文件的预览和编辑模式切换
 * - Cmd+/ 切换模式
 * - Cmd+S 保存文件
 * - 未保存修改时切换模式会弹出确认对话框
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createMarkdownModeMachine } from '@/shared/machines/markdown-mode';
import { MarkdownPreview } from './MarkdownPreview';
import { MarkdownEditor } from './MarkdownEditor';
import './MarkdownViewer.css';

interface MarkdownViewerProps {
  content: string;
  filePath?: string;
  onSave?: (content: string) => void;
}

export function MarkdownViewer({ content, filePath, onSave }: MarkdownViewerProps) {
  const machineRef = useRef(createMarkdownModeMachine(content));
  const [modeState, setModeState] = useState(machineRef.current.state);
  const [modeContext, setModeContext] = useState(machineRef.current.context);

  function sendMode(event: string | { type: string; content?: string }) {
    machineRef.current.send(event);
    setModeState(machineRef.current.state);
    setModeContext(machineRef.current.context);
  }

  // Cmd+/ / Ctrl+/ 切换模式
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        sendMode('TOGGLE_MODE');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleContentChange = useCallback((newContent: string) => {
    sendMode({ type: 'CONTENT_CHANGE', content: newContent });
  }, []);

  const handleSave = useCallback(() => {
    sendMode('SAVE');
    onSave?.(modeContext.editContent);
  }, [modeContext.editContent, onSave]);

  const handleConfirmDiscard = () => sendMode('CONFIRM_DISCARD');
  const handleCancelDiscard = () => sendMode('CANCEL_DISCARD');
  const handleSaveAndSwitch = () => {
    handleSave();
    sendMode('SAVE');
  };

  return (
    <div className="markdown-viewer">
      {/* 模式指示器工具栏 */}
      <div className="markdown-viewer-toolbar">
        <button
          className="markdown-viewer-mode-btn"
          onClick={() => sendMode('TOGGLE_MODE')}
        >
          {modeState === 'Preview' ? '预览' : '编辑'}
          {modeContext.isDirty && ' ●'}
        </button>
        {filePath && <span className="markdown-viewer-path">{filePath}</span>}
      </div>

      {/* 内容区域 */}
      {modeState === 'Preview' ? (
        <MarkdownPreview content={content} />
      ) : modeState === 'Edit' ? (
        <MarkdownEditor
          content={modeContext.editContent}
          onChange={handleContentChange}
          onSave={handleSave}
        />
      ) : null}

      {/* 未保存修改确认对话框 */}
      {modeState === 'UnsavedPrompt' && (
        <div className="markdown-unsaved-overlay">
          <div className="markdown-unsaved-dialog">
            <p>文件有未保存的修改</p>
            <div className="markdown-unsaved-actions">
              <button onClick={handleSaveAndSwitch}>保存</button>
              <button onClick={handleConfirmDiscard}>放弃</button>
              <button onClick={handleCancelDiscard}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
