/**
 * 终端内容区 —— 复刻屏用固定文本块模拟（spec §7）。
 * 样式契约（与 golden 注入完全一致）见 visual-diff fixtures/_CONTRACT.md。
 */

import type { ContentLine } from '../fixture/types';

const TERM_FONT =
  "'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Cascadia Code', 'Courier New', monospace";

interface Props {
  /**
   * 内容行。**缺席（undefined）= 真状态源路径**（M3 起终端由原生 Metal 直渲，桥推送的
   * TerminalSnapshot 不带 content）→ 走 `.tile-term-hole` 透明洞分支，原生在洞后合成。
   * 一切 fixture/截图路径 content 恒存在（resolve-fixtures 强制 contentKey），永不落入洞分支
   * → 原渲染路径逐字节不动（bridge v2 草案 §6.3）。
   */
  lines?: ContentLine[];
  palette: { background: string; foreground: string };
  /** 洞分支用：终端 id 与角色（layoutReport 产生端据此上报 rect，草案 §3.1）。 */
  holeId?: string;
  holeRole?: 'grid' | 'sidebarPreview';
}

export function TermContent({ lines, palette, holeId, holeRole }: Props): JSX.Element {
  if (lines === undefined) {
    // 真状态源透明洞：原生直渲在此矩形后合成；bg 透明、无内边距，交由 layoutReport 上报几何。
    return (
      <div className="tile-term-hole" data-term-id={holeId} data-term-role={holeRole ?? 'grid'} />
    );
  }
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: palette.background,
        padding: '8px',
        overflow: 'hidden',
        fontFamily: TERM_FONT,
        fontSize: '14px',
        lineHeight: 1.4,
        color: palette.foreground,
        whiteSpace: 'pre',
        userSelect: 'none',
      }}
    >
      {lines.map((segments, i) => (
        <div key={i}>
          {segments.length === 0
            ? ' '
            : segments.map((s, j) => (
                <span key={j} style={s.hex ? { color: s.hex } : undefined}>
                  {s.t}
                </span>
              ))}
        </div>
      ))}
    </div>
  );
}
