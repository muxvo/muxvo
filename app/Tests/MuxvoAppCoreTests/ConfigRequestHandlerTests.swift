// config.request / app.request 信封层直测（M6 批1）。经 BridgeBus.handleIncoming 走真 ConfigRequestHandler
// / AppRequestHandler（共享 ConfigModel 单写者 + temp ConfigCenter + 注入 DirectoryPicker 替身）。
// APP_L1_03（get→snapshot 全键）/ APP_L1_04（set{patch}→落盘重读等值+saved）。只碰 $TMPDIR。
//
// 注：本 suite @MainActor（BridgeBus/ConfigModel/处理器均 @MainActor），故用 @MainActor 内联 temp 根
// （withTempRoot async 重载要求 nonisolated 闭包，与本 suite MainActor 隔离冲突）。
import Foundation
import MuxvoBridge
import MuxvoConfigCenter
import MuxvoStorage
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("config.request/app.request 信封层（真处理器，只碰 $TMPDIR）")
struct ConfigRequestHandlerTests {
    // MARK: 装配 / 工具

    /// $TMPDIR 下 UUID 隔离临时根（含清理句柄）。@MainActor 内联，避 withTempRoot async 的 nonisolated 约束。
    private func makeTempDir() throws -> (root: URL, cleanup: () -> Void) {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-cfg-\(UUID().uuidString)", isDirectory: true)
        let root = base.appendingPathComponent("Muxvo2 Test", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return (root, { try? FileManager.default.removeItem(at: base) })
    }

    private func makeRoots(_ root: URL) -> ConfigRoots {
        ConfigRoots(
            claudeRoot: root.appendingPathComponent(".claude"),
            globalMcpFile: root.appendingPathComponent(".claude.json"),
            desktopMcpFile: root.appendingPathComponent("desktop.json"),
            codexConfigFile: root.appendingPathComponent(".codex/config.toml"),
            geminiSettingsFile: root.appendingPathComponent(".gemini/settings.json"))
    }

    /// 建 (bus, configStoreURL, configModel)：bus.onConfigRequest 接真 ConfigRequestHandler。
    private func makeBus(root: URL) -> (BridgeBus, URL, ConfigModel) {
        let storeURL = root.appendingPathComponent("config.json")
        let model = ConfigModel(store: ConfigStore(configFileURL: storeURL))
        let handler = ConfigRequestHandler(configModel: model, center: ConfigCenter(roots: makeRoots(root)))
        let bus = BridgeBus(appVersion: "test")
        bus.onConfigRequest = { req in handler.handle(req) }
        return (bus, storeURL, model)
    }

    private func envelope(_ type: String, payload: Any?) -> [String: Any] {
        var e: [String: Any] = ["v": 1, "type": type]
        if let payload { e["payload"] = payload }
        return e
    }

    private func decodeConfigResponse(_ reply: [String: Any]) throws -> ConfigResponse {
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(ConfigResponse.self, from: data)
    }

    // MARK: - APP_L1_03 get → snapshot

    @Test("APP_L1_03: app:get-preferences —— config.request get → snapshot 全 13 键形状（含 terminalThemeName）")
    func app_l1_03_getPreferencesSnapshot() async throws {
        let (root, cleanup) = try makeTempDir()
        defer { cleanup() }
        let (bus, _, _) = makeBus(root: root)
        let reply = await bus.handleIncoming(envelope("config.request", payload: ["kind": "get"]))
        #expect(reply["ok"] as? Bool == true)
        // 信封 payload 含 snapshot.config 的 13 键（形状断言；M6 主题批加 terminalThemeName）
        let payload = try #require(reply["payload"] as? [String: Any])
        let config = try #require(payload["config"] as? [String: Any])
        for key in ["startupTerminalCount", "doubleClickToFocus", "dockBadgeMode",
                    "dockBadgeIntervalMin", "defaultTerminalCwd", "showHiddenFiles", "language",
                    "theme", "terminalThemeName", "fontSize", "gridLayout", "ftvLeftWidth", "ftvRightWidth",
                    "archiveEnabled"] {
            #expect(config[key] != nil, "snapshot.config 缺键 \(key)")
        }
        // 类型化 decode + 缺省值对齐（config.json 未落盘 → 默认）
        guard case let .snapshot(snap) = try decodeConfigResponse(reply) else {
            Issue.record("应为 snapshot"); return
        }
        #expect(snap.startupTerminalCount == 1)
        #expect(snap.dockBadgeMode == .realtime)
        #expect(snap.dockBadgeIntervalMin == 1)
        #expect(snap.language == "zh")
        #expect(snap.theme == .dark)
        #expect(snap.terminalThemeName == "dark")   // M6 主题批缺省（config.terminal.themeName 未落盘）
        #expect(snap.archiveEnabled == true)        // M5-R1 批2 缺省开（chatArchiveEnabled 未落盘 → true）
    }

    // MARK: - M5-R1 批2：聊天自动归档开关存取通道（archiveEnabled 双向映射）

    @Test("聊天归档开关：set{archiveEnabled:false} → 落盘重读 + snapshot 回传 false；缺字段不变")
    func app_chatArchiveEnabledRoundTrip() async throws {
        let (root, cleanup) = try makeTempDir()
        defer { cleanup() }
        let (bus, storeURL, _) = makeBus(root: root)
        // 关闭归档：set{archiveEnabled:false}。
        let reply = await bus.handleIncoming(envelope("config.request",
            payload: ["kind": "set", "patch": ["archiveEnabled": false]]))
        guard case let .snapshot(c) = try decodeConfigResponse(reply) else { Issue.record("应为 snapshot"); return }
        #expect(c.archiveEnabled == false)
        // 落盘重读一致（新 ConfigStore 实例读磁盘）。
        let reloaded = ConfigStore(configFileURL: storeURL).load()
        #expect(reloaded.chatArchiveEnabled == false)
        // 缺字段不变：仅 set{theme:light}（无 archiveEnabled）→ archiveEnabled 保持 false。
        let r2 = await bus.handleIncoming(envelope("config.request",
            payload: ["kind": "set", "patch": ["theme": "light"]]))
        guard case let .snapshot(c2) = try decodeConfigResponse(r2) else { Issue.record("应为 snapshot"); return }
        #expect(c2.archiveEnabled == false)   // patch 未含该字段 → 不变
    }

    // MARK: - M6 主题批：终端配色名直存（用户裁决单「主题」下拉，UI 恒双字段显式写；无服务端跟随/粘住）

    @Test("终端配色：同 patch 双字段（theme + terminalThemeName）同写 → 一致落盘 + snapshot 回传；缺字段不变")
    func app_terminalThemeBothFieldsWritten() async throws {
        let (root, cleanup) = try makeTempDir()
        defer { cleanup() }
        let (bus, storeURL, _) = makeBus(root: root)
        // 模拟 UI 选「Monokai」：单「主题」下拉恒同 patch 显式写 theme（界面随花样暗）+ terminalThemeName。
        let reply = await bus.handleIncoming(envelope("config.request",
            payload: ["kind": "set", "patch": ["theme": "dark", "terminalThemeName": "monokai"]]))
        guard case let .snapshot(c) = try decodeConfigResponse(reply) else { Issue.record("应为 snapshot"); return }
        #expect(c.theme == .dark)
        #expect(c.terminalThemeName == "monokai")
        // 落盘重读两字段一致（新 ConfigStore 实例读磁盘）。
        let reloaded = ConfigStore(configFileURL: storeURL).load()
        #expect(reloaded.theme == "dark")
        #expect(reloaded.terminal.themeName == "monokai")
        // 缺字段不变（直存语义，非跟随/粘住）：仅 set{theme:light}（无 terminalThemeName）→ terminalThemeName 保持 monokai。
        let r2 = await bus.handleIncoming(envelope("config.request",
            payload: ["kind": "set", "patch": ["theme": "light"]]))
        guard case let .snapshot(c2) = try decodeConfigResponse(r2) else { Issue.record("应为 snapshot"); return }
        #expect(c2.theme == .light)
        #expect(c2.terminalThemeName == "monokai")   // patch 未含该字段 → 不变
    }

    // MARK: - APP_L1_04 set{patch} → saved + 落盘

    @Test("APP_L1_04: app:save-preferences —— config.request set{patch} → snapshot 回执 + 落盘重读等值")
    func app_l1_04_savePreferencesPersists() async throws {
        let (root, cleanup) = try makeTempDir()
        defer { cleanup() }
        let (bus, storeURL, _) = makeBus(root: root)
        let patch: [String: Any] = [
            "startupTerminalCount": 5, "doubleClickToFocus": true,
            "dockBadgeMode": "timed", "dockBadgeIntervalMin": 3,
            "defaultTerminalCwd": "/tmp", "showHiddenFiles": true,
            "language": "en", "theme": "light",
        ]
        let reply = await bus.handleIncoming(
            envelope("config.request", payload: ["kind": "set", "patch": patch]))
        #expect(reply["ok"] as? Bool == true)
        // set 回传完整 snapshot（非 .saved）——供 web 对账当前配置。
        guard case let .snapshot(config) = try decodeConfigResponse(reply) else {
            Issue.record("应为 snapshot"); return
        }
        #expect(config.theme == .light)
        // 直存语义：patch 未含 terminalThemeName → 保持缺省 dark（无跟随；本 patch 只改界面 theme）。
        #expect(config.terminalThemeName == "dark")
        // 落盘重读等值（新 ConfigStore 实例读磁盘）
        let reloaded = ConfigStore(configFileURL: storeURL).load()
        #expect(reloaded.startupTerminalCount == 5)
        #expect(reloaded.doubleClickToFocus == true)
        #expect(reloaded.dockBadgeMode == "timed")
        #expect(reloaded.dockBadgeIntervalMin == 3)
        #expect(reloaded.defaultTerminalCwd == "/tmp")
        #expect(reloaded.showHiddenFiles == true)
        #expect(reloaded.language == "en")
        #expect(reloaded.theme == "light")
    }

    // MARK: - set 触发 onPrefsChanged（副作用出口）

    @Test("config.request set 经 updatePrefs 触发 onPrefsChanged（偏好副作用出口）")
    func setTriggersPrefsChanged() async throws {
        let (root, cleanup) = try makeTempDir()
        defer { cleanup() }
        let (bus, _, model) = makeBus(root: root)
        final class Flag: @unchecked Sendable { var count = 0 }
        let flag = Flag()
        model.onPrefsChanged = { _ in flag.count += 1 }
        _ = await bus.handleIncoming(
            envelope("config.request", payload: ["kind": "set", "patch": ["theme": "light"]]))
        #expect(flag.count == 1)
    }

    // MARK: - app.request selectDirectory（注入 picker）

    struct StubPicker: DirectoryPicker {
        let result: String?
        func pick(defaultPath: String?) async -> String? { result }
    }

    @Test("app.request selectDirectory：注入 picker 返路径 → directorySelected；返 nil → selectionCancelled")
    func appRequestSelectDirectory() async throws {
        let bus = BridgeBus(appVersion: "test")
        let picked = AppRequestHandler(picker: StubPicker(result: "/Users/x/proj"))
        bus.onAppRequest = { req in await picked.handle(req) }
        let ok = await bus.handleIncoming(
            envelope("app.request", payload: ["kind": "selectDirectory", "defaultPath": "/Users/x"]))
        let okPayload = try #require(ok["payload"] as? [String: Any])
        let okResp = try JSONDecoder().decode(
            AppResponse.self, from: JSONSerialization.data(withJSONObject: okPayload))
        #expect(okResp == .directorySelected(path: "/Users/x/proj"))

        let cancelBus = BridgeBus(appVersion: "test")
        let cancelled = AppRequestHandler(picker: StubPicker(result: nil))
        cancelBus.onAppRequest = { req in await cancelled.handle(req) }
        let cancel = await cancelBus.handleIncoming(
            envelope("app.request", payload: ["kind": "selectDirectory"]))
        let cancelPayload = try #require(cancel["payload"] as? [String: Any])
        let cancelResp = try JSONDecoder().decode(
            AppResponse.self, from: JSONSerialization.data(withJSONObject: cancelPayload))
        #expect(cancelResp == .selectionCancelled)
    }

    // MARK: - 右上角批 B2：tourCompleted 偏好通道 + openExternal + auth 占位拒绝

    @Test("tourCompleted：set{tourCompleted:true} → 落盘重读 + snapshot 回传；缺席默认 false；缺字段不变")
    func tourCompletedRoundTrip() async throws {
        let (root, cleanup) = try makeTempDir()
        defer { cleanup() }
        let (bus, storeURL, _) = makeBus(root: root)
        // 缺席默认 false（首启弹欢迎卡门控，welcome-overlay.md）。
        let r0 = await bus.handleIncoming(envelope("config.request", payload: ["kind": "get"]))
        guard case let .snapshot(c0) = try decodeConfigResponse(r0) else { Issue.record("应为 snapshot"); return }
        #expect(c0.tourCompleted == false)
        // set{tourCompleted:true} → snapshot 回传 + 落盘重读一致。
        let r1 = await bus.handleIncoming(envelope("config.request",
            payload: ["kind": "set", "patch": ["tourCompleted": true]]))
        guard case let .snapshot(c1) = try decodeConfigResponse(r1) else { Issue.record("应为 snapshot"); return }
        #expect(c1.tourCompleted == true)
        #expect(ConfigStore(configFileURL: storeURL).load().tourCompleted == true)
        // 缺字段不变：set{theme:light} 不含 tourCompleted → 保持 true。
        let r2 = await bus.handleIncoming(envelope("config.request",
            payload: ["kind": "set", "patch": ["theme": "light"]]))
        guard case let .snapshot(c2) = try decodeConfigResponse(r2) else { Issue.record("应为 snapshot"); return }
        #expect(c2.tourCompleted == true)
    }

    struct StubOpener: ExternalURLOpener {
        let result: Bool
        let record: (URL) -> Void
        func open(_ url: URL) -> Bool { record(url); return result }
    }

    @Test("app.request openExternal：https → 交 opener + opened；file:/坏串 → OPEN_URL_INVALID 拒（不触 opener）")
    func appRequestOpenExternal() async throws {
        let opened = OpenedURLBox()
        let handler = AppRequestHandler(
            picker: StubPicker(result: nil),
            opener: StubOpener(result: true, record: { opened.append($0) }))
        let bus = BridgeBus(appVersion: "test")
        bus.onAppRequest = { req in await handler.handle(req) }
        // https 放行 → opened。
        let ok = await bus.handleIncoming(envelope("app.request",
            payload: ["kind": "openExternal", "url": "https://muxvo.com/terms"]))
        let okResp = try JSONDecoder().decode(
            AppResponse.self,
            from: JSONSerialization.data(withJSONObject: try #require(ok["payload"] as? [String: Any])))
        #expect(okResp == .opened)
        #expect(opened.urls.map(\.absoluteString) == ["https://muxvo.com/terms"])
        // file: scheme 拒（纵深防线，opener 不被触碰）。
        let bad = await bus.handleIncoming(envelope("app.request",
            payload: ["kind": "openExternal", "url": "file:///etc/passwd"]))
        guard case let .rejected(code, _) = try JSONDecoder().decode(
            AppResponse.self,
            from: JSONSerialization.data(withJSONObject: try #require(bad["payload"] as? [String: Any])))
        else { Issue.record("应为 rejected"); return }
        #expect(code == "OPEN_URL_INVALID")
        #expect(opened.urls.count == 1, "拒绝路径不得触 opener")
    }

    // MARK: - hook 面板缝（wait-detector.md §7 单绑定 + settings-modal.md 终端等待检测行）

    @MainActor
    final class FakeHookPanel: HookPanelHandling {
        var status: (state: HookInstallState, reason: String?)
        var enableResult: (state: HookInstallState, reason: String?)
        var enableError: Error?
        var enableCalls = 0
        init(
            status: (state: HookInstallState, reason: String?) = (.notInstalled, nil),
            enableResult: (state: HookInstallState, reason: String?) = (.installed, nil)
        ) {
            self.status = status
            self.enableResult = enableResult
        }
        var disableResult: (state: HookInstallState, reason: String?) = (.notInstalled, nil)
        var disableError: Error?
        var disableCalls = 0
        var noticeToConsume = false
        var noticeCalls = 0
        func panelStatus() -> (state: HookInstallState, reason: String?) { status }
        func requestEnable() async throws -> (state: HookInstallState, reason: String?) {
            enableCalls += 1
            if let enableError { throw enableError }
            return enableResult
        }
        func requestDisable() async throws -> (state: HookInstallState, reason: String?) {
            disableCalls += 1
            if let disableError { throw disableError }
            return disableResult
        }
        func consumeAutoEnableNotice() -> Bool {
            noticeCalls += 1
            let pending = noticeToConsume
            noticeToConsume = false
            return pending
        }
    }

    @MainActor
    @Test("app.request hookStatus：经缝回态（含 drift reason）；缝缺席（禁装门）→ disabled")
    func appRequestHookStatus() async throws {
        let panel = FakeHookPanel(status: (.drift, "settings.json 缺 hook：SessionStart"))
        let handler = AppRequestHandler(picker: StubPicker(result: nil), hookPanel: panel)
        let resp = await handler.handle(.hookStatus)
        #expect(resp == .hookStatus(state: .drift, reason: "settings.json 缺 hook：SessionStart"))

        // 缝缺席 = 禁装门分身：恒 disabled（web 侧不渲染该行），hookEnable 同。
        let bare = AppRequestHandler(picker: StubPicker(result: nil))
        let disabledStatus = await bare.handle(.hookStatus)
        #expect(disabledStatus == .hookStatus(state: .disabled, reason: nil))
        let disabledEnable = await bare.handle(.hookEnable)
        #expect(disabledEnable == .hookStatus(state: .disabled, reason: nil))
    }

    @MainActor
    @Test("app.request hookEnable：调缝恰一次并回终态；缝抛错 → rejected(HOOK_INSTALL_FAILED)")
    func appRequestHookEnable() async throws {
        let panel = FakeHookPanel(status: (.foreignBound, nil), enableResult: (.installed, nil))
        let handler = AppRequestHandler(picker: StubPicker(result: nil), hookPanel: panel)
        let resp = await handler.handle(.hookEnable)
        #expect(resp == .hookStatus(state: .installed, reason: nil))
        #expect(panel.enableCalls == 1)

        struct Boom: Error {}
        let failing = FakeHookPanel()
        failing.enableError = Boom()
        let failHandler = AppRequestHandler(picker: StubPicker(result: nil), hookPanel: failing)
        guard case let .rejected(code, _) = await failHandler.handle(.hookEnable) else {
            Issue.record("应为 rejected")
            return
        }
        #expect(code == "HOOK_INSTALL_FAILED")
    }

    @MainActor
    @Test("WD_panel_disable_route：hookDisable 调缝恰一次回终态；缝抛错 → rejected(HOOK_DISABLE_FAILED)；缝缺席 → disabled")
    func appRequestHookDisable() async throws {
        let panel = FakeHookPanel(status: (.installed, nil))
        panel.disableResult = (.notInstalled, nil)
        let handler = AppRequestHandler(picker: StubPicker(result: nil), hookPanel: panel)
        let resp = await handler.handle(.hookDisable)
        #expect(resp == .hookStatus(state: .notInstalled, reason: nil))
        #expect(panel.disableCalls == 1)

        struct Boom: Error {}
        let failing = FakeHookPanel()
        failing.disableError = Boom()
        let failHandler = AppRequestHandler(picker: StubPicker(result: nil), hookPanel: failing)
        guard case let .rejected(code, _) = await failHandler.handle(.hookDisable) else {
            Issue.record("应为 rejected")
            return
        }
        #expect(code == "HOOK_DISABLE_FAILED")

        let bare = AppRequestHandler(picker: StubPicker(result: nil))
        #expect(await bare.handle(.hookDisable) == .hookStatus(state: .disabled, reason: nil))
    }

    @MainActor
    @Test("WD_panel_notice_route：hookAutoEnableNotice 经缝消费（true 后自清）；缝缺席 → 恒 false")
    func appRequestHookAutoEnableNotice() async throws {
        let panel = FakeHookPanel()
        panel.noticeToConsume = true
        let handler = AppRequestHandler(picker: StubPicker(result: nil), hookPanel: panel)
        #expect(await handler.handle(.hookAutoEnableNotice) == .hookNotice(show: true))
        #expect(await handler.handle(.hookAutoEnableNotice) == .hookNotice(show: false), "查询即消费，一次性")
        #expect(panel.noticeCalls == 2)

        let bare = AppRequestHandler(picker: StubPicker(result: nil))
        #expect(await bare.handle(.hookAutoEnableNotice) == .hookNotice(show: false))
    }

    @MainActor
    @Test("M7 批3 legacyMigrationNotice：经消费闭包（首查 true 后自清一次性）；闭包缺席（default）→ 恒 false")
    func appRequestLegacyMigrationNotice() async throws {
        // 消费闭包模拟 native 一次性闩：首次 true，此后 false（AppDelegate 侧读 marker + 置 shown 闩同语义）。
        final class Box: @unchecked Sendable { var remaining = 1; var calls = 0 }
        let box = Box()
        let handler = AppRequestHandler(
            picker: StubPicker(result: nil),
            migrationNoticeConsume: {
                box.calls += 1
                if box.remaining > 0 { box.remaining -= 1; return true }
                return false
            })
        #expect(await handler.handle(.legacyMigrationNotice) == .migrationNotice(show: true))
        #expect(await handler.handle(.legacyMigrationNotice) == .migrationNotice(show: false), "查询即消费，一次性")
        #expect(box.calls == 2)

        // 闭包缺席（dev/test/迁移零命中默认）→ 恒 false。
        let bare = AppRequestHandler(picker: StubPicker(result: nil))
        #expect(await bare.handle(.legacyMigrationNotice) == .migrationNotice(show: false))
    }

    @Test("app.request auth*（B2 占位）：接线前一律 rejected(AUTH_UNAVAILABLE)——B5 换 AuthRequestRouter")
    func appRequestAuthStubRejected() async throws {
        let handler = AppRequestHandler(
            picker: StubPicker(result: nil), opener: StubOpener(result: true, record: { _ in }))
        let bus = BridgeBus(appVersion: "test")
        bus.onAppRequest = { req in await handler.handle(req) }
        for payload in [
            ["kind": "authStatus"],
            ["kind": "authLoginOAuth", "provider": "github"],
            ["kind": "authLogout"],
        ] as [[String: Any]] {
            let reply = await bus.handleIncoming(envelope("app.request", payload: payload))
            guard case let .rejected(code, _) = try JSONDecoder().decode(
                AppResponse.self,
                from: JSONSerialization.data(withJSONObject: try #require(reply["payload"] as? [String: Any])))
            else { Issue.record("应为 rejected：\(payload)"); return }
            #expect(code == "AUTH_UNAVAILABLE")
        }
    }
}

/// openExternal 测试取证盒（@MainActor suite 内闭包捕获可变数组的最小规避）。
@MainActor
final class OpenedURLBox {
    private(set) var urls: [URL] = []
    func append(_ u: URL) { urls.append(u) }
}
