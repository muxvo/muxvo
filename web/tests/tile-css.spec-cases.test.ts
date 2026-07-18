// M2 B1 spec 翻牌：tile 五态 CSS 映射（TERM_L2_56..60）+ Default 默认样式（TERM_L2_88 /
// TERM_L1_13 / TERM_L1_14）+ 名称占位符（TERM_L1_15）。
// state-ui-map / boundaries / l1-term 均为（或视同）混里程碑 spec 文件 → 逐条 test('ID: ...')，
// 严禁 test.each 注入。expected 一律取自冻结 spec JSON，不造平行常量。
//
// 断言面 = 真实工件：
//   - web/src/styles/term-grid.css 原文（readFileSync 读真实文件 + 轻量解析：注释剥离/跳过 @ 块/
//     选择器→声明表，按 cascade 链合并，'!important' 仅剥后缀——本文件断言的属性无同名冲突。
//     注：不用 vite '?raw' 导入——vitest 默认 css:false 会把 .css 模块连同 query 一起 stub 成空串）
//   - TileHeader 真实渲染（react-dom/server renderToStaticMarkup，零新增依赖）
//
// 状态 → 选择器链（与 TermTile/TermGrid 实际挂类一致）：
//   Default → .tile | Hover → .tile + .tile:hover | Selected → .tile + .tile-selected
//   Dragging → .tile + .tile.dragging | DragOver → .tile + .tile.drag-over
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import stateUiSpec from '../../specs/legacy/l2/state-ui-map.spec.json';
import boundariesSpec from '../../specs/legacy/l2/boundaries.spec.json';
import termL1Spec from '../../specs/legacy/l1/term.spec.json';
import { TileHeader } from '../src/tile/TileHeader';
import type { TerminalFixture } from '../src/fixture/types';

const cssText = readFileSync(new URL('../src/styles/term-grid.css', import.meta.url), 'utf8');

// ---------- spec 取值 ----------

type SpecCase = Record<string, unknown>;

function caseOf(cases: readonly unknown[], id: string): SpecCase {
  const c = (cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

interface StateUi {
  border: string;
  opacity: number;
  transform: string;
}

function uiOf(id: string): StateUi {
  return caseOf(stateUiSpec.cases, id).ui as unknown as StateUi;
}

// ---------- CSS 工件解析 ----------

interface CssRule {
  selectors: string[];
  decls: Record<string, string>;
}

function parseCssRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const header = src.slice(i, open).trim();
    if (header.startsWith('@')) {
      // @keyframes 等嵌套块：整块跳过
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    const close = src.indexOf('}', open);
    if (close === -1) break;
    const decls: Record<string, string> = {};
    for (const d of src.slice(open + 1, close).split(';')) {
      const colon = d.indexOf(':');
      if (colon === -1) continue;
      const prop = d.slice(0, colon).trim();
      if (prop) decls[prop] = d.slice(colon + 1).trim().replace(/\s*!important\s*$/, '');
    }
    rules.push({ selectors: header.split(',').map((s) => s.trim()), decls });
    i = close + 1;
  }
  return rules;
}

const RULES = parseCssRules(cssText);

/** 仅取选择器完全等于 sel 的规则声明（同选择器多规则按出现顺序覆盖） */
function onlySelector(sel: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of RULES) {
    if (!rule.selectors.includes(sel)) continue;
    Object.assign(out, rule.decls);
  }
  return out;
}

/** 按 cascade 链合并（后面的选择器覆盖前面的） */
function effectiveDecls(chain: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sel of chain) Object.assign(out, onlySelector(sel));
  return out;
}

/** 边框颜色：优先 border-color，否则取 border 简写末尾的颜色值 */
function borderColorOf(decls: Record<string, string>): string {
  if (decls['border-color']) return decls['border-color'];
  const m = (decls['border'] ?? '').match(/(var\(--[\w-]+\)|rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})\s*$/);
  return m ? m[1] : '';
}

/** spec ui 三主字段（border/opacity/transform）对照真实 CSS（opacity/transform 未声明 = CSS 初始值） */
function expectUiMatch(decls: Record<string, string>, ui: StateUi): void {
  expect(borderColorOf(decls), 'border').toBe(ui.border);
  expect(decls['opacity'] ?? '1', 'opacity').toBe(String(ui.opacity));
  expect(decls['transform'] ?? 'none', 'transform').toBe(ui.transform);
}

// ---------- TERM_L2_56..60：tile 五态 ----------

test('TERM_L2_56_css_default: Tile Default 状态 CSS 映射', () => {
  expectUiMatch(effectiveDecls(['.tile']), uiOf('TERM_L2_56_css_default'));
});

