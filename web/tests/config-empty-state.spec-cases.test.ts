// M2 B3 spec 翻牌：配置面板空态（CONFIG_L1_16/17）。
// l1/config 为混里程碑 spec 文件 → 逐条 test('ID: ...')，严禁 test.each 注入。
//
// ⚠️ Tier-B 偏差（检查点⑥裁决，screens.json adjudications#1）：spec expectedUI.message
// （"还没有 Skills..." / "还没有配置 Hooks"）为 legacy 零消费 stub（config-manager/empty-state.ts），
// UI 从不渲染。断言以 legacy 实渲染文案为准：
//   skills 空态 = '暂无技能' + 路径 hint（SkillList.tsx:108-111）
//   hooks  空态 = '暂无 Hook 配置'（HooksPanel.tsx:173）
// golden 像素权威同口径（sk-empty 为四面板空态代表作）。
//
// 断言面 = 真实工件：web/src/screen/panels/{Skills,Hooks}PanelScreen 空态真实渲染
// （react-dom/server renderToStaticMarkup，B1 tile-css 先例）。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import configSpec from '../../specs/legacy/l1/config.spec.json';
import { SkillsPanelScreen } from '../src/screen/panels/SkillsPanelScreen';
import { HooksPanelScreen } from '../src/screen/panels/HooksPanelScreen';

type SpecCase = Record<string, any>;

function caseOf(id: string): SpecCase {
  const c = (configSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

test('CONFIG_L1_16: 无 Skills 缺省态 — 空列表渲染 legacy 实际文案（暂无技能 + 路径 hint）', () => {
  const c = caseOf('CONFIG_L1_16');
  // spec 锚定：case 存在且确为 skills 空态 ui-state；其 stub 文案与实渲染的偏差见头注
  expect(c.state).toBe('emptyState_skills');
  expect(c.expectedUI.message).toBe('还没有 Skills，可以在终端中使用 claude code 自动创建');

  const html = renderToStaticMarkup(
    createElement(SkillsPanelScreen, {
      fx: {
        screen: 'skills-panel',
        theme: 'dark',
        skills: { items: [], selected: null },
        files: {},
        dirs: {},
      },
    }),
  );
  // legacy 实渲染（SkillList.tsx:108-111）：'暂无技能' + 两行路径 hint + 计数角标 0
  expect(html).toContain('skill-list__empty');
  expect(html).toContain('<p>暂无技能</p>');
  expect(html).toContain('~/.claude/skills/');
  expect(html).toContain('&lt;project&gt;/.claude/skills/');
  expect(html).toContain('<span class="skill-list__count">0</span>');
  // 不渲染 spec stub 文案（偏差是单向的：实渲染 ≠ spec 期望）
  expect(html).not.toContain('还没有 Skills');
});

test('CONFIG_L1_17: 无 Hooks 缺省态 — 空列表渲染 legacy 实际文案（暂无 Hook 配置）', () => {
  const c = caseOf('CONFIG_L1_17');
  expect(c.state).toBe('emptyState_hooks');
  expect(c.expectedUI.message).toBe('还没有配置 Hooks');

  const html = renderToStaticMarkup(
    createElement(HooksPanelScreen, {
      fx: {
        screen: 'hooks-panel',
        theme: 'dark',
        homePath: '/Users/rl',
        hooks: { settings: { hooks: {} }, selectedId: null },
      },
    }),
  );
  // legacy 实渲染（HooksPanel.tsx:173）：'暂无 Hook 配置'；右栏维持未选中 placeholder
  expect(html).toContain('hooks-panel__empty');
  expect(html).toContain('暂无 Hook 配置');
  expect(html).toContain('选择一个 Hook 查看详情');
  expect(html).not.toContain('还没有配置 Hooks');
});
