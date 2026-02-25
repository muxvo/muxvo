/**
 * SkillList — Left column: collapsible grouped list of skills with search.
 * Groups: "系统 Skills" + one group per project directory.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useI18n } from '@/renderer/i18n';
import type { SkillItem } from '@/renderer/hooks/useSkills';

interface SkillListProps {
  skills: SkillItem[];
  loading: boolean;
  selectedPath: string | null;
  onSelect: (skillPath: string) => void;
}

interface SkillGroup {
  key: string;
  label: string;
  skills: SkillItem[];
}

function groupSkills(skills: SkillItem[]): SkillGroup[] {
  const systemSkills: SkillItem[] = [];
  const projectMap = new Map<string, SkillItem[]>();

  for (const skill of skills) {
    if (skill.level === 'project' && skill.projectName) {
      const list = projectMap.get(skill.projectName) || [];
      list.push(skill);
      projectMap.set(skill.projectName, list);
    } else {
      systemSkills.push(skill);
    }
  }

  const groups: SkillGroup[] = [];

  if (systemSkills.length > 0) {
    groups.push({ key: '__system__', label: '系统 Skills', skills: systemSkills });
  }

  for (const [projectName, projectSkills] of projectMap) {
    groups.push({ key: projectName, label: projectName, skills: projectSkills });
  }

  return groups;
}

export function SkillList({ skills, loading, selectedPath, onSelect }: SkillListProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q),
    );
  }, [skills, searchQuery]);

  const groups = useMemo(() => groupSkills(filteredSkills), [filteredSkills]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="skill-list">
        <div className="skill-list__header">
          <span className="skill-list__title">{t('skills.title')}</span>
        </div>
        <div className="skill-list__body">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skill-list__skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="skill-list">
        <div className="skill-list__header">
          <span className="skill-list__title">{t('skills.title')}</span>
          <span className="skill-list__count">0</span>
        </div>
        <div className="skill-list__body">
          <div className="skill-list__empty">
            <p>{t('skills.noSkills')}</p>
            <p className="skill-list__empty-hint">~/.claude/skills/</p>
            <p className="skill-list__empty-hint">&lt;project&gt;/.claude/skills/</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="skill-list">
      <div className="skill-list__header">
        <span className="skill-list__title">{t('skills.title')}</span>
        <span className="skill-list__count">{skills.length}</span>
      </div>

      {/* Search */}
      <div className="skill-list__search">
        <input
          type="text"
          className="skill-list__search-input"
          placeholder="Search skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="skill-list__search-clear"
            onClick={() => setSearchQuery('')}
          >
            &times;
          </button>
        )}
      </div>

      <div className="skill-list__body">
        {groups.length === 0 && searchQuery && (
          <div className="skill-list__empty">
            <p>No matching skills</p>
          </div>
        )}

        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          return (
            <div key={group.key} className="skill-list__group">
              <div
                className="skill-list__group-header"
                onClick={() => toggleGroup(group.key)}
              >
                <span className={`skill-list__group-arrow${isCollapsed ? '' : ' skill-list__group-arrow--open'}`}>
                  &#9654;
                </span>
                <span className="skill-list__group-label">{group.label}</span>
                <span className="skill-list__group-count">{group.skills.length}</span>
              </div>

              {!isCollapsed && (
                <div className="skill-list__group-items">
                  {group.skills.map((skill) => {
                    const isActive = skill.path === selectedPath;
                    return (
                      <div
                        key={skill.path}
                        className={`skill-list__item${isActive ? ' skill-list__item--active' : ''}`}
                        onClick={() => onSelect(skill.path)}
                      >
                        <div className="skill-list__item-header">
                          <span className="skill-list__item-name">{skill.name}</span>
                          {skill.source && skill.source !== 'shared' && (
                            <span className={`skill-list__source-badge skill-list__source-badge--${skill.source === 'codex' ? 'cx' : skill.source === 'gemini' ? 'gm' : 'cc'}`}>
                              {skill.source === 'codex' ? 'CX' : skill.source === 'gemini' ? 'GM' : 'CC'}
                            </span>
                          )}
                          {skill.source === 'shared' && (<>
                            <span className="skill-list__source-badge skill-list__source-badge--cx">CX</span>
                            <span className="skill-list__source-badge skill-list__source-badge--gm">GM</span>
                          </>)}
                        </div>
                        <span className="skill-list__item-desc">{skill.desc}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
