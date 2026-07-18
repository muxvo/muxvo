/**
 * 共享 live markdown 真渲染核（dogfood-r3 问题7；file-tabs-view.md §3 + chat-history.md §5）。
 *
 * 铁律：**只许 live 容器 `await import()` 动态加载本模块**，任何 golden/截图路径不得静态 import——
 * markdown-it / hljs / mermaid 绝不进截图 bundle（chat-md-live 先例工艺；golden 静态 fallback =
 * md-static / chat-md-static，逐字节冻结不动）。
 *
 * 渲染核从 chat-md-live.tsx 抽取（markdown-it 单例 + hljs 围栏 + mermaid 双重惰性 + GFM 任务列表
 * 后处理 + 复制钮命令式注入，DOM 形状不变），两处新增：
 *  - frontmatterToYamlFence（Penraft markdown-utils 思路）：文件首部 `---` YAML → ```yaml 围栏，
 *    文件预览开启（SKILL.md/README 类首部 frontmatter 不再渲成 hr/setext 杂讯）；chat 消息不开。
 *  - interceptLinkClicks：markdown-it（linkify）产 `<a href>`，PanelViewController 无 decidePolicyFor
 *    ——不拦截则点击 = 共享 WKWebView 主 frame 被导航走人（整个面板死掉）。容器级拦截：恒
 *    preventDefault；`#` 内锚按标题文本滚动；http(s) 外链 best-effort `window.open`（native-gap：
 *    无外开 URL 桥动作，WKWebView 未实装 createWebViewWith 时静默无效，与 ChatHistoryLive
 *    onLearnMore 同款兜底；正解 = 后批加 NSWorkspace.open 桥动作）；其余 scheme 一律吞掉。
 */

import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { copyText } from '../screen/chat/live/clipboard';
import './markdown-view.css';

let mdInstance: MarkdownIt | null = null;

/** 惰性单例（首次 live 渲染时构造，避免动态 import 后重复建实例） */
export function getRenderer(): MarkdownIt {
  if (mdInstance) return mdInstance;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    highlight(code: string, lang: string): string {
      // chat-history.md §5：hljs 认识 lang → <pre class="hljs"><code>{token spans}</code></pre>；
      //     不认识 / 无 lang → escapeHtml 纯文本（同 <pre class="hljs">，无 copy button）。
      if (lang && hljs.getLanguage(lang)) {
        try {
          const inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          return `<pre class="hljs"><code>${inner}</code></pre>`;
        } catch {
          /* 落到下方转义分支 */
        }
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
    },
  });
  // W11 围栏定制：```mermaid 出 `<div class="mermaid">转义源码</div>`（挂载后 effect 交 mermaid 渲染），
  // 其余语言仍走默认围栏渲染器（内部调上面的 highlight 回调 → `<pre class="hljs">`）。
  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = tokens[idx].info ? tokens[idx].info.trim() : '';
    const lang = info.split(/\s+/)[0];
    if (lang === 'mermaid') {
      return `<div class="mermaid">${md.utils.escapeHtml(tokens[idx].content)}</div>`;
    }
    return defaultFence(tokens, idx, options, env, self);
  };
  mdInstance = md;
  return md;
}

/** GFM task list 后处理（markdown-it 原生不产复选框）：li 首 [ ]/[x] → 禁用态复选框 */
export function gfmTaskLists(html: string): string {
  return html
    .replace(/<li>\[ \]\s?/g, '<li class="task-list-item"><input type="checkbox" disabled> ')
    .replace(/<li>\[[xX]\]\s?/g, '<li class="task-list-item"><input type="checkbox" checked disabled> ');
}

