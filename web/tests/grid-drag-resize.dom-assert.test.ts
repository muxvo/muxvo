// M3 批5③ bridge 门控 + golden 保全 dom-assert（node 环境，renderToStaticMarkup——tour-overlay 先例）。
// 断言面 = 真实工件 TermGrid（消费 useGridInteractions）静态渲染的序列化 HTML。
//
// 核心命题：提供 onAction（bridge 模式）不改变「静止态」DOM——ghost 不挂、类名/属性零变、
// 分隔条与列模板逐字节同 —— 与 M2 golden 逐字节一致由 visual-diff 兜底，这里是单元级速验。
// 事件监听（onDragStart/onMouseDown…）不进序列化 HTML，故「非 bridge 不挂监听」等价于「两模式 HTML 全等」。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, describe } from 'vitest';
import { TermGrid } from '../src/grid/TermGrid';
import type { Fixture } from '../src/fixture/types';

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    id: 'spec-drag',
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

const noop = () => {};

const render = (fx: Fixture, live: boolean): string =>
  renderToStaticMarkup(
    createElement(TermGrid, { fx, onAction: live ? noop : undefined }),
  );

describe('bridge 门控：提供 onAction 不改静止态 DOM（golden 保全速验）', () => {
  test('N=2 单行：live 与非 live HTML 全等', () => {
    const fx = baseFixture();
    expect(render(fx, true)).toBe(render(fx, false));
  });

  test('N=4 多行：live 与非 live HTML 全等', () => {
    const fx = baseFixture({
      terminals: ['t1', 't2', 't3', 't4'].map((id) => ({
        id,
        state: 'Running',
        cwd: `/Users/rl/${id}`,
        content: [[{ t: id }]],
      })) as Fixture['terminals'],
    });
    expect(render(fx, true)).toBe(render(fx, false));
  });

  test('拖拽 ghost 静止态两模式均不渲染', () => {
    const fx = baseFixture();
    expect(render(fx, true)).not.toContain('tile-drag-ghost');
    expect(render(fx, false)).not.toContain('tile-drag-ghost');
  });
});

describe('F5 拖拽静态态由 fixture 驱动（drag golden 渲染路径不变）', () => {
  test('dragging/dragOver 类名在 live 与非 live 均出（截图侧走非 live）', () => {
    const fx = baseFixture({ dragging: 't1', dragOver: 't2' });
    for (const live of [true, false]) {
      const html = render(fx, live);
      expect(html, `live=${live}`).toContain('dragging');
      expect(html, `live=${live}`).toContain('drag-over');
    }
  });
});

describe('列模板与分隔条：静止态默认均分（1fr）', () => {
  test('N=2 单行 gridTemplateColumns 默认 1fr 1fr（默认 fr 串逐字保全）', () => {
    const html = render(baseFixture(), false);
    expect(html).toContain('grid-template-columns:1fr 1fr');
  });

  test('Tiling 有分隔条，Focused 无分隔条（spec §1.3 把手隐藏）', () => {
    const tiling = render(baseFixture(), false);
    expect(tiling).toContain('resize-handle');

    const focused = render(
      baseFixture({
        viewMode: 'Focused',
        focusedId: 't1',
        terminals: [
          { id: 't1', state: 'Running', cwd: '/Users/rl/a', content: [[{ t: 'a' }]] },
          { id: 't2', state: 'Running', cwd: '/Users/rl/b', content: [[{ t: 'b' }]] },
        ] as Fixture['terminals'],
      }),
      false,
    );
    expect(focused).not.toContain('resize-handle');
  });
});
