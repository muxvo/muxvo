/**
 * 收起终端缩略卡（term-grid §11.2）：状态点 + 标题 + 末行输出摘要 + 可选行内关闭钮（悬停浮现）。
 * 交互逻辑全由父组件经 props 注入（单击/右键/onClose 由 MinimizedRail 提供，缺席即 inert/不渲）。
 * variant 供批A 边栏（rail）与批B 列表（listRow）共用。
 */

import type { MouseEvent as ReactMouseEvent } from 'react';
import type { TerminalFixture } from '../fixture/types';
import { statusClass } from './status';
import { CloseIcon } from './icons';

interface Props {
  terminal: TerminalFixture;
  variant: 'rail' | 'listRow';
  selected?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
  /** 行内关闭钮（dogfood 反馈 2026-07-13：列表页直接关终端，免逐个恢复再关）。缺席不渲
   *  （golden 截图态 DOM 零动）；点击 stopPropagation 不触发卡片单击恢复。 */
  onClose?: () => void;
}

/** 标题（term-grid §11.2）：customName 优先，否则 cwd 末段（§4.3/§4.4 同规则）。
 *  export：MinimizedRail 折叠细条的逐终端点 tooltip 同用（dogfood 反馈②）。 */
export function cardTitle(t: TerminalFixture): string {
  if (t.customName) return t.customName;
  const segs = t.cwd.split('/').filter(Boolean);
  return segs.length ? segs[segs.length - 1] : t.cwd;
}

export function MiniTermCard({
  terminal,
  variant,
  selected,
  onClick,
  onContextMenu,
  onClose,
}: Props): JSX.Element {
  const title = cardTitle(terminal);
  const cn = ['min-card', `min-card--${variant}`, selected ? 'min-card--selected' : '']
    .filter(Boolean)
    .join(' ');
  return (
    // data-term-id：e2e 定位锚（照 .tile-term-hole 的 data-term-id 同名约定），零像素影响。
    <div className={cn} data-term-id={terminal.id} onClick={onClick} onContextMenu={onContextMenu}>
      <div className="min-card__head">
        {/* 状态点复用 .tile-status + statusClass 三色映射（term-grid §3.1） */}
        <span className={`tile-status ${statusClass(terminal.state)}`} />
        <span className="min-card__title" title={title}>
          {title}
        </span>
        {/* 悬停浮现（CSS display:none → .min-card:hover 显示，默认零几何盒 golden/boxes 双零动）。 */}
        {onClose && (
          <button
            className="min-card__close"
            title="关闭终端"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {/* 末行输出摘要（仅收起终端携带 lastLine）：单行灰字截断；无则不渲染该行。 */}
      {terminal.lastLine && <div className="min-card__lastline">{terminal.lastLine}</div>}
    </div>
  );
}
