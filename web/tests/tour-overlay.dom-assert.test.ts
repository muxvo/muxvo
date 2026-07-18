// M2 B6 dom-assert：tour-overlay「其余 steps」（specs/screens.json tour-overlay states[1]：
// steps.ts 数据驱动，断言步数与锚点）。两屏 specCases 均空（纯 golden 批），本文件刻意
// 不用 spec ID 命名（grid-layout.smoke 先例）。
//
// 断言面 = 真实工件：web/src/screen/tour/tour-steps.ts 数据（specs/behavior/tour-overlay.md
// §1 逐字段）+ TourOverlayScreen 复合宿主实渲染（renderToStaticMarkup——driver.js 只在
// effect 中驱动，静态渲染恰好只出宿主 DOM，正合「锚点选择器在宿主中实存」断言）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TOUR_STEPS } from '../src/screen/tour/tour-steps';
import { TourOverlayScreen } from '../src/screen/tour/TourOverlayScreen';

/** 复合宿主 fixture（tour-overlay 信封：base 必填；未命名 git 终端 → 四锚点全可现） */
const fx = {
  id: 'spec-tour',
  theme: 'dark',
  screen: 'tour-overlay',
  palette: { background: '#000000', foreground: '#ffffff' },
  base: {
    homePath: '/Users/rl',
    viewMode: 'Tiling',
    focusedId: null,
    selectedId: null,
    activeSidebarId: null,
    maxReached: false,
    dragging: null,
    dragOver: null,
    editing: null,
    waitingNotification: null,
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/dev/muxvo', isGitRepo: true, content: [] },
    ],
  },
};

/** 选择器（可为逗号列表）中任一简单 class 在 markup 的 class 属性中实存 */
function anchorPresent(html: string, selector: string): boolean {
  return selector.split(',').some((alt) => {
    const cls = alt.trim().replace(/^\./, '');
    const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`class="(?:[^"]* )?${esc}(?: [^"]*)?"`).test(html);
  });
}

test('引导步数与步序：4 步数据驱动（steps 数据 = 行为规格 §1 逐字段）', () => {
  expect(TOUR_STEPS.map((s) => s.id)).toEqual([
    'create-terminal',
    'focus-terminal',
    'rename-terminal',
    'open-files',
  ]);
  expect(TOUR_STEPS.map((s) => s.selector)).toEqual([
    '.terminal-grid__fab',
    '.tile-max-btn',
    // 高亮实际可点元素（onClick→beginRename 在此层），而非内层小 span placeholder——洞≈命中区，
    // 防真机点洞边缘落可点区外卡第三步（fix/welcome-overlay-island）。
    '.tile-name-clickable',
    '.tile-file-btn',
  ]);
  expect(TOUR_STEPS.map((s) => s.title)).toEqual(['新建终端', '聚焦终端', '重命名终端', '打开文件']);
  // 四步同构：side bottom / interactive（无 Next 钮，动作推进）/ 仅 close 钮
  for (const s of TOUR_STEPS) {
    expect(s.side).toBe('bottom');
    expect(s.interactive).toBe(true);
    expect(s.showButtons).toEqual(['close']);
  }
});

test('四步锚点选择器在复合宿主（menubar+grid）实渲染中实存', () => {
  const html = renderToStaticMarkup(createElement(TourOverlayScreen, { fx }));
  // 宿主形态自检：menubar + 网格同屏（复合宿主特例，screens.json 裁决#4）
  expect(html).toContain('class="menu-bar"');
  expect(anchorPresent(html, '.tile')).toBe(true);
  for (const s of TOUR_STEPS) {
    expect(anchorPresent(html, s.selector), `锚点不存在: ${s.selector}`).toBe(true);
  }
});
