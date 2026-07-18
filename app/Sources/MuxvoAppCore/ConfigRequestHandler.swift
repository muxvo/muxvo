// config.request / app.request 原生处理器（M6 批1 步骤4）。BridgeBus.onConfigRequest / onAppRequest
// 落点。ConfigRequestHandler：偏好 get/set（共享 ConfigModel 单写者）+ 资源/settings/MCP/plugins（→
// MuxvoConfigCenter）。AppRequestHandler：selectDirectory → 注入的 DirectoryPicker（生产 NSOpenPanel）。
//
// 业务失败经 ConfigResponse.rejected / AppResponse.selectionCancelled（类型化 payload，不占信封错误）。
import AppKit
import Foundation
import MuxvoBridge
import MuxvoConfigCenter
import MuxvoStorage
import MuxvoTermCore

@MainActor
public final class ConfigRequestHandler {
    private let configModel: ConfigModel
    private let center: ConfigCenter

    public init(configModel: ConfigModel, center: ConfigCenter) {
        self.configModel = configModel
        self.center = center
    }

    /// BridgeBus.onConfigRequest 落点（同步，@MainActor；桥闭包 async 签名不 await）。`windowId` = 发起窗
    /// （multi-window.md §6/裁决⑪）：gridLayout get 投影本窗值 / set 写本窗分组；nil = 单窗/顶层（向后兼容）。
    public func handle(_ request: ConfigRequest, windowId: String? = nil) -> ConfigResponse {
        switch request {
        case .get:
            return .snapshot(config: snapshot(windowId: windowId))
        case let .set(patch):
            applyPatch(patch, windowId: windowId) // 浅合并 + 原子落盘 + onPrefsChanged 副作用（含终端配色广播）
            // 回传更新后完整 config（非 .saved）供 web 对账当前配置（用户裁决：UI 恒双字段显式写，此为无害对账回传）。
            return .snapshot(config: snapshot(windowId: windowId))
        case let .listResources(types):
            return .resources(items: center.listResources(types: types))
        case let .readResource(path):
            switch center.readResource(path: path) {
            case let .success(v): return .resourceContent(content: v.content, format: v.format)
            case let .failure(e): return .rejected(code: e.code, message: e.message)
            }
        case let .listResourceDir(path):
            switch center.listResourceDir(path: path) {
            case let .success(entries): return .dirEntries(entries: entries)
            case let .failure(e): return .rejected(code: e.code, message: e.message)
            }
        case let .writeResource(path, content):
            return mapVoid(center.writeResource(path: path, content: content))
        case .getSettings:
            return .settingsJson(json: center.getSettings())
        case let .saveSettings(json):
            return mapVoid(center.saveSettings(json: json))
        case .mcpServers:
            return .mcpServers(servers: center.mcpServers())
        case let .mcpSave(server):
            return mapVoid(center.mcpSave(server: server))
        case let .mcpDelete(name):
            return mapVoid(center.mcpDelete(name: name))
        case .plugins:
            return .plugins(items: center.plugins())
        case let .setPluginEnabled(pluginId, enabled):
            return mapVoid(center.setPluginEnabled(pluginId: pluginId, enabled: enabled))
        }
    }

