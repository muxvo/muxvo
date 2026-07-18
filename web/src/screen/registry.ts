/**
 * 屏注册表（M2 任务4）：fixture.screen → 渲染组件，缺省 'terminal-grid'。
 * 各批次复刻新屏时在此登记；新屏组件一律纯 props 吃 ResolvedFixture，永不 mock IPC
 * （按屏 payload 形状登记于 tools/visual-diff/fixtures/_CONTRACT.md）。
 * fx 形状按屏各异，注册表层面放宽为 any；各屏组件内部自行收紧类型。
 */
import type { ComponentType } from 'react';
import { TerminalScreen } from './TerminalScreen';
import { SearchBarScreen } from './popover/SearchBarScreen';
import { CwdPickerScreen } from './popover/CwdPickerScreen';
import { WorktreePopoverScreen } from './popover/WorktreePopoverScreen';
import { SettingsModalScreen } from './modal/SettingsModalScreen';
import { LoginModalScreen } from './modal/LoginModalScreen';
import { WorkspaceManagerScreen } from './modal/WorkspaceManagerScreen';
import { WhatsNewModalScreen } from './modal/WhatsNewModalScreen';
import { CloseConfirmScreen } from './modal/CloseConfirmScreen';
import { MenuBarScreen } from './menubar/MenuBarScreen';
import { SkillsPanelScreen } from './panels/SkillsPanelScreen';
import { McpPanelScreen } from './panels/McpPanelScreen';
import { HooksPanelScreen } from './panels/HooksPanelScreen';
import { PluginsPanelScreen } from './panels/PluginsPanelScreen';
import { FilePanelScreen } from './file/FilePanelScreen';
import { FileTabsViewScreen } from './filetabs/FileTabsViewScreen';
import { ChatHistoryScreen } from './chat/ChatHistoryScreen';
import { WelcomeOverlayScreen } from './tour/WelcomeOverlayScreen';
import { TourOverlayScreen } from './tour/TourOverlayScreen';
import { TaskCenterScreen } from './taskcenter/TaskCenterScreen';

// eslint 无此仓库；any 为注册表边界的刻意放宽，见头注释
export const SCREEN_REGISTRY: Record<string, ComponentType<{ fx: any }>> = {
  'terminal-grid': TerminalScreen,
  'terminal-search-bar': SearchBarScreen,
  'cwd-picker': CwdPickerScreen,
  'worktree-popover': WorktreePopoverScreen,
  'settings-modal': SettingsModalScreen,
  'login-modal': LoginModalScreen,
  'workspace-manager-modal': WorkspaceManagerScreen,
  'whats-new-modal': WhatsNewModalScreen,
  'close-confirm-dialog': CloseConfirmScreen,
  'menu-bar': MenuBarScreen,
  'user-dropdown': MenuBarScreen, // = menu-bar + 下拉 open 终态（同组件按 screen 分流）
  'skills-panel': SkillsPanelScreen,
  'mcp-panel': McpPanelScreen,
  'hooks-panel': HooksPanelScreen,
  'plugins-panel': PluginsPanelScreen,
  'file-panel': FilePanelScreen,
  // M6-B：tab 式文件视图（替换退役的三栏 FileTempView，golden 权威 = 用户巡检冻结）
  'file-tabs-view': FileTabsViewScreen,
  'chat-history': ChatHistoryScreen,
  'welcome-overlay': WelcomeOverlayScreen,
  'tour-overlay': TourOverlayScreen,
  // M4a 批4：任务控制中心（orch 新屏，无 legacy 对照；golden 权威 = ★A5 用户肉眼冻结）
  'task-center': TaskCenterScreen,
};

/**
 * 浮层/modal 屏就位选择器：__fixtureReady 须等目标终态元素在 DOM 后才置位（与 golden 侧
 * fixture-main 同款把关；挂不出来 = capture 超时红，防截到中间态/空图假绿）。
 * B2 起支持按 fixture 取选择器（settings update 态须等滚动到底标记 data-fx-scrolled）。
 */
