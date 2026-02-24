/**
 * D5: ProjectList — 左栏项目列表
 *
 * 功能:
 * - "全部项目" 选项（默认选中）
 * - 项目列表，每项: 彩色圆点 + 项目名 + 文件总大小
 * - 圆点颜色: 按项目名 hash 生成固定颜色
 */

import React from 'react';
import type { ProjectInfo } from '@/shared/types/chat.types';
import { useI18n } from '@/renderer/i18n';
import './ProjectList.css';

interface ProjectListProps {
  projects: ProjectInfo[];
  selectedProjectHash: string | null;
  onSelectProject: (projectHash: string | null) => void;
  totalSessionCount: number;
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '')}GB`;
}

export function ProjectList({ projects, selectedProjectHash, onSelectProject }: ProjectListProps) {
  const { t } = useI18n();

  const totalSize = projects.reduce((sum, p) => sum + (p.totalSize || 0), 0);

  return (
    <div className="project-list">
      <div className="project-list__header">{t('chat.projects')}</div>

      <div
        className={`project-list__item ${selectedProjectHash === null ? 'project-list__item--selected' : ''}`}
        onClick={() => onSelectProject(null)}
      >
        <span className="project-list__dot" style={{ background: 'var(--accent)' }} />
        <span className="project-list__name">{t('chat.allProjects')}</span>
        <span className="project-list__count">{formatSize(totalSize)}</span>
      </div>

      {projects.map((project) => (
        <div
          key={project.projectHash}
          className={`project-list__item ${selectedProjectHash === project.projectHash ? 'project-list__item--selected' : ''}`}
          onClick={() => onSelectProject(project.projectHash)}
        >
          <span className="project-list__dot" style={{ background: hashColor(project.projectHash) }} />
          <span className="project-list__name" title={project.displayPath}>
            {project.displayName}
          </span>
          <span className="project-list__count">{formatSize(project.totalSize || 0)}</span>
        </div>
      ))}
    </div>
  );
}