    /// config.request get → 全量 ConfigSnapshot（从共享 ConfigModel 读，含 12 键）。gridLayout 按 windowId
    /// 投影本窗值（裁决⑪每窗独立）：命中本窗分组 gridLayout → 用之；否则回顶层（首窗镜像 / 单窗）。
    func snapshot(windowId: String? = nil) -> ConfigSnapshot {
        let c = configModel.config
        let grid = windowId
            .flatMap { wid in c.windows.first(where: { $0.windowId == wid })?.gridLayout }
            ?? c.gridLayout
        return ConfigSnapshot(
            startupTerminalCount: c.startupTerminalCount,
            doubleClickToFocus: c.doubleClickToFocus,
            dockBadgeMode: DockBadgeMode(rawValue: c.dockBadgeMode) ?? .realtime,
            dockBadgeIntervalMin: c.dockBadgeIntervalMin,
            defaultTerminalCwd: c.defaultTerminalCwd,
            showHiddenFiles: c.showHiddenFiles,
            language: c.language,
            theme: Theme(rawValue: c.theme) ?? .dark,
            // 终端配色名（M6 主题批 §4）：经 TermTheme.named 归一——过时/损坏名回退 "dark"（§1 开集语义）。
            terminalThemeName: TermTheme.named(c.terminal.themeName).name,
            fontSize: c.fontSize,
            gridLayout: GridLayoutView(columnRatios: grid.columnRatios, rowRatios: grid.rowRatios),
            ftvLeftWidth: c.ftvLeftWidth,
            ftvRightWidth: c.ftvRightWidth,
            // 聊天自动归档开关（M5-R1 批2）：存取通道；warmup 跳扫等行为门控归批2 C。
            archiveEnabled: c.chatArchiveEnabled,
            // 新手引导完成标（右上角批 B2）：web 首启欢迎卡门控（welcome-overlay.md）。
            tourCompleted: c.tourCompleted)
    }

    /// config.request set{patch} → 浅合并到 ConfigModel（updatePrefs：原子落盘 + onPrefsChanged 副作用）。
    /// 缺席字段保持不变（PrefsPatch 全 optional）。gridLayout 按 windowId 写本窗分组（裁决⑪）；nil = 顶层。
    private func applyPatch(_ patch: PrefsPatch, windowId: String? = nil) {
        configModel.updatePrefs { c in
            // 终端配色名直存（用户裁决 2026-07-07：设置合并为单「主题」下拉，UI 层恒同 patch 显式写
            // theme + terminalThemeName，无服务端跟随/粘住推断）。theme 与 terminalThemeName 同一 updatePrefs
            // 原子落盘，缺字段保持不变（PrefsPatch 全 optional）。
            if let v = patch.terminalThemeName { c.terminal.themeName = v }
            if let v = patch.startupTerminalCount { c.startupTerminalCount = v }
            if let v = patch.doubleClickToFocus { c.doubleClickToFocus = v }
            if let v = patch.dockBadgeMode { c.dockBadgeMode = v.rawValue }
            if let v = patch.dockBadgeIntervalMin { c.dockBadgeIntervalMin = v }
            if let v = patch.defaultTerminalCwd { c.defaultTerminalCwd = v }
            if let v = patch.showHiddenFiles { c.showHiddenFiles = v }
            if let v = patch.language { c.language = v }
            if let v = patch.theme { c.theme = v.rawValue }
            if let v = patch.fontSize { c.fontSize = v }
            if let v = patch.gridLayout {
                let g = MuxvoConfig.GridLayout(columnRatios: v.columnRatios, rowRatios: v.rowRatios)
                if let wid = windowId {
                    c.upsertWindowEntry(windowId: wid) { $0.gridLayout = g } // 本窗分组 + 镜像首窗回顶层
                } else {
                    c.gridLayout = g
                }
            }
            if let v = patch.ftvLeftWidth { c.ftvLeftWidth = v }
            if let v = patch.ftvRightWidth { c.ftvRightWidth = v }
            if let v = patch.archiveEnabled { c.chatArchiveEnabled = v }
            if let v = patch.tourCompleted { c.tourCompleted = v }
        }
    }

    private func mapVoid(_ r: Result<Void, ConfigCenterError>) -> ConfigResponse {
        switch r {
        case .success: return .saved
        case let .failure(e): return .rejected(code: e.code, message: e.message)
        }
    }
}

// MARK: - app.request（selectDirectory + update 域，auto-update.md §9）

/// 原生目录选择器接缝（生产 NSOpenPanel @MainActor；测试注入替身，绝不弹真面板）。
@MainActor
public protocol DirectoryPicker {
    /// 返回选中目录绝对路径；nil = 用户取消。
    func pick(defaultPath: String?) async -> String?
}

/// 外部链接打开接缝（右上角批 B2；生产 NSWorkspace，测试注入替身零真开）。
@MainActor
public protocol ExternalURLOpener {
    /// 返回 true=已交系统打开；false=系统拒开。
    func open(_ url: URL) -> Bool
}

