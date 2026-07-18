/**
 * chat 面板发射面（chat-history.md §7.6/§7.7）：从会话/交互推出 `ui.action` 的**纯函数**。
 * native 半在 M5 批3 已落（TerminalService.handleAction 的 chatClose/chatJumpToTerminal/chatResume）——
 * 本模块只管 web 半的发射构造。纯函数、无 React：node 直测发射面（不必渲染 live 组件）。
 *
 * 跳转/续聊/关闭**不走 chat.request** 五 kind；是 `ui.action` 的 fire-and-forget event（§7.1 备注、§7.7）。
 */

import type { ChatSource, UIAction } from '../../../bridge/gen/protocol';

/**
 * source 回传 camel（§7.7）：screen 侧 source 是 kebab（`'claude-code'`），wire `ChatSource` 是 camel。
 * `'codex'` 恒等；其余（`'claude-code'`/`'claudeCode'`/缺席）→ `'claudeCode'`。
 */
export function sourceToCamel(source: string | undefined): ChatSource {
  return source === 'codex' ? 'codex' : 'claudeCode';
}

/**
 * 双击卡片跳转（§7.7② / CHAT_L1_18 / T09）→ `chatJumpToTerminal`。
 * cwd 缺席 → native 决策 `.closeOnly`（仅关面板，§7.7 native 半）。面板关闭由 native 无条件执行。
 */
export function chatJumpAction(session: { sessionId: string; cwd?: string }): UIAction {
  return { kind: 'chatJumpToTerminal', sessionId: session.sessionId, cwd: session.cwd };
}

/** Esc / 关闭钮（§7.6 / CHAT_L1_14_close）→ `chatClose`。native 半 setPanelMode(.terminal)。 */
export function chatCloseAction(): UIAction {
  return { kind: 'chatClose' };
}

/**
 * 继续聊天（§7.7 REQ-CHAT_BROWSE-027）→ `chatResume`。source 回传 camel（kebab→camel，§7.7）。
 * 调用点须先过 live canResume 判据（source∈{cc,codex} 且 cwd 非空 且消息已加载 且 !archiveOnly）。
 */
export function chatResumeAction(session: {
  sessionId: string;
  cwd: string;
  source: string | undefined;
  customTitle?: string;
}): UIAction {
  return {
    kind: 'chatResume',
    sessionId: session.sessionId,
    cwd: session.cwd,
    source: sourceToCamel(session.source),
    customTitle: session.customTitle,
  };
}

/** 去尾斜杠归一（根 "/" 保留），与 native normalizeCwd 同口径（TerminalService.swift:887-891）。 */
export function normalizeCwd(path: string): string {
  let s = path.trim();
  while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * cwd 前缀匹配（W9 / CHAT_L1_18 §7.7②，m-2）：终端 cwd 以 session.cwd 为前缀或相等——含 worktree 子目录
 * （session 在项目根、终端在其 worktree 子目录 → 命中）。按**路径分量边界**匹配（`/a/proj` 不误配 `/a/proj-x`），
 * 两侧去尾斜杠归一，空 session.cwd 恒不命中。与 native `cwdPrefixMatches` 逐字同口径（TerminalService.swift:878-891）
 * ——web 双击判定必须与 native jump 行为一致，否则 /repo 会话 vs /repo/worktree-x 终端、尾斜杠差异会分叉。
 */
export function cwdPrefixMatches(sessionCwd: string, terminalCwd: string): boolean {
  const base = normalizeCwd(sessionCwd);
  const term = normalizeCwd(terminalCwd);
  if (base === '') return false;
  return term === base || term.startsWith(base + '/');
}

/**
 * 双击卡片决策（缺陷 W9，用户拍板 2026-07-07；单击=打开详情、双击=聚焦/续聊，防误触去抖在容器侧）：
 *  - 有匹配活体终端（cwd 前缀匹配 native 口径 且状态非 Stopped/Removed）→ `chatJumpToTerminal`（聚焦跳转）
 *  - 否则 cwd 可解析 → `chatResume`（继续聊天，cwd/source/customTitle 与既有 resume 链同口径）
 *  - cwd 不可解析 → `chatJumpToTerminal` 保底（cwd 缺席 → native 决策 `.closeOnly`）
 * 纯函数、无 React：node 直测。terminals.state 取 fixture 宽松串（协议 10 枚举 + 注入容错）。
 */
export function pickDoubleClickAction(
  session: { sessionId: string },
  resumeCtx: { cwd: string; source: string | undefined; customTitle?: string },
  terminals: readonly { cwd: string; state: string }[],
): UIAction {
  const cwd = resumeCtx.cwd.trim();
  if (cwd === '') {
    // cwd 不可解析：跳转保底（cwd 缺席 → native .closeOnly）。
    return chatJumpAction({ sessionId: session.sessionId });
  }
  const hasLiveTerminal = terminals.some(
    (t) => t.state !== 'Stopped' && t.state !== 'Removed' && cwdPrefixMatches(cwd, t.cwd),
  );
  return hasLiveTerminal
    ? chatJumpAction({ sessionId: session.sessionId, cwd })
    : chatResumeAction({
        sessionId: session.sessionId,
        cwd,
        source: resumeCtx.source,
        customTitle: resumeCtx.customTitle,
      });
}
