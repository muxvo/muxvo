/**
 * D5: ProjectList — 左栏项目列表
 *
 * 功能:
 * - "全部项目" 选项（默认选中）
 * - 项目列表，每项: 彩色圆点 + 项目名 + 会话数
 * - 圆点颜色: 按项目名 hash 生成固定颜色
 */

import React, { useState, useEffect } from 'react';
import type { HistoryEntry } from '@/shared/types/chat.types';
import './ProjectList.css';

interface ProjectListProps {
  onSelectProject: (projectPath: string | null) => void;
  selectedProject: string | null;
}

interface ProjectSummary {
  path: string;
  name: string;
  sessionCount: number;
  color: string;
}

/**
 * Generate a fixed color for a project based on its name hash
 */
function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export function ProjectList({ onSelectProject, selectedProject }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const result = await window.api.chat.getHistory();
        const sessions: HistoryEntry[] = result?.sessions || [];

        // Group by project
        const projectMap = new Map<string, Set<string>>();

        sessions.forEach((session) => {
          if (!projectMap.has(session.project)) {
            projectMap.set(session.project, new Set());
          }
          projectMap.get(session.project)!.add(session.sessionId);
        });

        // Convert to array
        const projectList: ProjectSummary[] = Array.from(projectMap.entries()).map(
          ([projectPath, sessionIds]) => {
            const basename = projectPath.split('/').pop() || projectPath;
            return {
              path: projectPath,
              name: basename,
              sessionCount: sessionIds.size,
              color: hashColor(projectPath),
            };
          }
        );

        // Sort by name
        projectList.sort((a, b) => a.name.localeCompare(b.name));

        setProjects(projectList);
        setTotalCount(sessions.length);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
        setProjects([]);
        setTotalCount(0);
      }
    };

    fetchProjects();
  }, []);

  return (
    <div className="project-list">
      <div className="project-list__header">项目</div>

      <div
        className={`project-list__item ${selectedProject === null ? 'project-list__item--selected' : ''}`}
        onClick={() => onSelectProject(null)}
      >
        <span className="project-list__dot" style={{ background: 'var(--accent)' }} />
        <span className="project-list__name">全部项目</span>
        <span className="project-list__count">{totalCount}</span>
      </div>

      {projects.map((project) => (
        <div
          key={project.path}
          className={`project-list__item ${selectedProject === project.path ? 'project-list__item--selected' : ''}`}
          onClick={() => onSelectProject(project.path)}
        >
          <span className="project-list__dot" style={{ background: project.color }} />
          <span className="project-list__name" title={project.path}>
            {project.name}
          </span>
          <span className="project-list__count">{project.sessionCount}</span>
        </div>
      ))}
    </div>
  );
}
