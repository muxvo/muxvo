// AppMenuCommands：主菜单构建 + 字号缩放 action 归口（DOGFOOD_M3_05，terminal-input.md §8）。
//
// 断链 1 修复：老实现 buildMenu 只有 App→Quit，zoom 菜单项不存在，surface performKeyEquivalent 对
// 字号键 return false 后事件落空。本类补「显示(View)」菜单——放大/缩小/实际大小三项，键位经菜单系统
// 截获（surface 仍 return false 放行给菜单），action 走注入的 onZoom 闭包 → TerminalService.applyZoom
// （原生路径，与 web term.command zoom 两路归一于同一 projection.zoom；渲染原生、不过桥）。
//
// 可复用：AppDelegate（生产）与 e2e-harness（评测关）均以此建同一套菜单——harness 装配不经 AppDelegate，
// 故菜单构建独立成类，两处共用、单测直验（无需拉起整个 app）。
import AppKit
import MuxvoTerm

@MainActor
public final class AppMenuCommands: NSObject {
    private let onZoom: (UIStateProjection.ZoomDirection) -> Void
    private let onNewTerminal: () -> Void
    private let onNewWindow: () -> Void
    private let isNewTerminalEnabled: () -> Bool
    private let onToggleTaskCenter: () -> Void
    private let onToggleFilePanel: () -> Void
    private let onToggleChatHistory: () -> Void
    private let onToggleListMode: () -> Void
    private let onNewConsole: () -> Void
    private let onUsageAlertMenu: () -> Void
    private let usageAlertMenuTitle: () -> String
    private let showOrchMenus: Bool

    /// - Parameters:
    ///   - onZoom: 字号菜单 action 落点（生产 = TerminalService.applyZoom）。
    ///   - onNewTerminal: 「文件 → 新建终端 ⌘N」action 落点（DOGFOOD_M3_20；生产 = TerminalService
    ///     .createTerminalFromMenu，与 FAB / term.command create 同链）。加性默认 no-op → 既有构造零改动。
    ///   - isNewTerminalEnabled: 新建终端可用性（DOGFOOD_M3_20）：满员 false → validateMenuItem 置灰（与
    ///     FAB disabled 对齐）。加性默认恒 true（无门控）。
    ///   - onToggleTaskCenter: 「任务中心」菜单 action 落点（task-center-panel.md §1；生产 = AppDelegate
    ///     翻 panelMode → detach + TerminalService.setPanelMode 重推）。加性默认 no-op → 既有单参构造零改动。
    ///   - onToggleFilePanel: 「文件面板」⌘E action 落点（M6 批A；生产 = AppDelegate.toggleFilePanel +
    ///     开面板时 firstResponder 交 WKWebView）。加性默认 no-op → 既有构造零改动。
    ///   - onToggleChatHistory: 「聊天历史」菜单 action 落点（chat-history.md §7.6；生产 = AppDelegate 翻
    ///     panelMode(.chatHistory) → detach + TerminalService.setPanelMode 重推）。同为加性默认 no-op。
    ///   - onToggleListMode: 「列表模式」⌘⇧L action 落点（批B，term-list-mode.md；生产 = TerminalService
    ///     .toggleListMode 翻 List↔Tiling + 重推）。加性默认 no-op → 既有构造零改动。
    ///   - onNewConsole: 「文件 → 新建指挥台」action 落点（M4b' T6；生产 = ConsoleTerminalManager.open）。
    ///     加性默认 no-op → 既有构造零改动。
    ///   - onUsageAlertMenu: 「App → CC 用量预警」action 落点（usage-limit-alert.md §6；生产 =
    ///     StatusLineInstaller.handleMenuAction 按 selfCheck 分流启用/停用）。加性默认 no-op。
    ///   - usageAlertMenuTitle: 该菜单项标题（按安装态切换「启用…」/「停用」；validateMenuItem
    ///     每次弹开菜单重算）。加性默认恒「启用」。
    ///   - showOrchMenus: 编排入口菜单开关（上线批 2026-07-16，OrchGate 头注；生产传
    ///     OrchGate.isEnabled）。false = 不建「新建指挥台 ⌘⇧N」「任务中心 ⌘⇧T」两项（键位随
    ///     菜单项一并失效）。加性默认 true → 既有构造（e2e-harness/单测）零改动。
    public init(
        onZoom: @escaping (UIStateProjection.ZoomDirection) -> Void,
        onNewTerminal: @escaping () -> Void = {},
        onNewWindow: @escaping () -> Void = {},
        isNewTerminalEnabled: @escaping () -> Bool = { true },
        onToggleTaskCenter: @escaping () -> Void = {},
        onToggleFilePanel: @escaping () -> Void = {},
        onToggleChatHistory: @escaping () -> Void = {},
        onToggleListMode: @escaping () -> Void = {},
        onNewConsole: @escaping () -> Void = {},
        onUsageAlertMenu: @escaping () -> Void = {},
        usageAlertMenuTitle: @escaping () -> String = { "启用 CC 用量预警…" },
        showOrchMenus: Bool = true
    ) {
        self.onZoom = onZoom
        self.onNewTerminal = onNewTerminal
        self.onNewWindow = onNewWindow
        self.isNewTerminalEnabled = isNewTerminalEnabled
        self.onToggleTaskCenter = onToggleTaskCenter
        self.onToggleFilePanel = onToggleFilePanel
        self.onToggleChatHistory = onToggleChatHistory
        self.onToggleListMode = onToggleListMode
        self.onNewConsole = onNewConsole
        self.onUsageAlertMenu = onUsageAlertMenu
        self.usageAlertMenuTitle = usageAlertMenuTitle
        self.showOrchMenus = showOrchMenus
        super.init()
    }