/// 更新动作接缝（auto-update.md §1/§6）：生产 = UpdateController 装配（仅生产启用门内）；
/// nil = dev no-op 对等（legacy :896-900——请求即时 ack、零推送，web 8s 超时判「已是最新」）。
@MainActor
public protocol UpdateActionHandling: AnyObject {
    func updateCheck()
    func updateDownload()
}

/// What's New 数据接缝（auto-update.md §7）：不随生产启用门（legacy GET_RELEASE_NOTES dev 也可用）。
@MainActor
public protocol WhatsNewRequestHandling: AnyObject {
    func releaseNotes(locale: String) -> [ReleaseEntry]
    /// 查询即写回 lastSeenVersion（WhatsNewGate 语义）。
    func whatsNewStatus() -> (shouldShow: Bool, appVersion: String)
}

/// WaitDetector hook 安装面板接缝（wait-detector.md §7 单绑定；settings-modal.md 终端等待检测行）：
/// 生产 = HookInstaller（AppDelegate 装配）；nil = 禁装门分身 → hookStatus 恒回 disabled（面板不渲染该行）。
@MainActor
public protocol HookPanelHandling: AnyObject {
    /// 面板安装态（installed/notInstalled/drift/foreignBound；disabled 由缝缺席表达）。
    func panelStatus() -> (state: HookInstallState, reason: String?)
    /// 显式启用/接管（§7 单绑定）：sheet 授权确认 → 确认则 install() 写 settings.json；
    /// 返回终态（用户取消 = 当前态不变）；install 抛错由调用方映射 rejected。
    func requestEnable() async throws -> (state: HookInstallState, reason: String?)
    /// 显式停用（§7 opt-out）：uninstall + opt-out 记档；返回终态；抛错由调用方映射 rejected。
    func requestDisable() async throws -> (state: HookInstallState, reason: String?)
    /// 首启自动启用一次性轻提示消费（§7）：查询即写回，仅首个查询者拿到 true。
    func consumeAutoEnableNotice() -> Bool
}

@MainActor
public final class AppRequestHandler {
    private let picker: any DirectoryPicker
    private let opener: any ExternalURLOpener
    private let updateActions: UpdateActionHandling?
    private let whatsNew: WhatsNewRequestHandling?
    private let hookPanel: HookPanelHandling?
    /// M7 批3（legacy-migration.md §7.2）首启迁移提示消费闭包：查询即消费（首个查询者拿 true 后置
    /// 一次性闩，此后恒 false）。默认 `{ false }` = 未装配（dev/test/禁装分身恒不提示）。
    private let migrationNoticeConsume: () -> Bool

    public init(
        picker: any DirectoryPicker,
        opener: any ExternalURLOpener = NSWorkspaceURLOpener(),
        updateActions: UpdateActionHandling? = nil,
        whatsNew: WhatsNewRequestHandling? = nil,
        hookPanel: HookPanelHandling? = nil,
        migrationNoticeConsume: @escaping () -> Bool = { false }
    ) {
        self.picker = picker
        self.opener = opener
        self.updateActions = updateActions
        self.whatsNew = whatsNew
        self.hookPanel = hookPanel
        self.migrationNoticeConsume = migrationNoticeConsume
    }

