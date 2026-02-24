/**
 * SkillsPanel — Three-column skill editor (skill list | file tree | editor)
 * Full-page overlay for browsing and editing skills.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useSkills } from '@/renderer/hooks/useSkills';
import { SkillList } from './SkillList';
import { SkillFileTree } from './SkillFileTree';
import { MarkdownWysiwyg } from '@/renderer/components/markdown/MarkdownWysiwyg';
import { UnsavedPromptDialog } from '@/renderer/components/file/UnsavedPromptDialog';
import { mapExtToFileType, toLocalFileUrl } from '@/renderer/utils/file-tree';
import './SkillsPanel.css';

interface SkillsPanelProps {
  terminals?: Array<{ id: string; cwd: string }>;
}

export function SkillsPanel({ terminals }: SkillsPanelProps): JSX.Element {
  const projectPaths = useMemo(() => {
    if (!terminals?.length) return undefined;
    return [...new Set(terminals.map((t) => t.cwd).filter(Boolean))];
  }, [terminals]);
  const { skills, loading } = useSkills(projectPaths);
  const { dispatch } = usePanelContext();

  const [selectedSkillPath, setSelectedSkillPath] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [fileType, setFileType] = useState<'markdown' | 'code' | 'text' | 'image'>('text');
  const [sourceMode, setSourceMode] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [middleWidth, setMiddleWidth] = useState(280);
  const pendingAction = useRef<(() => void) | null>(null);
  const prevSkillPathRef = useRef<string | null>(null);

  // ── File loading ──

  const loadFile = useCallback(async (filePath: string) => {
    const ext = filePath.split('.').pop() || '';
    const type = mapExtToFileType(ext);
    setFileType(type);
    setSelectedFilePath(filePath);

    if (type === 'image') {
      setFileContent(toLocalFileUrl(filePath));
      setEditContent('');
    } else {
      const result = await window.api.fs.readFile(filePath);
      if (result?.success && result.data) {
        setFileContent(result.data.content);
        setEditContent(result.data.content);
      }
    }
    setIsDirty(false);
    setSourceMode(false);
  }, []);

  // ── Handlers ──

  const handleSelectFile = useCallback((filePath: string) => {
    if (isDirty) {
      pendingAction.current = () => loadFile(filePath);
      setShowUnsavedPrompt(true);
      return;
    }
    loadFile(filePath);
  }, [isDirty, loadFile]);

  const handleSelectSkill = useCallback((path: string) => {
    if (isDirty) {
      pendingAction.current = () => {
        setSelectedSkillPath(path);
        setSelectedFilePath(null);
        setEditContent('');
        setIsDirty(false);
      };
      setShowUnsavedPrompt(true);
      return;
    }
    setSelectedSkillPath(path);
    setSelectedFilePath(null);
    setEditContent('');
    setIsDirty(false);
  }, [isDirty]);

  const handleSave = useCallback(async () => {
    if (!isDirty || !selectedFilePath) return;
    const result = await window.api.fs.writeFile(selectedFilePath, editContent);
    if (result?.success) {
      setFileContent(editContent);
      setIsDirty(false);
    }
  }, [isDirty, selectedFilePath, editContent]);

  const handleUnsavedSave = useCallback(async () => {
    await handleSave();
    setShowUnsavedPrompt(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, [handleSave]);

  const handleUnsavedDiscard = useCallback(() => {
    setIsDirty(false);
    setShowUnsavedPrompt(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  const handleUnsavedCancel = useCallback(() => {
    pendingAction.current = null;
    setShowUnsavedPrompt(false);
  }, []);

  // ── Auto-select SKILL.md when skill changes ──

  useEffect(() => {
    if (!selectedSkillPath || selectedSkillPath === prevSkillPathRef.current) return;
    prevSkillPathRef.current = selectedSkillPath;
    const skillMdPath = selectedSkillPath + '/SKILL.md';
    loadFile(skillMdPath);
  }, [selectedSkillPath, loadFile]);

  // ── Keyboard shortcuts ──

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      if (mod && e.key === '/') {
        e.preventDefault();
        if (fileType === 'markdown') {
          setSourceMode((prev) => !prev);
        }
        return;
      }

      if (e.key === 'Escape') {
        if (isDirty) {
          pendingAction.current = () => dispatch({ type: 'CLOSE_SKILLS_PANEL' });
          setShowUnsavedPrompt(true);
        } else {
          dispatch({ type: 'CLOSE_SKILLS_PANEL' });
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, fileType, isDirty, dispatch]);

  // ── Resize handles ──

  const handleResizeStart = (setter: React.Dispatch<React.SetStateAction<number>>) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = setter === setLeftWidth ? leftWidth : middleWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.min(500, Math.max(150, startWidth + delta));
      setter(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Render ──

  return (
    <div className="skills-panel">
      {/* Left: skill list */}
      <div className="skills-panel__left" style={{ width: leftWidth }}>
        <SkillList
          skills={skills}
          loading={loading}
          selectedPath={selectedSkillPath}
          onSelect={handleSelectSkill}
        />
      </div>

      <div
        className="skills-panel__resize-handle"
        onMouseDown={handleResizeStart(setLeftWidth)}
      />

      {/* Middle: file tree */}
      <div className="skills-panel__middle" style={{ width: middleWidth }}>
        <SkillFileTree
          skillPath={selectedSkillPath}
          selectedFilePath={selectedFilePath}
          onSelectFile={handleSelectFile}
        />
      </div>

      <div
        className="skills-panel__resize-handle"
        onMouseDown={handleResizeStart(setMiddleWidth)}
      />

      {/* Right: editor */}
      <div className="skills-panel__right">
        {selectedFilePath ? (
          <>
            <div className="skills-panel__editor-header">
              <span className="skills-panel__editor-filename">
                {selectedFilePath.split('/').pop()}
              </span>
              {isDirty && <span className="skills-panel__editor-dirty" />}
              {fileType === 'markdown' && (
                <button
                  className="skills-panel__editor-mode-btn"
                  onClick={() => setSourceMode(!sourceMode)}
                >
                  {sourceMode ? 'WYSIWYG' : 'Source'}
                </button>
              )}
              <span className="skills-panel__editor-tag">
                {fileType === 'markdown'
                  ? 'MD'
                  : fileType === 'code'
                  ? 'CODE'
                  : fileType === 'image'
                  ? 'IMG'
                  : 'TXT'}
              </span>
            </div>
            <div className="skills-panel__editor-body">
              {fileType === 'image' ? (
                <div className="skills-panel__placeholder">
                  <img
                    src={fileContent}
                    alt={selectedFilePath.split('/').pop()}
                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                  />
                </div>
              ) : fileType === 'markdown' && !sourceMode ? (
                <MarkdownWysiwyg
                  content={editContent}
                  onChange={(md) => {
                    setEditContent(md);
                    setIsDirty(true);
                  }}
                />
              ) : (
                <textarea
                  value={editContent}
                  onChange={(e) => {
                    setEditContent(e.target.value);
                    setIsDirty(true);
                  }}
                  spellCheck={false}
                />
              )}
            </div>
          </>
        ) : (
          <div className="skills-panel__placeholder">
            <span>{selectedSkillPath ? 'Select a file' : 'Select a skill'}</span>
          </div>
        )}
      </div>

      {showUnsavedPrompt && selectedFilePath && (
        <UnsavedPromptDialog
          fileName={selectedFilePath.split('/').pop() || ''}
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
        />
      )}
    </div>
  );
}
