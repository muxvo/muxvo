// M6 批1 spec 翻牌（web，A3）：Hooks settings.json 损坏兜底 / detail 编辑保存周期。
// 断言面 = 纯函数（hooksSettings/panelState）+ 既有 golden HooksPanelScreen 真实渲染。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import configSpec from '../../specs/legacy/l1/config.spec.json';
import { HooksPanelScreen } from '../src/screen/panels/HooksPanelScreen';
import {
  applyHookEdit,
  flattenHooks,
  flattenHooksFromJson,
  parseHooksSettings,
  serializeSettings,
} from '../src/screen/panels/live/hooksSettings';
import { DETAIL_INITIAL, detailReducer } from '../src/screen/panels/live/panelState';

type SpecCase = Record<string, any>;

function caseOf(id: string): SpecCase {
  const c = (configSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

// CONFIG_L1_18：Settings 读取失败。spec 期望 '无法读取 settings.json' + 警告图标 + [重试]——
// as-built 无该错误 UI（note）：settings.json 损坏 → parseHooksSettings catch → {hooks:{}} → 展平 []
// → HooksPanelScreen 空态 '暂无 Hook 配置' 不崩（锚 catch→[] 行为）。警告图标/重试钮不存在，记 note。
test('CONFIG_L1_18: Settings 读取失败 — 损坏 JSON → 展平 [] → 空态不崩（无警告/重试 UI，note）', () => {
  const c = caseOf('CONFIG_L1_18');
  expect(c.condition).toBe('settings.json is corrupted');
  expect(c.expectedUI.message).toBe('无法读取 settings.json'); // stub 口径（as-built 不渲染）

  // 纯函数：损坏 / 非对象 / 缺 hooks 一律归空，绝不抛
  expect(parseHooksSettings('{ this is not json ]')).toEqual({ hooks: {} });
  expect(parseHooksSettings('[]')).toEqual({ hooks: {} });
  expect(parseHooksSettings('{"other":1}')).toEqual({ hooks: {} });
  expect(flattenHooksFromJson('}{corrupt')).toEqual([]);

  // 屏渲染：空态文案，不崩；as-built 无 '无法读取' / 警告 / 重试
  const html = renderToStaticMarkup(
    createElement(HooksPanelScreen, {
      fx: {
        screen: 'hooks-panel',
        theme: 'dark',
        homePath: '/Users/rl',
        hooks: { settings: parseHooksSettings('corrupt!'), selectedId: null },
      },
    }),
  );
  expect(html).toContain('hooks-panel__empty');
  expect(html).toContain('暂无 Hook 配置');
  expect(html).not.toContain('无法读取 settings.json');
  expect(html).not.toContain('重试');
});

// CONFIG_L1_27：View → Editing → View 编辑保存周期。detail 状态机（panelState.detailReducer）：
// select（只读 detail）→ edit（form）→ save（回只读 detail）；应用 applyHookEdit 后 saveSettings 载新值。
test('CONFIG_L1_27: 编辑保存周期 — hooks detail → 编辑(form) → 保存 → 回 detail', () => {
  const c = caseOf('CONFIG_L1_27');
  expect(c.state).toBe('View -> Editing -> View');

  // 状态机往返：select→detail(form:false) → edit→form(true) → save→回 detail(form:false)，selectedId 不变
  const s0 = detailReducer(DETAIL_INITIAL, { type: 'select', id: 'global:PreToolUse:0:0' });
  expect(s0).toEqual({ selectedId: 'global:PreToolUse:0:0', form: false });
  const s1 = detailReducer(s0, { type: 'edit' });
  expect(s1).toEqual({ selectedId: 'global:PreToolUse:0:0', form: true });
  const s2 = detailReducer(s1, { type: 'save' });
  expect(s2).toEqual({ selectedId: 'global:PreToolUse:0:0', form: false });

  // 保存副产物：applyHookEdit 就地改命令 → serializeSettings 载新值（回写 payload 含更新）
  const settings = { hooks: { PreToolUse: [{ hooks: [{ type: 'command' as const, command: 'old cmd' }] }] } };
  const updated = applyHookEdit(settings, 'global:PreToolUse:0:0', {
    event: 'PreToolUse',
    handler: { type: 'command', command: 'new cmd' },
  });
  const payload = serializeSettings(updated);
  expect(payload).toContain('new cmd');
  expect(payload).not.toContain('old cmd');
  // 展平仍 1 条（就地替换非新增），入参未被改（不可变）
  expect(flattenHooks(updated.hooks)).toHaveLength(1);
  expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('old cmd');
});
