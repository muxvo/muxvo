/**
 * D5: ProjectList — 左栏项目列表
 *
 * 功能:
 * - "全部项目" 选项（默认选中）
 * - 项目列表，每项: 彩色圆点 + 项目名 + 会话数
 * - 圆点颜色: 按项目名 hash 生成固定颜色
 */

import React from 'react';
import type { ProjectInfo } from '@/shared/types/chat.types';
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

export function ProjectList({ projects, selectedProjectHash, onSelectProject, totalSessionCount }: ProjectListProps) {
  return (
    <div className="project-list">
      <div className="project-list__header">项目</div>

      <div
        className={`project-list__item ${selectedProjectHash === null ? 'project-list__item--selected' : ''}`}
        onClick={() => onSelectProject(null)}
      >
        <span className="project-list__dot" style={{ background: 'var(--accent)' }} />
        <span className="project-list__name">全部项目</span>
        <span className="project-list__count">{totalSessionCount}</span>
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
          <span className="project-list__count">{project.sessionCount}</span>
        </div>
      ))}
    </div>
  );
}
