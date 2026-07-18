// FILE_L1_09 归属迁移（M6-B 用户授权退役 2026-07-07）：三栏 FileTempView 退役后，本条断言迁到
// tab 式文件视图。file-tabs-view 以「单来源终端 tab」替代原右栏多终端，右栏 280 不复存在，
// 故只断言左树 250px 行内宽（spec expected.left）+ 内容区 flex:1（spec expected.middle）；
// expected.right 随三栏退役失效（FILE_L1_10/11 已改派 not-applicable，见 status.json）。
//
// 断言面 = 真实工件（不造平行值）：
//   - web/src/config/defaults.ts 常量（APP_L2_02 已断言其与 config 默认一致）
//   - FileTabsView 真实渲染（renderToStaticMarkup）：左栏行内 width 实际消费常量
//   - web/src/screen/filetabs/file-tabs.css 原文：.file-tabs-view__main 内容区 flex: 1
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import fileL1Spec from '../../specs/legacy/l1/file.spec.json';
import { DEFAULT_FTV_LEFT_WIDTH } from '../src/config/defaults';
import { FileTabsView } from '../src/screen/filetabs/FileTabsView';
import { TERMINAL_TAB_ID } from '../src/screen/filetabs/fileTabsReducer';

test('FILE_L1_09: 三栏默认宽度 -- 左栏 250px, 中栏 flex:1, 右栏 280px', () => {
  const c = (fileL1Spec.cases as Record<string, unknown>[]).find((x) => x.id === 'FILE_L1_09');
  if (!c) throw new Error('spec case 不存在: FILE_L1_09');
  const expected = c.expectedValue as { left: string; middle: string; right: string };

  // 1) 权威常量 = spec 期望左栏宽（expected 取自冻结 spec JSON）
  expect(`${DEFAULT_FTV_LEFT_WIDTH}px`).toBe(expected.left);

  // 2) FileTabsView 左树实际消费常量：.file-tabs-view__left 行内 width 渲染为常量值
  const html = renderToStaticMarkup(
    createElement(FileTabsView, {
      sourceTerminalId: 't1',
      terminalLabel: 'muxvo',
      entries: [],
      showHidden: false,
      activeFilePath: null,
      tabs: [],
      activeId: TERMINAL_TAB_ID,
      dialog: null,
      renderHole: false,
    }),
  );
  const leftStyle = /class="file-tabs-view__left" style="([^"]*)"/.exec(html)?.[1] ?? '';
  expect(leftStyle).toContain(`width:${expected.left}`);

  // 3) 内容主区 flex:1（file-tabs.css 真实工件原文；expected.middle 形如 'flex:1'）
  const cssText = readFileSync(new URL('../src/screen/filetabs/file-tabs.css', import.meta.url), 'utf8');
  const mainBlock = /\.file-tabs-view__main\s*\{([^}]*)\}/.exec(cssText)?.[1] ?? '';
  const flexValue = /(?:^|;)\s*flex:\s*([^;]+);/.exec(mainBlock)?.[1].trim() ?? '';
  expect(`flex:${flexValue}`).toBe(expected.middle);
});
