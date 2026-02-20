/**
 * SkillFileTree — Middle column: expandable file tree for the selected skill folder.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';
import { type TreeEntry, mapIpcToTree, insertAfter, removeChildren } from '@/renderer/utils/file-tree';
import { FileItem } from '@/renderer/components/file/FileItem';

interface SkillFileTreeProps {
  skillPath: string | null;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string) => void;
}

export function SkillFileTree({ skillPath, selectedFilePath, onSelectFile }: SkillFileTreeProps) {
  const { t } = useI18n();
  const [treeFiles, setTreeFiles] = useState<TreeEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Load root entries when skillPath changes
  useEffect(() => {
    setTreeFiles([]);
    setExpandedFolders(new Set());

    if (!skillPath) return;

    let cancelled = false;
    (async () => {
      const result = await window.api.fs.readDir(skillPath);
      if (cancelled) return;
      if (result.success && result.data) {
        setTreeFiles(mapIpcToTree(result.data, 0));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [skillPath]);

  const handleFolderClick = useCallback(
    async (entry: TreeEntry) => {
      const folderPath = entry.path!;
      const isExpanded = expandedFolders.has(folderPath);

      if (isExpanded) {
        // Collapse: remove children and mark as not expanded
        setTreeFiles((prev) => removeChildren(prev, folderPath, entry.indent));
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          // Remove this folder and any nested expanded folders
          for (const p of prev) {
            if (p === folderPath || p.startsWith(folderPath + '/')) {
              next.delete(p);
            }
          }
          return next;
        });
      } else {
        // Expand: load children and insert after parent
        const result = await window.api.fs.readDir(folderPath);
        if (result.success && result.data) {
          const children = mapIpcToTree(result.data, entry.indent + 1);
          setTreeFiles((prev) => insertAfter(prev, entry, children));
          setExpandedFolders((prev) => new Set(prev).add(folderPath));
        }
      }
    },
    [expandedFolders],
  );

  const handleItemClick = useCallback(
    (entry: TreeEntry) => {
      if (entry.type === 'folder') {
        handleFolderClick(entry);
      } else if (entry.path) {
        onSelectFile(entry.path);
      }
    },
    [handleFolderClick, onSelectFile],
  );

  if (!skillPath) {
    return (
      <div className="skill-file-tree">
        <div className="skill-file-tree__empty">{t('skills.selectSkill')}</div>
      </div>
    );
  }

  const folderName = skillPath.split('/').pop() || skillPath;

  return (
    <div className="skill-file-tree">
      <div className="skill-file-tree__header">
        <span className="skill-file-tree__folder-name">{folderName}</span>
      </div>
      <div className="skill-file-tree__body">
        {treeFiles.length === 0 ? (
          <div className="skill-file-tree__empty">{t('skills.emptyFolder')}</div>
        ) : (
          treeFiles.map((entry) => (
            <FileItem
              key={entry.path || entry.name}
              name={entry.name}
              type={entry.type}
              indent={entry.indent}
              ext={entry.ext}
              isActive={entry.path === selectedFilePath}
              expanded={entry.type === 'folder' ? expandedFolders.has(entry.path!) : undefined}
              onClick={() => handleItemClick(entry)}
            />
          ))
        )}
      </div>
    </div>
  );
}
