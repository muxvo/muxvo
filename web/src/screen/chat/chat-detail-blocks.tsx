/**
 * 会话详情降噪的折叠展示组件（dogfood-r4 问题4，live-only）。
 *
 * 纯展示 + 纯函数：无 markdown-it/hljs 等重依赖 import（markdown 渲染函数经 `render` prop 传入，
 * 由 ChatHistoryScreen 侧的 live 渲染核提供）——本文件可进主 bundle 无污染，也不牵动截图 chunk。
 * 三个折叠壳复刻 `ToolCallBlock` 结构（header 点击展开 / 默认折叠 / 图标 ▶▼），样式落 live 专属
 * `live/chat-live.css`（golden/静态路径不加载）：
 *  - `SystemFoldBlock`：system 字符串消息（system-reminder/命令/队友消息/shell…）折叠成一行摘要，
 *    展开体是**纯文本**（pre-wrap + 搜索高亮），不渲 markdown。
 *  - `ThinkingBlock`：thinking 块折叠为「Thinking」，展开体走 markdown（`render`）。
 *  - `UnknownBlock`：未知块占位「不支持的块类型: {name}」，展开体 `<pre>` 原文 JSON。
 */

import type { ReactNode } from 'react';

// ── 系统消息分类（前缀判别；返回分类标签 + 默认展开态） ──

/**
 * 按内容前缀分类 system 字符串消息，给折叠壳一个人类可读标签 + 默认展开态。
 * 队友消息是人类可读对话 → 默认展开；其余噪声（提醒/命令/任务通知/shell）默认折叠。
 * 无前缀命中 → 空标签（仅「SYSTEM」）+ 折叠。
 */
export function classifySystemMessage(content: string): { label: string; defaultExpanded: boolean } {
  const t = content.trimStart();
  if (t.startsWith('<system-reminder>')) return { label: '提醒', defaultExpanded: false };
  if (t.startsWith('<command-name>') || t.startsWith('<command-message>'))
    return { label: '命令', defaultExpanded: false };
  if (t.startsWith('<task-notification>')) return { label: '任务通知', defaultExpanded: false };
  if (t.startsWith('<teammate-message')) return { label: '队友消息', defaultExpanded: true };
  if (/^(cd\s|bindkey\s)/.test(t)) return { label: 'shell', defaultExpanded: false };
  return { label: '', defaultExpanded: false };
}

/** 首个非空行（trim 后），作折叠头摘要（CSS 单行 ellipsis 裁，JS 不截字，保搜索全文可命中）。 */
function firstNonEmptyLine(content: string): string {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 纯文本搜索高亮（ChatHistoryScreen 的 Highlight 同构；本文件自持一份避免跨模块循环 import）。 */
function HighlightText({ text, query }: { text: string; query: string }): JSX.Element {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="search-highlight">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

// ── 折叠壳 ──

/**
 * system 字符串消息折叠壳。header = ▶/▼ + SYSTEM + 分类标签 + 首行摘要（CSS ellipsis）；
 * 展开体纯文本（pre-wrap，沿用 `.message-bubble__text` 口径 + Highlight，**不渲 markdown**）。
 * `highlight` 命中时由调用方强制展开（保「DOM mark 数=枚举命中数」不变量，W6）。
 */
export function SystemFoldBlock({
  content,
  label,
  expanded,
  onToggle,
  highlight,
}: {
  content: string;
  label: string;
  expanded: boolean;
  onToggle?: () => void;
  highlight?: string;
}): JSX.Element {
  const summary = firstNonEmptyLine(content);
  return (
    <div className="system-fold">
      <div className="system-fold__header" onClick={onToggle}>
        <span className="system-fold__icon">{expanded ? '▼' : '▶'}</span>
        <span className="system-fold__label">SYSTEM{label ? ` · ${label}` : ''}</span>
        <span className="system-fold__summary">{summary}</span>
      </div>
      {expanded && (
        <div className="system-fold__body">
          {highlight ? <HighlightText text={content} query={highlight} /> : content}
        </div>
      )}
    </div>
  );
}

/** thinking 块折叠壳。header = ▶/▼ Thinking；展开体走 markdown（`render`，包 `.markdown-preview`）。 */
export function ThinkingBlock({
  text,
  expanded,
  onToggle,
  render,
}: {
  text: string;
  expanded: boolean;
  onToggle?: () => void;
  render: (text: string) => ReactNode;
}): JSX.Element {
  return (
    <div className="thinking-block">
      <div className="thinking-block__header" onClick={onToggle}>
        <span className="thinking-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="thinking-block__label">Thinking</span>
      </div>
      {expanded && <div className="thinking-block__content markdown-preview">{render(text)}</div>}
    </div>
  );
}

/** 未知块占位壳。header = ▶/▼ 不支持的块类型: {name}；展开体 `<pre>` 原文 JSON（不丢数据）。 */
export function UnknownBlock({
  name,
  raw,
  expanded,
  onToggle,
}: {
  name: string;
  raw: string;
  expanded: boolean;
  onToggle?: () => void;
}): JSX.Element {
  return (
    <div className="unknown-block">
      <div className="unknown-block__header" onClick={onToggle}>
        <span className="unknown-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="unknown-block__label">不支持的块类型: {name}</span>
      </div>
      {expanded && <pre className="unknown-block__content">{raw}</pre>}
    </div>
  );
}