export const SCREEN_READY_SELECTOR: Record<string, string | ((fx: any) => string)> = {
  'terminal-search-bar': '.terminal-search-bar',
  'cwd-picker': '.cwd-picker',
  'worktree-popover': '.worktree-popover__list',
  'settings-modal': (fx) =>
    fx.settings?.update
      ? '.settings-modal[data-fx-scrolled]'
      : fx.settings?.config?.dockBadgeMode === 'timed'
        ? '.settings-modal__badge-sub-row'
        : '.settings-modal',
  'login-modal': (fx) =>
    fx.login?.mode === 'login' ? '.login-modal__email-form' : '.login-modal__oauth-btn--email',
  'workspace-manager-modal': (fx) =>
    fx.workspace?.editing ? '.ws-manager__name-input' : '.ws-manager',
  'whats-new-modal': (fx) =>
    fx.whatsNew?.expanded?.length ? '.whats-new__older-content' : '.whats-new__modal',
  'close-confirm-dialog': '.close-confirm-dialog',
  // B3：与 golden 侧 fixture-main B3_READY_SELECTOR 同款终态把关
  'menu-bar': (fx) =>
    fx.update ? '.update-progress' : fx.auth ? '.user-dropdown__trigger' : '.menu-bar',
  'user-dropdown': '.user-dropdown__menu',
  'skills-panel': (fx) =>
    fx.skills?.dirty
      ? '.skills-panel__editor-dirty'
      : fx.skills?.selected
        ? '.markdown-wysiwyg .tiptap h1'
        : '.skill-list__empty',
  'mcp-panel': (fx) => (fx.mcp?.form ? '.mcp-panel__form' : '.mcp-panel__detail'),
  'hooks-panel': (fx) => (fx.hooks?.form ? '.hooks-panel__form' : '.hooks-panel__detail'),
  'plugins-panel': (fx) =>
    fx.plugins?.error ? '.plugin-panel__empty' : '.plugin-panel__detail',
  // B4：与 golden 侧 fixture-main B4_READY_SELECTOR 同款终态把关
  'file-panel': '.file-panel__content[data-fx-ready]',
  // M6-B：tab 式文件视图终态把关——dialog 态等对话框；md 活跃（WYSIWYG）等 tiptap h1；缺省壳就位
  'file-tabs-view': (fx) => {
    const f = fx.fileTabs;
    if (f?.dialog) return '.unsaved-prompt-dialog';
    const active = f?.tabs?.find((t: any) => t.path === f.activeId);
    if (active?.fileType === 'markdown' && !active.mdSource) return '.markdown-wysiwyg .tiptap h1';
    return '.file-tabs-view';
  },
  // B5：静态渲染无 golden 侧 virtuoso 竞态，直接以终态元素把关
  // （golden 侧 selected 走 driver 稳定闸 data-fx-chat-stable，_CONTRACT B5 段）
  'chat-history': (fx) => {
    const c = fx.chat;
    if (c?.detailPending) return '.session-detail__skeleton';
    if (c?.search) return '.search-input-wrap__result-count';
    if (c?.expandToolCall) return '.tool-call-block__content';
    if (c?.selected) return '.session-detail__resume-bar';
    if (!c?.sessions?.length) return '.session-list__empty';
    return '.chat-history-panel';
  },
  // B6：welcome 静态终态；tour 等 driver.js spotlight 稳定闸戳记（气泡 rect + 挖孔 path[d]
  // 连续 30 帧不变后打逐 fixture 唯一标，与 golden 侧对称——_CONTRACT B6 段）
  'welcome-overlay': '.welcome-overlay__card',
  'tour-overlay': (fx) => `.app[data-fx-tour-ready="${fx.id}"]`,
  // M4a 批4：任务中心渲染即带 data-fx-ready（无异步 driver/virtuoso 竞态，纯 props 直渲终态）
  'task-center': '.task-center[data-fx-ready]',
};
