/**
 * chat 消息 markdown **真渲染**（M5 live 运行时链路，specs/behavior/chat-history.md §5）。
 *
 * 与 chat-md-static.tsx 的关系：static 是 golden/截图路径的 fixture 子集静态复刻（逐字节冻结）；
 * 本模块是 live 路径的真渲染，**只由 live 容器 `await import()` 动态加载**——ChatHistoryScreen 不静态
 * import 本文件，故 markdown-it/hljs **不进截图 bundle**（铁律：截图 bundle 零感知）。
 *
 * 渲染核已抽至 `markdown/md-view.tsx` 共享（dogfood-r3 问题7：文件预览同吃一份 markdown-it+hljs+
 * mermaid+任务列表+锚点拦截；本模块保留 chat 专属壳）：`.markdown-live` 容器类不变、DOM 形状不变、
 * 公开 API `renderChatMarkdownLive(text, highlight?)` 不变——chat 测试/golden 全部原样。
 * chat 专属 = 搜索高亮 postprocess（W6，highlightHtml 包 `<mark class="search-highlight">`），
 * memo 依赖保持 [text, highlight] 原语（highlight 变即重算 html → 复制钮/mermaid effect 重跑，幂等）。
 *
 * 与 file-temp-view 的 tiptap/wysiwyg 是两条链路、两种 DOM 形状（§5）——本模块走 markdown-it，勿复用 tiptap。
 */

import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  getRenderer,
  gfmTaskLists,
  injectCopyButtons,
  interceptLinkClicks,
  renderMermaid,
} from '../../markdown/md-view';
import { highlightHtml } from './live/matchNav';

/**
 * live markdown 渲染块：innerHTML 注入 + 挂载后 effect（复制钮注入 + mermaid 渲染 + 锚点拦截——
 * linkify 产 `<a href>`，无拦截点击 = 共享 WKWebView 主 frame 被导航走人，md-view 头注）。
 */
function MarkdownLive({ text, highlight }: { text: string; highlight?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    const base = gfmTaskLists(getRenderer().render(text ?? ''));
    return highlight ? highlightHtml(base, highlight) : base;
  }, [text, highlight]);
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
    className: 'markdown-live',
    ref,
    dangerouslySetInnerHTML: { __html: html },
  });
}

/**
 * live markdown 渲染入口。签名 = ChatHistoryScreen 的 `MarkdownRenderer = (text, highlight?) => ReactNode`。
 * 返回 `<MarkdownLive>`（带 innerHTML 容器 div + effect），由 Screen 侧套进 `.markdown-preview`。
 * `highlight`（搜索 query）仅由 Screen 对**文本块**传入（工具块不传 → 无 mark，保 DOM mark 数=枚举命中数）。
 */
export function renderChatMarkdownLive(text: string, highlight?: string): ReactNode {
  return createElement(MarkdownLive, { text, highlight });
}