test('TERM_L2_57_css_hover: Tile Hover 状态 CSS 映射', () => {
  const ui = uiOf('TERM_L2_57_css_hover');
  const hover = effectiveDecls(['.tile', '.tile:hover']);
  // 主字段 border/opacity 与 spec 一致（hover 不改边框、不改透明度）
  expect(borderColorOf(hover), 'border').toBe(ui.border);
  expect(hover['opacity'] ?? '1', 'opacity').toBe(String(ui.opacity));
  // 偏差记录（详见 /tmp/m2-b1-specflip-report.md）：legacy 的 transform "rotateX/Y(+-4deg)"
  // 与 extra "光泽反射层" 是老版 JS 动态 3D 倾斜效果；新版行为规格
  // specs/behavior/term-grid.md §3 定义 hover 仅「投影加深」，未继承倾斜/光泽。
  // 此处按真实实现断言：hover 无 transform（保持 none），且 :hover 有独立 box-shadow 加深声明。
  expect(hover['transform'] ?? 'none', 'transform（新版规格：hover 不倾斜）').toBe('none');
  const base = effectiveDecls(['.tile']);
  const hoverOwn = onlySelector('.tile:hover');
  expect(hoverOwn['box-shadow'], 'hover 投影加深声明存在').toBeTruthy();
  expect(hoverOwn['box-shadow']).not.toBe(base['box-shadow']);
});

test('TERM_L2_58_css_selected: Tile Selected 状态 CSS 映射', () => {
  // extra "amber 边框 glow" 即 border-color → var(--accent)（amber token），由主字段断言覆盖
  expectUiMatch(effectiveDecls(['.tile', '.tile-selected']), uiOf('TERM_L2_58_css_selected'));
});

test('TERM_L2_59_css_dragging: Tile Dragging 状态 CSS 映射', () => {
  // extra "半透明" 即 opacity 0.4，由主字段断言覆盖
  expectUiMatch(effectiveDecls(['.tile', '.tile.dragging']), uiOf('TERM_L2_59_css_dragging'));
});

test('TERM_L2_60_css_dragover: Tile DragOver 状态 CSS 映射', () => {
  expectUiMatch(effectiveDecls(['.tile', '.tile.drag-over']), uiOf('TERM_L2_60_css_dragover'));
  // extra "box-shadow: accent-glow"：drag-over 自身声明 amber(232,167,72) 辉光投影
  const own = onlySelector('.tile.drag-over');
  expect(own['box-shadow'], 'accent-glow box-shadow').toContain('rgba(232, 167, 72');
});

// ---------- TERM_L2_88 / TERM_L1_13 / TERM_L1_14：Default 默认样式 ----------

test('TERM_L2_88_default_tile_style: Tile Default 状态默认样式', () => {
  const c = caseOf(boundariesSpec.cases, 'TERM_L2_88_default_tile_style');
  const decls = effectiveDecls(['.tile']);
  const actualByParam: Record<string, string> = {
    border: borderColorOf(decls),
    opacity: decls['opacity'] ?? '1',
  };
  const boundaries = c.boundaries as Array<{ parameter: string; expected: unknown }>;
  expect(boundaries.length).toBeGreaterThan(0);
  for (const b of boundaries) {
    expect(actualByParam[b.parameter], b.parameter).toBe(String(b.expected));
  }
});

test('TERM_L1_13: Default 状态 border -- border = var(--border)', () => {
  const c = caseOf(termL1Spec.cases, 'TERM_L1_13');
  const expectedCSS = c.expectedCSS as { border: string };
  expect(borderColorOf(effectiveDecls(['.tile']))).toBe(expectedCSS.border);
});

test('TERM_L1_14: Default 状态 opacity -- opacity = 1', () => {
  const c = caseOf(termL1Spec.cases, 'TERM_L1_14');
  const expectedCSS = c.expectedCSS as { opacity: number };
  expect(effectiveDecls(['.tile'])['opacity'] ?? '1').toBe(String(expectedCSS.opacity));
});

// ---------- TERM_L1_15：名称占位符 ----------

test('TERM_L1_15: 名称占位符 -- 新建终端显示灰色斜体「命名...」', () => {
  const c = caseOf(termL1Spec.cases, 'TERM_L1_15');
  const expectedUI = c.expectedUI as { placeholderText: string; style: string };

  // 真实渲染：未命名终端（无 customName）→ 占位 span
  const terminal: TerminalFixture = { id: 't-unnamed', state: 'Running', cwd: '/Users/demo/proj' };
  const html = renderToStaticMarkup(createElement(TileHeader, { terminal, homePath: '/Users/demo' }));
  const m = html.match(/<span class="([^"]*tile-custom-name--placeholder[^"]*)">([^<]*)<\/span>/);
  expect(m, '占位 span 必须渲染').toBeTruthy();
  expect(m![2], 'placeholderText').toBe(expectedUI.placeholderText);

  // "gray italic"：真实 CSS 中占位 class 的声明（gray = var(--text-muted) 灰色 token
  // theme.css: dark #3f3f46 / light #aeaeb2；italic = font-style）
  expect(expectedUI.style).toBe('gray italic');
  const decls = onlySelector('.tile-custom-name--placeholder');
  expect(decls['font-style'], 'italic').toBe('italic');
  expect(decls['color'], 'gray').toBe('var(--text-muted)');
});
