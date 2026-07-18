/**
 * live 面板注册入口（M6 批1 接缝）：LiveChrome 副作用 import 本文件，触发各 live 面板模块级
 * registerLivePanel 调用。**本文件是 A3 的登记面**——A3 交付面板时在下方按域追加副作用 import，
 * 无需改 LiveChrome.tsx / panelRegistry.ts。
 *
 * A3 追加示例（各自新建的 live 包装文件，模块顶层调 registerLivePanel）：
 *   import './SettingsPanelLive';   // registerLivePanel('settings', ...)
 *   import './SkillsPanelLive';     // registerLivePanel('skills', ...)
 *   import './McpPanelLive';        // registerLivePanel('mcp', ...)
 *   import './HooksPanelLive';      // registerLivePanel('hooks', ...)
 *   import './PluginsPanelLive';    // registerLivePanel('plugins', ...)
 *
 * 未追加前：注册表为空 → LiveChrome 渲染空槽（overlay 带 data-live-panel、内容 null）；
 * 路由/互斥/角标行为不受影响（A2 测试独立断言）。settings modal live 包装（SettingsModalLive）
 * 由 A2 交付，见本文件 A2 段。
 */

// —— A2（settings modal live 包装）——
import './registerSettingsPanel';

// —— A3（配置面板 live 组件）：在此追加 ——
import '../panels/live/SkillsPanelLive';
import '../panels/live/McpPanelLive';
import '../panels/live/HooksPanelLive';
import '../panels/live/PluginsPanelLive';
