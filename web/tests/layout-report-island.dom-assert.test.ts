// F2 穿透交互岛（dogfood_m3_02 修复 B）：验证 FAB 挂 data-hit-island 采集锚点 +
// toReportRect 岛载荷契约（哨兵 id / role=island / visible 由尺寸判定）。
// node 环境（无 jsdom）：DOM 锚点走 renderToStaticMarkup（tour-overlay/dom-assert 先例），
// 载荷映射走纯函数 toReportRect（useLayoutReport 里洞/岛共用同一映射）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, describe } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import { ISLAND_TERMINAL_ID, toReportRect } from '../src/grid/useLayoutReport';
import type { Fixture } from '../src/fixture/types';

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'spec-island',
    theme: 'dark',
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
    searchBar: null,
    palette: { background: '#1e1e1e', foreground: '#cccccc' },
    terminals: [
      { id: 't1', state: 'Running', cwd: '/Users/rl/a', content: [[{ t: 'a' }]] },
      { id: 't2', state: 'Running', cwd: '/Users/rl/b', content: [[{ t: 'b' }]] },
    ],
    ...over,
  } as Fixture;
}

const render = (fx: Fixture): string =>
  renderToStaticMarkup(createElement(TermGrid, { fx, onAction: () => {} }));

describe('F2 穿透交互岛：FAB 采集锚点', () => {
  test('FAB 带 data-hit-island（采集器 querySelectorAll 锚点）', () => {
    expect(render(baseFixture())).toContain('data-hit-island');
  });

  test('空态 FAB 同样带 data-hit-island', () => {
    expect(render(baseFixture({ terminals: [] }))).toContain('data-hit-island');
  });
});

describe('F2 穿透交互岛：toReportRect 岛载荷契约', () => {
  test('island → 哨兵 id + role=island + visible 由尺寸判定', () => {
    expect(toReportRect({ left: 1400, top: 820, width: 44, height: 44 }, 'island')).toEqual({
      terminalId: ISLAND_TERMINAL_ID,
      x: 1400,
      y: 820,
      w: 44,
      h: 44,
      visible: true,
      role: 'island',
    });
  });

  test('0×0 岛 visible=false', () => {
    expect(toReportRect({ left: 0, top: 0, width: 0, height: 0 }, 'island').visible).toBe(false);
  });

  test('grid/sidebarPreview 保持既有语义（termId 透传，缺省空串）', () => {
    expect(toReportRect({ left: 0, top: 0, width: 100, height: 50 }, 'grid', 't1')).toEqual({
      terminalId: 't1',
      x: 0,
      y: 0,
      w: 100,
      h: 50,
      visible: true,
      role: 'grid',
    });
    expect(toReportRect({ left: 5, top: 6, width: 10, height: 10 }, 'sidebarPreview').terminalId).toBe(
      '',
    );
  });
});
