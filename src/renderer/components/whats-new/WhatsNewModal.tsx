import { useState, useEffect } from 'react';
import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useI18n } from '@/renderer/i18n';
import type { ReleaseEntry } from '@/shared/utils/changelog-parser';
import './WhatsNewModal.css';

/** Section label translation map */
const SECTION_LABELS: Record<string, Record<string, string>> = {
  Added: { zh: '新增', en: 'Added' },
  Changed: { zh: '变更', en: 'Changed' },
  Fixed: { zh: '修复', en: 'Fixed' },
  Removed: { zh: '移除', en: 'Removed' },
  Deprecated: { zh: '弃用', en: 'Deprecated' },
  Security: { zh: '安全', en: 'Security' },
};

export function WhatsNewModal(): JSX.Element | null {
  const { state, dispatch } = usePanelContext();
  const { locale } = useI18n();
  const [entries, setEntries] = useState<ReleaseEntry[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!state.whatsNewModal.open) return;
    window.api.app.getReleaseNotes(locale).then((data: ReleaseEntry[]) => {
      setEntries(data);
      setExpandedVersions(new Set());
    });
  }, [state.whatsNewModal.open, locale]);

  if (!state.whatsNewModal.open) return null;

  const currentVersion = __APP_VERSION__;
  const currentEntry = entries.find(e => e.version === currentVersion);
  const olderEntries = entries.filter(e => e.version !== currentVersion);

  function toggleVersion(version: string) {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  function close() {
    dispatch({ type: 'CLOSE_WHATS_NEW' });
  }

  function sectionLabel(key: string): string {
    return SECTION_LABELS[key]?.[locale] ?? key;
  }

  function renderSections(sections: Record<string, string[]>) {
    return Object.entries(sections).map(([section, items]) => (
      <div key={section} className="whats-new__section">
        <div className="whats-new__section-title">{sectionLabel(section)}</div>
        <ul className="whats-new__list">
          {items.map((item, i) => (
            <li key={i} className="whats-new__item">{item}</li>
          ))}
        </ul>
      </div>
    ));
  }

  return (
    <div className="whats-new__backdrop" onClick={close}>
      <div className="whats-new__modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="whats-new__header">
          <div className="whats-new__title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {locale === 'zh' ? '更新内容' : "What's New"}
          </div>
          <button className="whats-new__close" onClick={close}>&times;</button>
        </div>

        {/* Body */}
        <div className="whats-new__body">
          {/* Current version */}
          {currentEntry ? (
            <div className="whats-new__current">
              <div className="whats-new__version-badge">
                v{currentEntry.version}
                <span className="whats-new__version-date">{currentEntry.date}</span>
              </div>
              {renderSections(currentEntry.sections)}
            </div>
          ) : (
            <div className="whats-new__empty">
              {locale === 'zh'
                ? `v${currentVersion} 暂无更新说明`
                : `No release notes for v${currentVersion}`}
            </div>
          )}

          {/* Older versions */}
          {olderEntries.length > 0 && (
            <div className="whats-new__older">
              <div className="whats-new__older-title">
                {locale === 'zh' ? '历史版本' : 'Previous Versions'}
              </div>
              {olderEntries.map(entry => (
                <div key={entry.version} className="whats-new__older-entry">
                  <button
                    className="whats-new__older-toggle"
                    onClick={() => toggleVersion(entry.version)}
                  >
                    <span className={`whats-new__chevron${expandedVersions.has(entry.version) ? ' whats-new__chevron--open' : ''}`}>
                      &#9656;
                    </span>
                    v{entry.version}
                    <span className="whats-new__version-date">{entry.date}</span>
                  </button>
                  {expandedVersions.has(entry.version) && (
                    <div className="whats-new__older-content">
                      {renderSections(entry.sections)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="whats-new__footer">
          <button className="whats-new__dismiss" onClick={close}>
            {locale === 'zh' ? '知道了' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