    /// BridgeBus.onAppRequest 落点。selectDirectory → DirectoryPicker（取消 → selectionCancelled）；
    /// update 域 → 接缝（缺席 = dev no-op 对等 ack / 空数据）；openExternal → 系统浏览器（仅
    /// http/https，纵深防线拒任意 scheme 出逃）；auth* → AuthRequestRouter 已在 AppDelegate 分流
    /// 前置拦截，此处 rejected(AUTH_UNAVAILABLE) 为未装配兜底。
    public func handle(_ request: AppRequest) async -> AppResponse {
        switch request {
        case let .selectDirectory(defaultPath):
            if let path = await picker.pick(defaultPath: defaultPath) {
                return .directorySelected(path: path)
            }
            return .selectionCancelled
        case .updateCheck:
            updateActions?.updateCheck()
            return .updateAck
        case .updateDownload:
            updateActions?.updateDownload()
            return .updateAck
        case let .releaseNotes(locale):
            return .releaseNotes(entries: whatsNew?.releaseNotes(locale: locale) ?? [])
        case .whatsNewStatus:
            if let whatsNew {
                let status = whatsNew.whatsNewStatus()
                return .whatsNewStatus(shouldShow: status.shouldShow, appVersion: status.appVersion)
            }
            return .whatsNewStatus(shouldShow: false, appVersion: AppInfo.shortVersion)
        case let .openExternal(url):
            // scheme 白名单（login-modal.md 条款/隐私链接域）：非 http/https 一律拒（file:/自定义
            // scheme 经桥出逃 = 攻击面，纵深防线与 web 侧调用点约束双保险）。
            guard let u = URL(string: url), let scheme = u.scheme?.lowercased(),
                  scheme == "http" || scheme == "https"
            else { return .rejected(code: "OPEN_URL_INVALID", message: "仅允许 http/https 链接") }
            return opener.open(u) ? .opened : .rejected(code: "OPEN_URL_FAILED", message: "系统拒绝打开链接")
        case .hookStatus:
            guard let hookPanel else { return .hookStatus(state: .disabled, reason: nil) }
            let status = hookPanel.panelStatus()
            return .hookStatus(state: status.state, reason: status.reason)
        case .hookEnable:
            // 显式启用/接管（wait-detector.md §7 单绑定）：sheet 授权确认在缝内，响应即带终态
            // （pull-only，免 data.event）。缝缺席（禁装门）= disabled，web 侧本就不渲染入口。
            guard let hookPanel else { return .hookStatus(state: .disabled, reason: nil) }
            do {
                let status = try await hookPanel.requestEnable()
                return .hookStatus(state: status.state, reason: status.reason)
            } catch {
                return .rejected(code: "HOOK_INSTALL_FAILED", message: String(describing: error))
            }
        case .hookDisable:
            // 显式停用（§7 opt-out）：uninstall + 记档，响应即带终态（pull-only 同上）。
            guard let hookPanel else { return .hookStatus(state: .disabled, reason: nil) }
            do {
                let status = try await hookPanel.requestDisable()
                return .hookStatus(state: status.state, reason: status.reason)
            } catch {
                return .rejected(code: "HOOK_DISABLE_FAILED", message: String(describing: error))
            }
        case .hookAutoEnableNotice:
            // 首启自动启用一次性轻提示（§7）：查询即消费；缝缺席（禁装门）恒 false。
            return .hookNotice(show: hookPanel?.consumeAutoEnableNotice() ?? false)
        case .legacyMigrationNotice:
            // M7 批3 老版聊天归档首启迁移提示（legacy-migration.md §7.2）：查询即消费一次性闩；
            // 未装配（dev/test/迁移零命中/禁装分身）恒 false。
            return .migrationNotice(show: migrationNoticeConsume())
        case .authStatus, .authLoginOAuth, .authLoginPassword, .authRegister,
             .authSendEmailCode, .authResetPassword, .authLogout:
            // B5 登录批换 AuthRequestRouter 接管本组变体；在此之前保持结构化拒绝（协议先行，B2）。
            return .rejected(code: "AUTH_UNAVAILABLE", message: "登录服务尚未接线（B5）")
        }
    }
}

/// 生产外链打开器：NSWorkspace（系统默认浏览器）。
@MainActor
public struct NSWorkspaceURLOpener: ExternalURLOpener {
    public init() {}
    public func open(_ url: URL) -> Bool { NSWorkspace.shared.open(url) }
}

/// 生产目录选择器：NSOpenPanel（仅选目录，单选）。runModal @MainActor 同步。
@MainActor
public struct NSOpenPanelDirectoryPicker: DirectoryPicker {
    public init() {}

    public func pick(defaultPath: String?) async -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "选择"
        if let defaultPath, !defaultPath.isEmpty {
            panel.directoryURL = URL(
                fileURLWithPath: (defaultPath as NSString).expandingTildeInPath, isDirectory: true)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return url.path
    }
}
