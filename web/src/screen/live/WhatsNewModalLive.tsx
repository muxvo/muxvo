/**
 * What's New live 包装（auto-update.md §7）：不改冻结的 WhatsNewModalScreen（纯展示 golden 组件），
 * 数据经桥取、交互经事件委托（settings-modal live 同工艺）。
 *
 * 触发（legacy App.tsx:171-184 对等）：LiveChrome 挂载 → whatsNewStatus 查询（native 判定
 * shouldShow=lastSeen 存在且≠当前，**查询即写回**）→ shouldShow=true 时 2s 后弹；
 * 设置面板「查看更新内容」→ whatsNewIntent 手动开（不触 lastSeen）。
 * 数据：releaseNotes{locale}（读随包 CHANGELOG，失败 → [] 空态）；弹窗开着切 locale 重取（legacy :29）。
 * 历史版本折叠/展开为本地 state（legacy expandedVersions Set；每次打开重置为全折叠，legacy :27）。
 */

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useConfig, useConfigApi } from '../../config/ConfigContext';
import type { ReleaseEntry } from '../../bridge/gen/protocol';
import { WhatsNewModalScreen } from '../modal/WhatsNewModalScreen';
import { onOpenWhatsNew } from './whatsNewIntent';

/** 协议 ReleaseEntry（sections 数组保序）→ Screen fixture 形状（Record 插入序即数组序）。 */
function toFixtureEntries(entries: ReleaseEntry[]): { version: string; date: string; sections: Record<string, string[]> }[] {
  return entries.map((entry) => {
    const sections: Record<string, string[]> = {};
    for (const section of entry.sections) sections[section.key] = section.items;
    return { version: entry.version, date: entry.date, sections };
  });
}

export function WhatsNewModalLive(): JSX.Element | null {
  const cfg = useConfig();
  const api = useConfigApi();
  const [open, setOpen] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [entries, setEntries] = useState<ReleaseEntry[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const locale = cfg?.language === 'en' ? 'en' : 'zh';

  // 更新后首启门（UPD_whatsnew_2s_after_upgrade）：查询即写回在 native 半；web 半只管 2s 时序。
  useEffect(() => {
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void api
      .sendAppRequest({ kind: 'whatsNewStatus' })
      .then((r) => {
        if (cancelled || r.kind !== 'whatsNewStatus') return;
        setAppVersion(r.appVersion);
        if (r.shouldShow) {
          timer = setTimeout(() => setOpen(true), 2000);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api]);

  // 手动开（设置面板「查看更新内容」）。
  useEffect(() => onOpenWhatsNew(() => setOpen(true)), []);

  // 打开/切 locale → 取 notes 并重置折叠（legacy :25-29）。
  useEffect(() => {
    if (!open || !api) return;
    let cancelled = false;
    void api
      .sendAppRequest({ kind: 'releaseNotes', locale })
      .then((r) => {
        if (cancelled || r.kind !== 'releaseNotes') return;
        setEntries(r.entries);
        setExpanded([]);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, locale, api]);

  if (!api || !open) return null;

  const fixtureEntries = toFixtureEntries(entries);
  const olderVersions = fixtureEntries.filter((e) => e.version !== appVersion).map((e) => e.version);

  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    // backdrop 空白处（非弹窗内元素）→ 关闭（legacy :68 onClick=close + :69 modal stopPropagation 对等）。
    if (target.classList.contains('whats-new__backdrop')) {
      setOpen(false);
      return;
    }
    const btn = target.closest('button') as HTMLElement | null;
    if (!btn) return;
    if (btn.classList.contains('whats-new__close') || btn.classList.contains('whats-new__dismiss')) {
      setOpen(false);
      return;
    }
    if (btn.classList.contains('whats-new__older-toggle')) {
      // 按钮序 == olderEntries 序（Screen 渲染同源），据此取版本号 toggle。
      const toggles = rootRef.current?.querySelectorAll('.whats-new__older-toggle');
      const index = toggles ? [...toggles].indexOf(btn) : -1;
      const version = index >= 0 ? olderVersions[index] : undefined;
      if (version === undefined) return;
      setExpanded((prev) =>
        prev.includes(version) ? prev.filter((v) => v !== version) : [...prev, version]
      );
    }
  };

  return (
    // data-hit-island：弹窗带全屏 backdrop 盖住终端洞 → 全屏岛（live-panel-overlay 同工艺）。
    <div ref={rootRef} className="live-whatsnew-overlay" data-hit-island="" data-live-whatsnew="" onClick={onClick}>
      <WhatsNewModalScreen
        fx={{ locale, whatsNew: { appVersion, entries: fixtureEntries, expanded } }}
      />
    </div>
  );
}
