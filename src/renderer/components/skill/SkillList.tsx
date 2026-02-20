/**
 * SkillList — Left column: scrollable list of skills with search-like display.
 */

import React from 'react';
import { useI18n } from '@/renderer/i18n';
import type { SkillItem } from '@/renderer/hooks/useSkills';

interface SkillListProps {
  skills: SkillItem[];
  loading: boolean;
  selectedPath: string | null;
  onSelect: (skillPath: string) => void;
}

export function SkillList({ skills, loading, selectedPath, onSelect }: SkillListProps) {
  const { t } = useI18n();

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
      <div className="skill-list__body">
        {skills.map((skill) => {
          const isActive = skill.path === selectedPath;
          return (
            <div
              key={skill.path}
              className={`skill-list__item${isActive ? ' skill-list__item--active' : ''}`}
              onClick={() => onSelect(skill.path)}
            >
              <span className="skill-list__item-name">{skill.name}</span>
              <span className="skill-list__item-desc">{skill.desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
