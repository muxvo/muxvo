// @vitest-environment jsdom
//
// dogfood-r3 问题7：共享 markdown 真渲染核（markdown/md-view）——文件预览入口 renderFileMarkdown。
// 断言 md-static 手写解析器缺失的全部能力（h3-h6/有序列表/嵌套/表格/任务列表/链接/删除线/hljs 围栏）
// + 两个新增件（frontmatter→yaml 围栏、锚点点击拦截防主 frame 导航）。mermaid 经 vi.mock 拦截
// （chat-md-live.test 同款工艺，不真载 11.x 大包）。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), run: vi.fn().mockResolvedValue(undefined) },
}));

import { frontmatterToYamlFence, renderFileMarkdown } from '../src/markdown/md-view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement | null = null;
let root: Root | null = null;
async function mount(md: string): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await act(async () => {
    r.render(renderFileMarkdown(md));
  });
  for (let i = 0; i < 6; i++) await act(async () => await Promise.resolve());
  return el;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('容器与排版元素（md-static 缺口全补齐）', () => {
  test('渲染进 .markdown-view 容器；h3-h6 各级标题真出对应标签', async () => {
    const el = await mount('### 三\n\n#### 四\n\n##### 五\n\n###### 六');
    const view = el.querySelector('.markdown-view');
    expect(view, '容器类 .markdown-view').not.toBeNull();
    expect(view!.querySelector('h3')?.textContent).toBe('三');
    expect(view!.querySelector('h4')?.textContent).toBe('四');
    expect(view!.querySelector('h5')?.textContent).toBe('五');
    expect(view!.querySelector('h6')?.textContent).toBe('六');
  });

  test('有序列表 + 嵌套无序列表', async () => {
    const el = await mount('1. 一\n2. 二\n   - 二甲\n   - 二乙');
    const ol = el.querySelector('.markdown-view ol');
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll(':scope > li').length).toBe(2);
    expect(ol!.querySelector('li ul li')?.textContent).toContain('二甲');
  });

  test('GFM 表格：thead/tbody/单元格齐全', async () => {
    const el = await mount('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
    const view = el.querySelector('.markdown-view')!;
    expect(view.querySelector('table thead th')?.textContent).toBe('A');
    expect(view.querySelectorAll('table tbody tr').length).toBe(2);
    expect(view.querySelectorAll('table tbody td')[1]?.textContent).toBe('2');
  });

  test('任务列表：[ ]/[x] → 禁用复选框（勾选态区分）', async () => {
    const el = await mount('- [ ] 待办\n- [x] 已完成');
    const items = el.querySelectorAll('.markdown-view li.task-list-item');
    expect(items.length).toBe(2);
    const boxes = el.querySelectorAll<HTMLInputElement>('li.task-list-item input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect(boxes[0].disabled && boxes[1].disabled).toBe(true);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
  });

  test('删除线 + 行内代码 + 斜体', async () => {
    const el = await mount('~~删掉~~ *斜* `code`');
    const view = el.querySelector('.markdown-view')!;
    expect(view.querySelector('s')?.textContent).toBe('删掉');
    expect(view.querySelector('em')?.textContent).toBe('斜');
    expect(view.querySelector('code')?.textContent).toBe('code');
  });

  test('hljs 围栏：认识的语言 → pre.hljs + token span；复制钮注入', async () => {
    const el = await mount('```js\nconst a = 1;\n```');
    const pre = el.querySelector('.markdown-view pre.hljs');
    expect(pre).not.toBeNull();
    expect(pre!.querySelector('code span'), 'hljs token span').not.toBeNull();
    expect(pre!.querySelector('.md-copy-btn'), 'W11 复制钮').not.toBeNull();
  });
});

describe('frontmatter → yaml 围栏', () => {
  test('纯函数：首部 --- 块转 ```yaml 围栏；无 frontmatter 原样', () => {
    expect(frontmatterToYamlFence('---\nname: x\n---\n# T')).toBe('```yaml\nname: x\n```\n# T');
    expect(frontmatterToYamlFence('# 无 frontmatter')).toBe('# 无 frontmatter');
  });

  test('渲染：SKILL.md 形首部 frontmatter 出代码块而非 hr/setext 杂讯', async () => {
    const el = await mount('---\nname: my-skill\ndescription: d\n---\n# 标题');
    const view = el.querySelector('.markdown-view')!;
    expect(view.querySelector('pre.hljs')?.textContent).toContain('name: my-skill');
    expect(view.querySelector('hr'), 'frontmatter 不得渲成 hr').toBeNull();
    expect(view.querySelector('h1')?.textContent).toBe('标题');
  });
});

describe('锚点点击拦截（共享 WKWebView 主 frame 防导航，md-view 头注）', () => {
  test('外链 <a href>：click 被 preventDefault + window.open 兜底', async () => {
    const el = await mount('[官网](https://example.com/x)');
    const a = el.querySelector<HTMLAnchorElement>('.markdown-view a[href]');
    expect(a).not.toBeNull();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a!.dispatchEvent(ev);
    expect(ev.defaultPrevented, '必须 preventDefault（否则主 frame 被导航走人）').toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');
  });

  test('页内 # 锚：preventDefault + 按标题文本滚动，不 window.open', async () => {
    const el = await mount('[跳](#my-section)\n\n## My Section');
    const a = el.querySelector<HTMLAnchorElement>('.markdown-view a[href^="#"]')!;
    const heading = el.querySelector<HTMLElement>('.markdown-view h2')!;
    const scrollSpy = vi.fn();
    heading.scrollIntoView = scrollSpy;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(scrollSpy, '按标题文本匹配滚动').toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
