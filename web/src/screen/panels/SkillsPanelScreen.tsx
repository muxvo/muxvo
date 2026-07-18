/**
 * Skills 三栏面板屏（specs/behavior/skills-panel.md）。纯 props 吃 fixture，永不 mock IPC。
 * 右栏 wysiwyg 为 legacy tiptap 渲染产物的静态复刻（DOM 形状照 golden 页 dump：
 * .markdown-wysiwyg > div > .tiptap.ProseMirror > h1/p/ul>li>p/pre>code/blockquote>p），
 * 由内置极简 markdown→JSX 渲染器从 fixture 文件内容生成（仅覆盖 fixture 用到的子集）。
 * CONFIG_L1_16：空态文案以 legacy 实渲染为准（'暂无技能' + 路径 hint，SkillList.tsx:108-111）。
 */

import { renderMarkdown } from '../md-static';
import './panels.css';

interface SkillItem {
  name: string;
  path: string;
  source?: string;
  level?: 'system' | 'project';
  desc?: string;
}

interface SkillsPayload {
  items: SkillItem[];
  selected: string | null;
  sourceMode?: boolean;
  dirty?: boolean;
  dirtyValue?: string;
  /** dom-assert 面（搜索无命中）；golden fixture 不用 */
  searchQuery?: string;
}

// ── 分组（legacy SkillList.tsx groupSkills 同构：项目级按项目名，其余并入系统组） ──

interface SkillGroup {
  key: string;
  label: string;
  skills: SkillItem[];
}