/** 文件首部 YAML frontmatter（`---\n...\n---`）→ ```yaml 围栏（Penraft markdown-utils.ts 同款正则思路）。 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
export function frontmatterToYamlFence(md: string): string {
  const m = FRONTMATTER_RE.exec(md);
  if (!m) return md;
  return '```yaml\n' + m[1] + '\n```\n' + md.slice(m[0].length);
}

/** 每个代码块（pre）命令式注入「复制」钮（W11）。已注入的（data-copy-injected）跳过，幂等。 */
export function injectCopyButtons(container: HTMLElement): void {
  const pres = container.querySelectorAll<HTMLPreElement>('pre:not([data-copy-injected])');
  pres.forEach((pre) => {
    pre.setAttribute('data-copy-injected', 'true');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-copy-btn';
    btn.textContent = '复制';
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 不触发工具块折叠/卡片选中等祖先 click
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
      void copyText(code).then((ok) => {
        if (!ok) return;
        btn.textContent = '已复制';
        window.setTimeout(() => {
          btn.textContent = '复制';
        }, 1500);
      });
    });
    pre.appendChild(btn);
  });
}

// mermaid 双重惰性：本模块已由 live 容器动态 import；mermaid 再仅在遇 `.mermaid` 围栏时动态 import。
let mermaidMod: Promise<typeof import('mermaid')> | null = null;
let mermaidInited = false;

async function ensureMermaid(): Promise<(typeof import('mermaid'))['default']> {
  if (!mermaidMod) mermaidMod = import('mermaid');
  const mermaid = (await mermaidMod).default;
  if (!mermaidInited) {
    mermaidInited = true;
    const rootTheme = document.documentElement.getAttribute('data-theme');
    const dark =
      rootTheme === 'dark' ||
      (rootTheme == null && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      suppressErrorRendering: true, // 语法错时抛而非注入错误图 → 下方 catch 静默留源码
    });
  }
  return mermaid;
}

/** 容器内未处理的 `.mermaid`（run 后带 data-processed）交 mermaid 渲染；失败静默留源码文本。 */
export async function renderMermaid(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'));
  if (nodes.length === 0) return;
  try {
    const mermaid = await ensureMermaid();
    await mermaid.run({ nodes });
  } catch {
    /* 渲染失败：静默——.mermaid 内保留转义源码文本 */
  }
}

/**
 * 容器级锚点拦截（模块头注「新增②」）。挂 container click（冒泡相，链接点击必经），返回卸载函数。
 * 恒 preventDefault——共享 WKWebView 的主 frame 绝不允许被 <a> 导航。
 */
export function interceptLinkClicks(container: HTMLElement): () => void {
  const onClick = (e: MouseEvent): void => {
    const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
    if (!anchor || !container.contains(anchor)) return;
    e.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      // 页内锚：markdown-it 无 heading-id 插件 → best-effort 按标题文本匹配滚动（slug 连字符还原空格）。
      const name = decodeURIComponent(href.slice(1)).replace(/-/g, ' ').trim().toLowerCase();
      const heading = Array.from(container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(
        (h) => (h.textContent ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === name,
      );
      heading?.scrollIntoView({ block: 'start' });
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
    // 其余 scheme（file:/mailto:/相对路径）：吞掉（无安全外开通道）。
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

/** 文件预览 markdown 查看组件：`.markdown-view` 排版容器 + frontmatter 围栏 + 全套挂载 effect。 */
function MarkdownView({ text }: { text: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => gfmTaskLists(getRenderer().render(frontmatterToYamlFence(text ?? ''))), [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    injectCopyButtons(el);
    void renderMermaid(el);
  }, [html]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return interceptLinkClicks(el);
  }, []);
  return createElement('div', {
    className: 'markdown-view',
    ref,
    dangerouslySetInnerHTML: { __html: html },
  });
}

/**
 * 文件预览渲染入口。签名 = FileTabsView 的 `renderMd?: (text) => ReactNode`（LiveFileTabsView 动态
 * import 后注入；静态/golden 路径不传 → MarkdownBody 走 md-static fallback，逐字节不变）。
 */
export function renderFileMarkdown(text: string): ReactNode {
  return createElement(MarkdownView, { text });
}
