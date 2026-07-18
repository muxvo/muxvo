/**
 * 极简 markdown → JSX 静态渲染器（B3 skills-panel 首用，B4 file-temp-view 复用）。
 * 输出 DOM 与 legacy tiptap（MarkdownWysiwyg）渲染产物一致——仅覆盖 fixture 用到的子集：
 * h1/h2、段落、- 列表（li>p）、```代码块、> 引用；行内 **bold** 与 `code`。
 */

import type { ReactNode } from 'react';

export function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export function renderMarkdown(md: string): ReactNode[] {
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
    if (line.startsWith('# ')) {
      out.push(<h1 key={key++}>{renderInline(line.slice(2))}</h1>);
      i++;
    } else if (line.startsWith('## ')) {
      out.push(<h2 key={key++}>{renderInline(line.slice(3))}</h2>);
      i++;
    } else if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // 收尾 ```
      out.push(
        <pre key={key++}>
          <code className={lang ? `language-${lang}` : undefined}>{code.join('\n')}</code>
        </pre>,
      );
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      out.push(
        <ul key={key++}>
          {items.map((it, j) => (
            <li key={j}>
              <p>{renderInline(it)}</p>
            </li>
          ))}
        </ul>,
      );
    } else if (line.startsWith('> ')) {
      out.push(
        <blockquote key={key++}>
          <p>{renderInline(line.slice(2))}</p>
        </blockquote>,
      );
      i++;
    } else {
      out.push(<p key={key++}>{renderInline(line)}</p>);
      i++;
    }
  }
  return out;
}
