/**
 * chat 消息 markdown 静态渲染（specs/behavior/chat-history.md §5）。
 * 输出 DOM 与 legacy MarkdownPreview（markdown-it {html:false,linkify,typographer} + hljs）
 * 渲染产物一致——**不是** tiptap 形状（md-static.tsx，如紧列表 li>p），故不复用其块级逻辑；
 * 行内 **strong** / `code` 两侧 tag 相同，复用 md-static 的 renderInline。
 * 覆盖 fixture 子集：段落、行内 code/strong、紧 `- ` 列表（markdown-it 出 li 直含文本）、
 * ```bash 围栏（hljs bash 注释行 → span.hljs-comment，其余行纯文本；实测 legacy 输出）。
 */

import type { ReactNode } from 'react';
import { renderInline } from '../md-static';

/** ```bash 围栏体 → hljs 产物（fixture 子集：# 注释行着色，其余纯文本） */
function renderBashCode(code: string): ReactNode[] {
  const lines = code.split('\n');
  return lines.map((line, i) => {
    const nl = i < lines.length - 1 ? '\n' : '';
    if (line.startsWith('#')) {
      return (
        <span key={i}>
          <span className="hljs-comment">{line}</span>
          {nl}
        </span>
      );
    }
    return <span key={i}>{line + nl}</span>;
  });
}

export function renderChatMarkdown(md: string): ReactNode[] {
  const lines = md.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // 收尾 ```
      // markdown-it 围栏体保留结尾换行（"…\n"），textContent 须一致
      const body = code.join('\n') + '\n';
      out.push(
        <pre key={key++} className="hljs">
          <code>{lang === 'bash' ? renderBashCode(body) : body}</code>
        </pre>,
      );
    } else if (line.startsWith('- ')) {
      // markdown-it 紧列表：li 直含行内内容（无内层 p——与 tiptap 形状的关键差异）
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <ul key={key++}>
          {items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>,
      );
    } else {
      // 段落：连续非空行合并（fixture 子集单行段落）
      const para: string[] = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !lines[i].startsWith('- ')) {
        para.push(lines[i]);
        i++;
      }
      out.push(<p key={key++}>{renderInline(para.join('\n'))}</p>);
    }
  }
  return out;
}
