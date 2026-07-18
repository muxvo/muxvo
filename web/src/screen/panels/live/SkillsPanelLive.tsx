/**
 * Skills 面板 live 包装（skills-panel.md）：golden SkillsPanelScreen 纯 props 复用（列表+文件树+
 * 编辑器骨架），右栏编辑器由 MarkdownWysiwygLive 经 portal 覆盖 golden 静态 editor-body 承接实编辑。
 *
 * 交互：委托点击选中 skill → readResource 自动加载 SKILL.md + listResourceDir 加载文件树；
 * wysiwyg/source 由 MarkdownWysiwygLive（⌘/）；dirty 红点；⌘S writeResource；
 * Esc/切换 skill 的 dirty 守卫 + UnsavedPromptLive（LiveChrome 层 Esc 路由归 A2，此为自守兜底）。
 * 订阅 configResourcesChanged 重拉列表。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useConfigApi } from '../../../config/ConfigContext';
import { registerLivePanel, type LivePanelProps } from '../../live/panelRegistry';
import { track } from '../../../bridge/track';
import { SkillsPanelScreen } from '../SkillsPanelScreen';
import { MarkdownWysiwygLive, type MarkdownEditorMode } from '../../../markdown/MarkdownWysiwygLive';
import { resourceItemsToSkills, type FixtureSkillItem } from './mappers';
import { UnsavedPromptLive } from './UnsavedPromptLive';
import { useConfigData } from './shared';
import type { ConfigDirEntry } from '../../../bridge/gen/protocol';
import './panels-live.css';

export function SkillsPanelLive({ onClose }: LivePanelProps): JSX.Element {
  // analytics.md L4：Skills 面板挂载恰一次（ref 门防 dev StrictMode 双挂载重发）。
  const openTrackedRef = useRef(false);
  useEffect(() => {
    if (openTrackedRef.current) return;
    openTrackedRef.current = true;
    track('skills.opened');
  }, []);
  const api = useConfigApi();
  const [{ items }] = useConfigData<{ items: FixtureSkillItem[] }>(
    api,
    async (a) => {
      const r = await a.request({ kind: 'listResources', types: ['skills'] });
      return { items: r.kind === 'resources' ? resourceItemsToSkills(r.items) : [] };
    },
    { items: [] },
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [baseContent, setBaseContent] = useState('');
  const [dirtyValue, setDirtyValue] = useState<string | null>(null);
  const [mode, setMode] = useState<MarkdownEditorMode>('wysiwyg');
  const [dirs, setDirs] = useState<ConfigDirEntry[]>([]);
  const [pendingNext, setPendingNext] = useState<string | null | undefined>(undefined); // undefined=无守卫

  const dirty = dirtyValue !== null && dirtyValue !== baseContent;
  const editContent = dirtyValue !== null ? dirtyValue : baseContent;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [editorHost, setEditorHost] = useState<HTMLElement | null>(null);

  const loadSkill = useCallback(
    (path: string): void => {
      setSelected(path);
      setDirtyValue(null);
      setMode('wysiwyg');
      if (!api) return;
      void api
        .request({ kind: 'readResource', path: `${path}/SKILL.md` })
        .then((r) => setBaseContent(r.kind === 'resourceContent' ? r.content : ''))
        .catch(() => setBaseContent(''));
      void api
        .request({ kind: 'listResourceDir', path })
        .then((r) => setDirs(r.kind === 'dirEntries' ? r.entries : []))
        .catch(() => setDirs([]));
    },
    [api],
  );

  const requestSelect = useCallback(
    (path: string): void => {
      if (path === selected) return;
      if (dirty) setPendingNext(path); // dirty 守卫：先弹确认
      else loadSkill(path);
    },
    [selected, dirty, loadSkill],
  );

  const save = useCallback((): void => {
    if (!api || !selected || dirtyValue === null) return;
    const content = dirtyValue;
    void api
      .request({ kind: 'writeResource', path: `${selected}/SKILL.md`, content })
      .then((r) => {
        if (r.kind === 'saved') {
          setBaseContent(content);
          setDirtyValue(null);
        }
      })
      .catch(() => {});
  }, [api, selected, dirtyValue]);

  // ⌘S 保存 / Esc dirty 守卫（capture 相 + preventDefault：LiveChrome bubble 监听 `!defaultPrevented`
  // 才关面板，故 dirty 时先弹确认、拦住关闭；非 dirty 不拦 → Esc 冒泡到 LiveChrome 关面板，CONFIG_L1_15）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape' && dirty && pendingNext === undefined) {
        e.preventDefault();
        e.stopPropagation();
        setPendingNext(null); // null = 守卫但无后续切换（纯关闭意图）
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [save, dirty, pendingNext]);

  // 定位 golden 静态右栏 editor-body 作为 live 编辑器 portal 宿主。
  useLayoutEffect(() => {
    const host = wrapRef.current?.querySelector('.skills-panel__editor-body') as HTMLElement | null;
    setEditorHost(host ?? null);
  });

  const onClick = useCallback(
    (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest('.skills-panel__editor-mode-btn')) {
        setMode((m) => (m === 'wysiwyg' ? 'source' : 'wysiwyg'));
        return;
      }
      const item = target.closest('.skill-list__item');
      if (item) {
        const name = item.querySelector('.skill-list__item-name')?.textContent ?? '';
        const skill = items.find((s) => s.name === name);
        if (skill) requestSelect(skill.path);
      }
    },
    [items, requestSelect],
  );

  const selectedName = items.find((s) => s.path === selected)?.name ?? 'SKILL.md';
  const filesKey = selected ? `${selected}/SKILL.md` : '';

  return (
    <div className="skills-panel-live" ref={wrapRef} onClick={onClick}>
      <SkillsPanelScreen
        fx={{
          screen: 'skills-panel',
          theme: 'dark',
          skills: {
            items,
            selected,
            sourceMode: mode === 'source',
            dirty,
            dirtyValue: dirty ? editContent : undefined,
          },
          files: filesKey ? { [filesKey]: baseContent } : {},
          dirs: selected ? { [selected]: dirs } : {},
        }}
      />
      {selected &&
        editorHost &&
        createPortal(
          <div className="markdown-live-cover">
            <MarkdownWysiwygLive value={editContent} onChange={setDirtyValue} mode={mode} onModeChange={setMode} />
          </div>,
          editorHost,
        )}
      {pendingNext !== undefined && (
        <UnsavedPromptLive
          name={selectedName}
          onSave={() => {
            save();
            const n = pendingNext;
            setPendingNext(undefined);
            if (n) loadSkill(n);
            else onClose(); // null = 关闭意图（Esc）→ 保存后关面板
          }}
          onDiscard={() => {
            const n = pendingNext;
            setDirtyValue(null);
            setPendingNext(undefined);
            if (n) loadSkill(n);
            else onClose();
          }}
          onCancel={() => setPendingNext(undefined)}
        />
      )}
    </div>
  );
}

registerLivePanel('skills', SkillsPanelLive);
