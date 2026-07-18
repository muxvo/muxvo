/**
 * tab 栏（§1）：首位恒终端 tab（⌗ + 终端名，不可关）+ 文件 tab 按序（dirty 琥珀点 + 文件名 font-mono + ✕）
 * + 终端状态灯组（§2.5，≥2 终端时常驻，不随 tab 横滚）+ 最右「回到平铺」钮（网格图标）。
 * tab 溢出横向滚动；视觉基调对齐 tile-header（琥珀 accent）。
 * 回调全可选：未传不挂监听（静态 inert，golden 工艺）。
 */

import { GridIcon, CloseIcon } from '../../tile/icons';
import { HoverTip } from '../../tile/HoverTip';
import { statusKind } from '../../tile/status';
import { cardTitle } from '../../tile/MiniTermCard';
import type { TerminalFixture } from '../../fixture/types';
import { TERMINAL_TAB_ID, type FileTab } from './fileTabsReducer';

export interface TerminalLight {
  id: string;
  label: string;
  state: string;
  /** 文件所属终端（=sourceTerminalId）：琥珀外环恒在，不随切换丢失 */
  owner: boolean;
  /** 洞内当前显示（=displayedTerminalId）：灯下 2px 琥珀指示条 */
  current: boolean;
}

/** 灯组数据（§2.5）：Live 与截图屏共用同一映射；label = cardTitle 同源（customName ?? cwd 末段） */
export function buildTerminalLights(
  terminals: TerminalFixture[],
  sourceTerminalId: string,
  displayedTerminalId: string,
): TerminalLight[] {
  return terminals.map((t) => ({
    id: t.id,
    label: cardTitle(t),
    state: String(t.state),
    owner: t.id === sourceTerminalId,
    current: t.id === displayedTerminalId,
  }));
}

/** 悬停状态文案（§2.5 ▵）：三桶随灯色，dead 族细分「已停止」 */
function lightStateText(state: string): string {
  const kind = statusKind(state);
  if (kind === 'running') return '运行中';
  if (kind === 'waiting') return '等待输入';
  return state === 'Stopped' || state === 'Disconnected' || state === 'Failed' ? '已停止' : '空闲';
}

interface FileTabBarProps {
  terminalLabel: string;
  tabs: FileTab[];
  activeId: string;
  /** 终端状态灯组（§2.5）。缺席或 <2 灯 → 灯组整体不渲染（单终端无可切对象）。 */
  lights?: TerminalLight[];
  onSelectTab?: (id: string) => void;
  onCloseTab?: (path: string) => void;
  /** 点灯 → showTerminal（切洞 + 激活终端 tab）。未传不挂监听（inert）。 */
  onSelectTerminal?: (id: string) => void;
  onExit?: () => void;
}

export function FileTabBar({
  terminalLabel,
  tabs,
  activeId,
  lights,
  onSelectTab,
  onCloseTab,
  onSelectTerminal,
  onExit,
}: FileTabBarProps): JSX.Element {
  return (
    <div className="file-tabs-view__tabbar">
      <div className="file-tabs-view__tabs">
        <div
          className={`file-tabs-view__tab file-tabs-view__tab--terminal${
            activeId === TERMINAL_TAB_ID ? ' file-tabs-view__tab--active' : ''
          }`}
          onClick={onSelectTab ? () => onSelectTab(TERMINAL_TAB_ID) : undefined}
        >
          <span className="file-tabs-view__tab-glyph">{'⌗'}</span>
          <span className="file-tabs-view__tab-name">{terminalLabel}</span>
        </div>

        {tabs.map((tab) => (
          <div
            key={tab.path}
            className={`file-tabs-view__tab${activeId === tab.path ? ' file-tabs-view__tab--active' : ''}`}
            onClick={onSelectTab ? () => onSelectTab(tab.path) : undefined}
          >
            {tab.dirtyValue !== null && <span className="file-tabs-view__tab-dot" />}
            <span className="file-tabs-view__tab-name">{tab.name}</span>
            <button
              className="file-tabs-view__tab-close"
              title="关闭"
              onClick={
                onCloseTab
                  ? (e) => {
                      e.stopPropagation();
                      onCloseTab(tab.path);
                    }
                  : undefined
              }
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>

      {lights && lights.length >= 2 && (
        <div className="file-tabs-view__lights">
          {lights.map((l) => {
            const tip = `${l.label} · ${lightStateText(l.state)}${l.owner ? ' · 文件所属' : ''}`;
            return (
              <HoverTip key={l.id} label={tip}>
                <button
                  className={`file-tabs-view__light${l.current ? ' file-tabs-view__light--current' : ''}`}
                  data-term-light={l.id}
                  title={tip}
                  onClick={onSelectTerminal ? () => onSelectTerminal(l.id) : undefined}
                >
                  <span
                    className={`file-tabs-view__light-dot file-tabs-view__light-dot--${statusKind(l.state)}${
                      l.owner ? ' file-tabs-view__light-dot--owner' : ''
                    }`}
                  />
                </button>
              </HoverTip>
            );
          })}
        </div>
      )}

      <button className="file-tabs-view__exit" title="回到平铺" onClick={onExit}>
        <GridIcon />
      </button>
    </div>
  );
}
