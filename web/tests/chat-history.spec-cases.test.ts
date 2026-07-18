// M2 B5 spec 翻牌：聊天历史三栏（CHAT_L1_09/10/11/15）。
// l1/chat 为混里程碑 spec 文件（M2/M5 混）→ 逐条 test('ID: ...')，严禁 test.each 注入。
//
// ⚠️ 实况偏差（specs/behavior/chat-history.md §0，断言以 legacy 实渲染为准）：
//   CHAT_L1_10：spec fields 含 toolCallCount，为零消费 stub（chat/session-card-config.ts）；
//     legacy 卡片右下实渲染 fileSize（SessionList.tsx:269）。
//   CHAT_L1_11：spec codeBlock 写 "syntax highlight + copy button"；高亮真实存在
//     （markdown-it+hljs），copy button 在 legacy 实渲染中不存在（MarkdownPreview 无该钮）。
//   CHAT_L1_15：spec 文案 '还没有聊天记录...' 为零消费 stub（chat/empty-state.ts）；
//     实渲染 '暂无会话记录'（SessionList.tsx:360 + zh.ts:31，检查点⑥裁决 Tier-B）。
//
// 断言面 = 真实工件：web/src/screen/chat/chat.css 原文 + ChatHistoryScreen 真实渲染
// （renderToStaticMarkup，tile-css/config-empty-state 先例）+ formatTime 纯函数（now 注入）。
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import chatSpec from '../../specs/legacy/l1/chat.spec.json';
import { ChatHistoryScreen, formatTime, formatFileSize } from '../src/screen/chat/ChatHistoryScreen';

type SpecCase = Record<string, any>;

function caseOf(id: string): SpecCase {
  const c = (chatSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

const chatCss = readFileSync(new URL('../src/screen/chat/chat.css', import.meta.url), 'utf8');

function cssBlock(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return re.exec(chatCss)?.[1] ?? '';
}

/** chat-full 同构 fixture（детail 满载：user/assistant 气泡 + 工具块展开 + bash 代码块） */
const fullFx = {
  id: 'spec-chat',
  theme: 'dark',
  screen: 'chat-history',
  chat: {
    banner: false,
    selected: 's1',
    expandToolCall: true,
    search: null,
    projects: [
      {
        projectHash: '-Users-rl-dev-muxvo',
        displayPath: '/Users/rl/dev/muxvo',
        displayName: 'muxvo',
        sessionCount: 1,
        totalSize: 245760,
        lastActivity: '2026-06-01T06:30:00.000Z',
      },
    ],
    sessions: [
      {
        sessionId: 's1',
        projectHash: '-Users-rl-dev-muxvo',
        title: 'fix: PTY spawn ENOENT 崩溃排查与修复',
        startedAt: '2026-06-01T06:21:00.000Z',
        lastModified: '2026-06-01T06:30:00.000Z',
        fileSize: 245760,
        source: 'claude-code',
        cwd: '/Users/rl/dev/muxvo',
      },
    ],
    messages: [
      {
        uuid: 'u1',
        type: 'user',
        sessionId: 's1',
        cwd: '/Users/rl/dev/muxvo',
        timestamp: '2026-06-01T06:21:05.000Z',
        content: '终端启动偶发崩溃，帮我排查',
      },
      {
        uuid: 'a1',
        type: 'assistant',
        sessionId: 's1',
        cwd: '/Users/rl/dev/muxvo',
        timestamp: '2026-06-01T06:23:18.000Z',
        content: [
          { type: 'text', text: '补丁如下：\n\n```bash\n# 校验 cwd 存在后再 spawn\nnpm run preflight\n```' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls -la /tmp/muxvo' } },
        ],
      },
    ],
  },
};

test('CHAT_L1_09: 三栏默认布局 -- 左栏 220px, 中栏 340px, 右栏 flex', () => {
  const c = caseOf('CHAT_L1_09');
  const expected = c.expectedValue as { left: string; middle: string; right: string };

  // 1) chat.css 实工件 = spec 期望（expected 全部取自冻结 spec JSON）
  const left = /width:\s*([^;]+);/.exec(cssBlock('.chat-history-panel__left'))?.[1].trim();
  const middle = /width:\s*([^;]+);/.exec(cssBlock('.chat-history-panel__middle'))?.[1].trim();
  expect(left).toBe(expected.left);
  expect(middle).toBe(expected.middle);
  // 右栏 spec 记号 'flex' = 实工件 flex: 1
  expect(expected.right).toBe('flex');
  const rightFlex = /(?:^|;)\s*flex:\s*([^;]+);/.exec(cssBlock('.chat-history-panel__right'))?.[1].trim();
  expect(rightFlex).toBe('1');

  // 2) 屏组件实际渲染三栏容器类（css 消费点）
  const html = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: fullFx }));
  expect(html).toContain('chat-history-panel__left');
  expect(html).toContain('chat-history-panel__middle');
  expect(html).toContain('chat-history-panel__right');
});