/** legacy useSkills.ts extractProjectName 同构 */
function extractProjectName(skillPath: string): string {
  const dotMatch = skillPath.match(/\/([^/]+)\/\.(?:claude|codex)\/skills\//);
  if (dotMatch) return dotMatch[1];
  const bareMatch = skillPath.match(/\/([^/]+)\/skills\//);
  if (bareMatch) return bareMatch[1];
  return '';
}

function groupSkills(skills: SkillItem[]): SkillGroup[] {
  const systemSkills: SkillItem[] = [];
  const projectMap = new Map<string, SkillItem[]>();
  for (const skill of skills) {
    const projectName = skill.level === 'project' ? extractProjectName(skill.path) : '';
    if (projectName) {
      const list = projectMap.get(projectName) ?? [];
      list.push(skill);
      projectMap.set(projectName, list);
    } else {
      systemSkills.push(skill);
    }
  }
  const groups: SkillGroup[] = [];
  if (systemSkills.length > 0) groups.push({ key: '__system__', label: '系统 Skills', skills: systemSkills });
  for (const [projectName, projectSkills] of projectMap) {
    groups.push({ key: projectName, label: projectName, skills: projectSkills });
  }
  return groups;
}

function SourceBadges({ source }: { source?: string }): JSX.Element | null {
  if (!source) return null;
  if (source === 'shared') {
    return (
      <>
        <span className="source-badge source-badge--cx">CX</span>
        <span className="source-badge source-badge--gm">GM</span>
      </>
    );
  }
  const kind = source === 'codex' ? 'cx' : source === 'gemini' ? 'gm' : 'cc';
  return <span className={`source-badge source-badge--${kind}`}>{kind.toUpperCase()}</span>;
}

// ── markdown→JSX 静态渲染器移至 ../md-static.tsx（B4 file-temp-view 共用） ──

// ── 文件树行（legacy FileItem.tsx 静态形状；fixture dirs 序 = legacy 排序后显示序） ──

function fileIcon(isDirectory: boolean, name: string): string {
  if (isDirectory) return '\u{1F4C1}';
  const ext = name.includes('.') ? name.split('.').pop() : undefined;
  if (ext === 'md') return '\u{1F4DD}';
  if (ext === 'json') return '⚙️';
  return '\u{1F4C4}';
}

export function SkillsPanelScreen({ fx }: { fx: any }): JSX.Element {
  const sk: SkillsPayload = fx.skills ?? { items: [], selected: null };
  const files: Record<string, string> = fx.files ?? {};
  const dirs: Record<string, { name: string; isDirectory: boolean }[]> = fx.dirs ?? {};

  const query = sk.searchQuery ?? '';
  const filtered = query.trim()
    ? sk.items.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          (s.desc ?? '').toLowerCase().includes(query.toLowerCase()),
      )
    : sk.items;
  const groups = groupSkills(filtered);

  const selected = sk.items.find((i) => i.path === sk.selected) ?? null;
  const selectedFilePath = selected ? `${selected.path}/SKILL.md` : null;
  const fileContent = selectedFilePath ? (files[selectedFilePath] ?? '') : '';
  const editContent = sk.dirty && sk.dirtyValue != null ? sk.dirtyValue : fileContent;
  const treeEntries = selected ? (dirs[selected.path] ?? []) : [];

  return (
    <div className="skills-panel-overlay">
      <div className="skills-panel">
        {/* 左：技能列表 */}
        <div className="skills-panel__left" style={{ width: 240 }}>
          <div className="skill-list">
            <div className="skill-list__header">
              <span className="skill-list__title">Skills</span>
              <span className="skill-list__count">{sk.items.length}</span>
            </div>

            {sk.items.length === 0 ? (
              <div className="skill-list__body">
                <div className="skill-list__empty">
                  <p>暂无技能</p>
                  <p className="skill-list__empty-hint">~/.claude/skills/</p>
                  <p className="skill-list__empty-hint">&lt;project&gt;/.claude/skills/</p>
                </div>
              </div>
            ) : (
              <>
                <div className="search-input-wrap">
                  <input
                    type="text"
                    className="search-input-wrap__input"
                    placeholder="Search skills..."
                    value={query}
                    readOnly
                  />
                </div>

                <div className="skill-list__body">
                  {groups.length === 0 && query && (
                    <div className="skill-list__empty">
                      <p>No matching skills</p>
                    </div>
                  )}

                  {groups.map((group) => (
                    <div key={group.key} className="skill-list__group">
                      <div className="skill-list__group-header">
                        <span className="skill-list__group-arrow skill-list__group-arrow--open">
                          {'▶'}
                        </span>
                        <span className="skill-list__group-label">{group.label}</span>
                        <span className="skill-list__group-count">{group.skills.length}</span>
                      </div>
                      <div className="skill-list__group-items">
                        {group.skills.map((skill) => (
                          <div
                            key={skill.path}
                            className={`skill-list__item${skill.path === sk.selected ? ' skill-list__item--active' : ''}`}
                          >
                            <div className="skill-list__item-header">
                              <span className="skill-list__item-name">{skill.name}</span>
                              <SourceBadges source={skill.source} />
                            </div>
                            <span className="skill-list__item-desc">{skill.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="skills-panel__resize-handle" />

        {/* 中：文件树（仅选中 skill 后渲染） */}
        {selected && (
          <>
            <div className="skills-panel__middle" style={{ width: 280 }}>
              <div className="skill-file-tree">
                <div className="skill-file-tree__header">
                  <span className="skill-file-tree__folder-name">
                    {selected.path.split('/').pop()}
                  </span>
                </div>
                <div className="skill-file-tree__body">
                  {treeEntries.map((entry) => {
                    const entryPath = `${selected.path}/${entry.name}`;
                    const cls = [
                      'file-item',
                      entry.isDirectory ? 'file-item--folder' : '',
                      entryPath === selectedFilePath ? 'file-item--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div key={entry.name} className={cls} style={{ paddingLeft: 8 }}>
                        <span className="file-item__icon">{fileIcon(entry.isDirectory, entry.name)}</span>
                        <span className="file-item__name">{entry.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="skills-panel__resize-handle" />
          </>
        )}

        {/* 右：编辑/查看 */}
        <div className="skills-panel__right">
          {selectedFilePath ? (
            <>
              <div className="skills-panel__editor-header">
                <span className="skills-panel__editor-filename">
                  {selectedFilePath.split('/').pop()}
                </span>
                {sk.dirty && <span className="skills-panel__editor-dirty" />}
                <button className="skills-panel__editor-mode-btn">
                  {sk.sourceMode ? 'WYSIWYG' : 'Source'}
                </button>
                <span className="skills-panel__editor-tag">MD</span>
              </div>
              <div className="skills-panel__editor-body">
                {sk.sourceMode ? (
                  <textarea value={editContent} readOnly spellCheck={false} />
                ) : (
                  <div className="markdown-wysiwyg">
                    <div>
                      <div className="tiptap ProseMirror">{renderMarkdown(editContent)}</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="skills-panel__placeholder">
              <span>选择左侧技能查看详情</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