    /// 装配主菜单：App 菜单（Quit）+ 显示菜单（字号缩放）。
    public func buildMainMenu() -> NSMenu {
        let mainMenu = NSMenu()

        // App 菜单（Quit）——沿用既有结构。
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        // CC 用量预警启用/停用（usage-limit-alert.md §6）：标题随安装态切换（validateMenuItem 重算，
        // autoenablesItems 默认 true 令每次弹开菜单必经该路）。原生菜单不在 web golden 范围，零冻结风险。
        let usageAlertItem = NSMenuItem(
            title: usageAlertMenuTitle(), action: #selector(usageAlertMenu(_:)), keyEquivalent: "")
        usageAlertItem.target = self
        appMenu.addItem(usageAlertItem)
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: "Quit \(AppInfo.displayName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q")
        appItem.submenu = appMenu

        // 文件（File）菜单（DOGFOOD_M3_20，2026-07-07 用户新增；legacy 无此菜单已核实）：App 后、编辑前。
        // 「新建终端 ⌘N」target=self、action=newTerminal → onNewTerminal（生产 createTerminalFromMenu，与 FAB
        // 同链直建）。autoenablesItems 默认 true → AppKit 每次弹开前经 validateMenuItem(本类) 按满员置灰。
        // surface 层 CommandKeyInterception 表无 N → 裸 Cmd+N 天然落菜单（不被终端 PTY 截走），此为有意行为变化。
        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        let newTerminalItem = NSMenuItem(
            title: "新建终端", action: #selector(newTerminal(_:)), keyEquivalent: "n")
        newTerminalItem.keyEquivalentModifierMask = [.command] // 裸 Cmd+N
        newTerminalItem.target = self
        fileMenu.addItem(newTerminalItem)
        // 新建窗口（multi-window.md §1.1 裁决①，2026-07-11）：⌥⌘N（keyEquivalent "n" + [.command,.option]，
        // 与「新建终端 ⌘N」/「新建指挥台 ⌘⇧N」区分）。原生菜单动作 → onNewWindow（生产 = WindowManager.newWindow
        // 完整竖切）。autoenablesItems 默认 true，validateMenuItem 对本 selector 恒放行（无满员门控——全局 40
        // 满时新窗仍可开，其默认终端 spawn 侧 .rejected 兜底）。
        let newWindowItem = NSMenuItem(
            title: "新建窗口", action: #selector(newWindow(_:)), keyEquivalent: "n")
        newWindowItem.keyEquivalentModifierMask = [.command, .option]
        newWindowItem.target = self
        fileMenu.addItem(newWindowItem)
        // 新建指挥台（M4b' T6，command-console.md §1）：Cmd+Shift+N。spawn 一个普通 Muxvo 终端、PTY 根=人跑的
        // claude+muxvo-console skill。原生菜单动作、非桥消息（零协议改动）；autoenablesItems 默认 true，validateMenuItem
        // 对本 selector 恒放行（不随新建终端满员门控——指挥台与普通终端共用 20 上限，满员则 spawn 侧 .rejected 兜底）。
        // 编排门控（上线批，OrchGate 头注）：gate off 不建项，⌘⇧N 键位随之失效。
        if showOrchMenus {
            let newConsoleItem = NSMenuItem(
                title: "新建指挥台", action: #selector(newConsole(_:)), keyEquivalent: "n")
            newConsoleItem.keyEquivalentModifierMask = [.command, .shift]
            newConsoleItem.target = self
            fileMenu.addItem(newConsoleItem)
        }
        fileItem.submenu = fileMenu

        // 编辑（Edit）菜单（M4a 收官验收现场缺陷，2026-07-06）：无此菜单则 WKWebView 文本框的
        // Cmd+V/C/X/A/Z 无菜单路由（macOS 经典坑），任务中心表单「能打字不能粘贴」。六项全部
        // **target=nil 走响应链**：firstResponder=WKWebView 时由其消费进 DOM 输入框；终端 surface
        // 为 firstResponder 时 Cmd+V/C 已在视图层 performKeyEquivalent 先于菜单截留（terminal-input.md
        // §8 F2 守卫），菜单只是 web 侧兜底通道，终端路径零改动（Terminal.app/iTerm/Ghostty 同形态）。
        // autoenablesItems 保持默认 true：项的可用性随 firstResponder 是否响应该 selector 自动门控。
        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        addEdit(to: editMenu, title: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        addEdit(to: editMenu, title: "重做", action: Selector(("redo:")), keyEquivalent: "z",
                modifiers: [.command, .shift])
        editMenu.addItem(NSMenuItem.separator())
        addEdit(to: editMenu, title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        addEdit(to: editMenu, title: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        addEdit(to: editMenu, title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(NSMenuItem.separator())
        addEdit(to: editMenu, title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        // 显示（View）菜单：字号缩放。autoenablesItems=false → 三项恒可用（zoom 是全局字号，无上下文门控），
        // 且令 performKeyEquivalent 匹配不依赖 validateMenuItem（键位截获确定性）。
        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewMenu.autoenablesItems = false

        // 放大：显示 ⌘+（惯例，对应 Cmd+Shift+=）。裸 Cmd+=（用户实际按键、不带 shift）由隐藏 companion
        // "=" 截获——隐藏项键位仍参与 performKeyEquivalent 匹配（Terminal.app/Safari 技法，已实证）。
        addZoom(to: viewMenu, title: "放大", action: #selector(fontZoomIn(_:)), keyEquivalent: "+")
        addZoom(to: viewMenu, title: "放大", action: #selector(fontZoomIn(_:)), keyEquivalent: "=", hidden: true)
        addZoom(to: viewMenu, title: "缩小", action: #selector(fontZoomOut(_:)), keyEquivalent: "-")
        addZoom(to: viewMenu, title: "实际大小", action: #selector(fontZoomReset(_:)), keyEquivalent: "0")

        // 任务中心切屏（task-center-panel.md §1「入口=原生菜单+快捷键」）：Cmd+Shift+T toggle。原生菜单
        // 不在 web golden 范围 → 64 张字节冻结零风险。autoenablesItems=false → 恒可用（切屏是全局动作，无门控）。
        // 编排门控（上线批，OrchGate 头注）：gate off 不建项，⌘⇧T 键位随之失效；分隔线保留（仍分隔
        // 字号组与文件面板/聊天历史组）。
        viewMenu.addItem(NSMenuItem.separator())
        if showOrchMenus {
            let taskCenterItem = NSMenuItem(
                title: "任务中心", action: #selector(toggleTaskCenter(_:)), keyEquivalent: "t")
            taskCenterItem.keyEquivalentModifierMask = [.command, .shift]
            taskCenterItem.target = self
            viewMenu.addItem(taskCenterItem)
        }

        // 文件面板切换（M6 批A，file-panel.md §0.5「文件夹按钮」的键盘入口）：⌘E toggle。原生菜单
        // 不在 web golden 范围 → 字节冻结零风险。autoenablesItems=false → 恒可用（全局动作，无门控）。
        let filePanelItem = NSMenuItem(
            title: "文件面板", action: #selector(toggleFilePanel(_:)), keyEquivalent: "e")
        filePanelItem.keyEquivalentModifierMask = [.command]
        filePanelItem.target = self
        viewMenu.addItem(filePanelItem)

        // 聊天历史切屏（chat-history.md §7.6「入口=原生菜单+快捷键」，沿任务中心先例）：Cmd+Shift+H toggle。
        // "h" 未被本 app 菜单占用（App 菜单无 Hide 项，仅 Quit）；原生菜单不在 web golden 范围，字节冻结零风险。
        let chatHistoryItem = NSMenuItem(
            title: "聊天历史", action: #selector(toggleChatHistory(_:)), keyEquivalent: "h")
        chatHistoryItem.keyEquivalentModifierMask = [.command, .shift]
        chatHistoryItem.target = self
        viewMenu.addItem(chatHistoryItem)

        // 列表模式切换（批B，term-list-mode.md）：⌘⇧L toggle List↔Tiling（小屏适用：左终端列表 + 右选中
        // 终端真详情）。"l" 未被本 app 菜单占用（已 grep 全菜单核实）；原生菜单不在 web golden 范围，字节冻结零风险。
        let listModeItem = NSMenuItem(
            title: "列表模式", action: #selector(toggleListMode(_:)), keyEquivalent: "l")
        listModeItem.keyEquivalentModifierMask = [.command, .shift]
        listModeItem.target = self
        viewMenu.addItem(listModeItem)
        viewItem.submenu = viewMenu

        return mainMenu
    }

    /// 编辑菜单项：target=nil 走响应链（绝不绑实例——可编辑性随 firstResponder 自动门控）。
    private func addEdit(to menu: NSMenu, title: String, action: Selector,
                         keyEquivalent: String, modifiers: NSEvent.ModifierFlags = [.command]) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.keyEquivalentModifierMask = modifiers
        menu.addItem(item)
    }

    private func addZoom(to menu: NSMenu, title: String, action: Selector,
                         keyEquivalent: String, hidden: Bool = false) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.keyEquivalentModifierMask = [.command]
        item.target = self
        item.isHidden = hidden
        // 文档口径：隐藏项不参与键位匹配（实测本机参与，但不赌未文档化行为）——显式声明保证
        // companion "=" 在隐藏态仍截裸 Cmd+=（DOGFOOD_M3_05 验收 minor①）。
        if hidden { item.allowsKeyEquivalentWhenHidden = true }
        menu.addItem(item)
    }

    // MARK: - 新建终端 action（→ onNewTerminal → TerminalService.createTerminalFromMenu）

    @objc func newTerminal(_ sender: Any?) { onNewTerminal() }

    // MARK: - 新建窗口 action（→ onNewWindow → WindowManager.newWindow；multi-window.md §1.1 ⌥⌘N）

    @objc func newWindow(_ sender: Any?) { onNewWindow() }

    // MARK: - 新建指挥台 action（→ onNewConsole → ConsoleTerminalManager.open）

    @objc func newConsole(_ sender: Any?) { onNewConsole() }

    // MARK: - 字号 action（→ onZoom → TerminalService.applyZoom）

    @objc func fontZoomIn(_ sender: Any?) { onZoom(.in) }
    @objc func fontZoomOut(_ sender: Any?) { onZoom(.out) }
    @objc func fontZoomReset(_ sender: Any?) { onZoom(.reset) }

    // MARK: - 任务中心切屏 action（→ onToggleTaskCenter → AppDelegate 翻 panelMode + detach）

    @objc func toggleTaskCenter(_ sender: Any?) { onToggleTaskCenter() }

    // MARK: - 文件面板切换 action（→ onToggleFilePanel → AppDelegate.toggleFilePanel + 交焦 WKWebView）

    @objc func toggleFilePanel(_ sender: Any?) { onToggleFilePanel() }

    // MARK: - 聊天历史切屏 action（→ onToggleChatHistory → AppDelegate 翻 panelMode(.chatHistory) + detach）

    @objc func toggleChatHistory(_ sender: Any?) { onToggleChatHistory() }

    // MARK: - 列表模式切换 action（→ onToggleListMode → TerminalService.toggleListMode 翻 List↔Tiling + 重推）

    @objc func toggleListMode(_ sender: Any?) { onToggleListMode() }

    // MARK: - CC 用量预警 action（→ onUsageAlertMenu → StatusLineInstaller.handleMenuAction）

    @objc func usageAlertMenu(_ sender: Any?) { onUsageAlertMenu() }
}

// MARK: - 菜单项验证（DOGFOOD_M3_20：新建终端满员置灰）

extension AppMenuCommands: NSMenuItemValidation {
    /// 新建终端项经 isNewTerminalEnabled 门控（满员=false → AppKit 置灰，与 FAB disabled 语义对齐）；其余
    /// target=self 的项（字号/任务中心/聊天历史，autoenablesItems=false 恒可用不经此路）恒放行——不误伤。
    /// fileMenu autoenablesItems=true（默认）令 AppKit 每次弹开前调本方法重算满员态。
    public func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(newTerminal(_:)) {
            return isNewTerminalEnabled()
        }
        if menuItem.action == #selector(usageAlertMenu(_:)) {
            menuItem.title = usageAlertMenuTitle() // 标题随安装态切换（启用…/停用），恒可用
        }
        return true
    }
}
