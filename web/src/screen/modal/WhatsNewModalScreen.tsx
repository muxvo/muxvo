/**
 * What's New 弹窗屏（specs/behavior/whats-new-modal.md）：460px 居中 modal，
 * current 版本满载 + 历史版本展开/折叠（expanded 列表驱动）。纯 props 吃 fixture
 * （whatsNew payload），永不 mock IPC。
 */

import '../../styles/surfaces.css';
import './modals.css';

interface ReleaseEntry {
  version: string;
  date: string;
  sections: Record<string, string[]>;
}

/** section 标签映射（legacy WhatsNewModal.tsx:8-15 同款；未知 key 原样显示） */
const SECTION_LABELS: Record<string, Record<string, string>> = {
  Added: { zh: '新增', en: 'Added' },
  Changed: { zh: '变更', en: 'Changed' },
  Fixed: { zh: '修复', en: 'Fixed' },
  Removed: { zh: '移除', en: 'Removed' },
  Deprecated: { zh: '弃用', en: 'Deprecated' },
  Security: { zh: '安全', en: 'Security' },
};

export function WhatsNewModalScreen({ fx }: { fx: any }): JSX.Element {
  const locale: 'zh' | 'en' = fx.locale ?? 'zh';
  const appVersion: string = fx.whatsNew?.appVersion ?? '';
  const entries: ReleaseEntry[] = fx.whatsNew?.entries ?? [];
  const expanded = new Set<string>(fx.whatsNew?.expanded ?? []);

  const currentEntry = entries.find((e) => e.version === appVersion);
  const olderEntries = entries.filter((e) => e.version !== appVersion);

  const sectionLabel = (key: string): string => SECTION_LABELS[key]?.[locale] ?? key;

  const renderSections = (sections: Record<string, string[]>): JSX.Element[] =>
    Object.entries(sections).map(([section, items]) => (
      <div key={section} className="whats-new__section">
        <div className="whats-new__section-title">{sectionLabel(section)}</div>
        <ul className="whats-new__list">
          {items.map((item, i) => (
            <li key={i} className="whats-new__item">
              {item}
            </li>
          ))}
        </ul>
      </div>
    ));

  return (
    <div className="whats-new__backdrop">
      <div className="whats-new__modal">
        <div className="whats-new__header">
          <div className="whats-new__title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {locale === 'zh' ? '更新内容' : "What's New"}
          </div>
          <button className="whats-new__close">{'×'}</button>
        </div>

        <div className="whats-new__body">
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
                ? `v${appVersion} 暂无更新说明`
                : `No release notes for v${appVersion}`}
            </div>
          )}

          {olderEntries.length > 0 && (
            <div className="whats-new__older">
              <div className="whats-new__older-title">
                {locale === 'zh' ? '历史版本' : 'Previous Versions'}
              </div>
              {olderEntries.map((entry) => (
                <div key={entry.version} className="whats-new__older-entry">
                  <button className="whats-new__older-toggle">
                    <span
                      className={`whats-new__chevron${expanded.has(entry.version) ? ' whats-new__chevron--open' : ''}`}
                    >
                      {'▸'}
                    </span>
                    v{entry.version}
                    <span className="whats-new__version-date">{entry.date}</span>
                  </button>
                  {expanded.has(entry.version) && (
                    <div className="whats-new__older-content">{renderSections(entry.sections)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="whats-new__footer">
          <button className="whats-new__dismiss">{locale === 'zh' ? '知道了' : 'Got it'}</button>
        </div>
      </div>
    </div>
  );
}
