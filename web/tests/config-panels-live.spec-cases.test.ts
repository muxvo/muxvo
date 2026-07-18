// M6 批1 spec 翻牌（web，A3）：MCP scope 权限矩阵 / Skills 搜索过滤 / Skills 选中往返。
// l1/config 混里程碑 spec → 逐条 test('ID: ...')，严禁 test.each 注入（spec-runner 1:1）。
//
// 断言面 = 真实工件：既有 golden 屏组件（Mcp/SkillsPanelScreen）纯 props 真实渲染
// （renderToStaticMarkup，config-empty-state 先例），永不 mock 桥。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import configSpec from '../../specs/legacy/l1/config.spec.json';
import { McpPanelScreen } from '../src/screen/panels/McpPanelScreen';
import { SkillsPanelScreen } from '../src/screen/panels/SkillsPanelScreen';

type SpecCase = Record<string, any>;

function caseOf(id: string): SpecCase {
  const c = (configSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

// CONFIG_L1_10：资源操作权限。spec 的 config.resourcePermissions（readOnly 含 Skills/Hooks/MCP）
// 为 legacy 零消费 config-manager stub；as-built 权限按 **scope** 判（m6-batch0 裁决订正）：
//   · MCP：仅 global 可编辑/删除，非 global 只读提示（mcp-panel.md §1）——本测试锚定面
//   · 订正矩阵：Hooks global 同可编辑（hooks-panel.md §1）、Skills 有 SKILL.md 编辑器（skills-panel.md §4）
//   · 故 spec 把 Skills/Hooks/MCP 一律列 readOnly 是 stub 口径错，实现以 scope 判为准。
test('CONFIG_L1_10: 资源操作权限 — MCP 按 scope 判（global 可编辑/删除，非 global 只读提示）', () => {
  const c = caseOf('CONFIG_L1_10');
  expect(c.target).toBe('config.resourcePermissions');
  // 记录 stub 口径（Skills/Hooks/MCP 被列 readOnly）—— as-built 以 scope 判订正之
  expect(c.expectedValue.readOnly).toContain('MCP');

  const global = renderToStaticMarkup(
    createElement(McpPanelScreen, {
      fx: {
        screen: 'mcp-panel',
        theme: 'dark',
        mcp: {
          servers: [{ name: 'srv-g', type: 'stdio', scope: 'global', command: 'npx x', configPath: '~/.claude.json' }],
          selected: 'srv-g',
        },
      },
    }),
  );
  // global：可编辑/删除（订正矩阵），无只读提示
  expect(global).toContain('mcp-panel__btn--primary'); // 编辑
  expect(global).toContain('mcp-panel__btn--danger'); // 删除
  expect(global).not.toContain('mcp-panel__detail-hint');

  const desktop = renderToStaticMarkup(
    createElement(McpPanelScreen, {
      fx: {
        screen: 'mcp-panel',
        theme: 'dark',
        mcp: {
          servers: [{ name: 'srv-d', type: 'stdio', scope: 'desktop', command: 'npx y', configPath: '~/claude_desktop_config.json' }],
          selected: 'srv-d',
        },
      },
    }),
  );
  // 非 global：只读提示，无编辑/删除
  expect(desktop).toContain('mcp-panel__detail-hint');
  expect(desktop).not.toContain('mcp-panel__btn--primary');
  expect(desktop).not.toContain('mcp-panel__btn--danger');
});

// CONFIG_L1_11：浏览 Skills 列表 + 搜索。SkillsPanelScreen 内置 searchQuery 过滤（名/desc 子串）；
// 无命中 → 'No matching skills'（skills-panel.md §2，硬编码英文 dom-assert 文案）。
test('CONFIG_L1_11: 浏览 Skills 列表 — 搜索过滤命中子集 + 无命中文案', () => {
  const c = caseOf('CONFIG_L1_11');
  expect(c.expectedBehavior).toBe('expand Skills list with search support');

  const items = [
    { name: 'alpha-skill', path: '/s/alpha', desc: 'first' },
    { name: 'beta-skill', path: '/s/beta', desc: 'second' },
  ];
  const filtered = renderToStaticMarkup(
    createElement(SkillsPanelScreen, {
      fx: { screen: 'skills-panel', theme: 'dark', skills: { items, selected: null, searchQuery: 'alpha' }, files: {}, dirs: {} },
    }),
  );
  expect(filtered).toContain('alpha-skill');
  expect(filtered).not.toContain('beta-skill');
  expect(filtered).not.toContain('No matching skills');

  const noHit = renderToStaticMarkup(
    createElement(SkillsPanelScreen, {
      fx: { screen: 'skills-panel', theme: 'dark', skills: { items, selected: null, searchQuery: 'zzz-none' }, files: {}, dirs: {} },
    }),
  );
  expect(noHit).toContain('No matching skills');
  expect(noHit).not.toContain('alpha-skill');
});

// CONFIG_L1_26：资源列表点击预览往返（SkillsList → ResourcePreview → SkillsList）。
// 三栏常驻布局无独立「返回」态：选中即右栏渲染预览、左栏列表常驻且选中项恒高亮（--active）——
// 「往返」在本形态退化为选中态一致性。note：三栏无返回钮（列表常驻，预览随选中项切换）。
test('CONFIG_L1_26: 资源列表点击预览往返 — 三栏列表常驻，选中态一致（--active + 右栏预览）', () => {
  const c = caseOf('CONFIG_L1_26');
  expect(c.state).toBe('SkillsList -> ResourcePreview -> SkillsList');

  const items = [
    { name: 'alpha-skill', path: '/s/alpha', desc: 'first' },
    { name: 'beta-skill', path: '/s/beta', desc: 'second' },
  ];
  const html = renderToStaticMarkup(
    createElement(SkillsPanelScreen, {
      fx: {
        screen: 'skills-panel',
        theme: 'dark',
        skills: { items, selected: '/s/alpha' },
        files: { '/s/alpha/SKILL.md': '# Alpha\n\nbody' },
        dirs: { '/s/alpha': [{ name: 'SKILL.md', isDirectory: false }] },
      },
    }),
  );
  // 列表常驻 + 选中项高亮（返回列表无独立态，选中态即列表态）
  expect(html).toContain('skill-list__item--active');
  // 右栏预览就位（SKILL.md 渲染进 .tiptap）
  expect(html).toContain('markdown-wysiwyg');
  expect(html).toContain('Alpha');
});