test('CHAT_L1_10: 会话卡片默认字段 -- 标题/时间/预览/标签/tool calls 数', () => {
  const c = caseOf('CHAT_L1_10');
  const expected = c.expectedValue as { fields: string[]; timeFormat: string; previewTruncate: string };
  // spec 锚定
  expect(expected.fields).toEqual(['title', 'time', 'preview', 'tags', 'toolCallCount']);
  expect(expected.timeFormat).toBe('today:HH:MM / yesterday / MM-DD');
  expect(expected.previewTruncate).toBe('2 lines');

  // 1) 卡片实渲染字段：title/time/preview/tags 四字段真实存在
  const html = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: fullFx }));
  expect(html).toContain('session-card__title');
  expect(html).toContain('session-card__time');
  expect(html).toContain('session-card__preview');
  expect(html).toContain('session-card__tags');
  // 偏差（头注）：第五字段实渲染为 fileSize，非 toolCallCount
  expect(html).toContain(`<span class="session-card__count">${formatFileSize(245760)}</span>`);
  expect(formatFileSize(245760)).toBe('240KB');

  // 2) timeFormat 实况（now 注入定死，TZ 无关）：今天 HH:MM / 昨天 HH:MM / MM-DD HH:MM
  const now = new Date(2026, 5, 1, 20, 0, 0); // 本地 2026-06-01 20:00
  expect(formatTime(new Date(2026, 5, 1, 14, 30).getTime(), now)).toBe('今天 14:30');
  expect(formatTime(new Date(2026, 4, 31, 9, 15).getTime(), now)).toBe('昨天 09:15');
  expect(formatTime(new Date(2026, 4, 18, 22, 0).getTime(), now)).toBe('05-18 22:00');

  // 3) previewTruncate '2 lines' = 实工件 -webkit-line-clamp: 2
  expect(cssBlock('.session-card__preview')).toMatch(/-webkit-line-clamp:\s*2;/);
});

test('CHAT_L1_11: 会话详情消息渲染 -- user 右侧气泡, assistant 左侧气泡, 代码块高亮', () => {
  const c = caseOf('CHAT_L1_11');
  // spec 锚定
  expect(c.expectedUI.userMessage).toBe('right bubble, accent background');
  expect(c.expectedUI.assistantMessage).toBe('left bubble, elevated background');
  expect(c.expectedUI.codeBlock).toBe('syntax highlight + copy button');

  // 1) 气泡布局实工件：user 右对齐 #3b82f6 底、assistant 左对齐 elevated 底
  expect(cssBlock('.message-bubble--user')).toMatch(/align-items:\s*flex-end;/);
  expect(cssBlock('.message-bubble--user .message-bubble__content')).toMatch(/background:\s*#3b82f6;/);
  expect(cssBlock('.message-bubble--assistant')).toMatch(/align-items:\s*flex-start;/);
  expect(cssBlock('.message-bubble--assistant .message-bubble__content')).toMatch(
    /background:\s*var\(--bg-elevated\);/,
  );

  // 2) 实渲染：两类气泡 + hljs 代码块（markdown-it 链路产物形状）
  const html = renderToStaticMarkup(createElement(ChatHistoryScreen, { fx: fullFx }));
  expect(html).toContain('message-bubble--user');
  expect(html).toContain('message-bubble--assistant');
  expect(html).toContain('<pre class="hljs">');
  expect(html).toContain('<span class="hljs-comment"># 校验 cwd 存在后再 spawn</span>');
  // 偏差（头注）：copy button 不存在于 legacy 实渲染
  expect(html).not.toMatch(/copy/i);
});

test('CHAT_L1_15: 空状态(无 projects) -- legacy 实渲染「暂无会话记录」', () => {
  const c = caseOf('CHAT_L1_15');
  // spec 锚定：case 确为 noProjects 空态；其 stub 文案与实渲染的偏差见头注
  expect(c.state).toBe('emptyState_noProjects');
  expect(c.expectedUI.message).toBe('还没有聊天记录...');

  const html = renderToStaticMarkup(
    createElement(ChatHistoryScreen, {
      fx: {
        id: 'spec-chat-empty',
        theme: 'dark',
        screen: 'chat-history',
        chat: { banner: false, selected: null, search: null, projects: [], sessions: [], messages: [] },
      },
    }),
  );
  // legacy 实渲染（SessionList.tsx:360 + zh.ts:31）
  expect(html).toContain('session-list__empty');
  expect(html).toContain('暂无会话记录');
  // 不渲染 spec stub 文案（偏差是单向的：实渲染 ≠ spec 期望）
  expect(html).not.toContain('还没有聊天记录');
  // 右栏保持未选中空态
  expect(html).toContain('选择一个会话查看详情');
});
