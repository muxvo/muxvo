// 自动更新装配层用例（auto-update.md §1/§7/§9）：生产启用门 / app.request update 域分发 /
// WhatsNewService 数据链（changelog 读取 + lastSeenVersion 查询即写回）。
// 引擎/弹窗/换装真链路：e2e（RecordingDialogPresenter）+ tools/update-swap 真机脚本覆盖。

import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTestSupport
import MuxvoUpdater
@testable import MuxvoAppCore

@MainActor
private final class NoopPicker: DirectoryPicker {
    func pick(defaultPath: String?) async -> String? { nil }
}

@MainActor
private func makeConfigModel(root: URL) -> ConfigModel {
    ConfigModel(store: ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName)))
}

@Suite("自动更新装配（auto-update.md §1/§9）")
@MainActor
struct UpdateGateTests {

    @Test("UPD_prod_only_gate: feed URL 双缺席=门关（nil）；env 覆盖优先于 Info.plist；关门下 updateCheck/updateDownload 即时 ack 零副作用")
    func productionGate() async {
        // 门解析：env → plist → nil（测试 bundle 无 MuxvoUpdateFeedURL 键 → 仅 env 生效）。
        #expect(UpdateAssembly.feedURL(environment: [:]) == nil)
        #expect(UpdateAssembly.feedURL(environment: ["MUXVO_UPDATE_FEED_URL": "http://127.0.0.1:9999/appcast.xml"])?
            .absoluteString == "http://127.0.0.1:9999/appcast.xml")

        // 关门（updateActions=nil，legacy dev no-op :896-900 对等）：即时 ack、零推送零网络
        //（无引擎对象存在，网络面物理为零；web 端 8s 超时判「已是最新」）。
        let handler = AppRequestHandler(picker: NoopPicker())
        #expect(await handler.handle(.updateCheck) == .updateAck)
        #expect(await handler.handle(.updateDownload) == .updateAck)
        // What's New 接缝也缺席 → 空数据 + 不弹（shouldShow false）。
        #expect(await handler.handle(.releaseNotes(locale: "zh")) == .releaseNotes(entries: []))
        let status = await handler.handle(.whatsNewStatus)
        guard case let .whatsNewStatus(shouldShow, _) = status else {
            Issue.record("whatsNewStatus 响应形状不对：\(status)")
            return
        }
        #expect(shouldShow == false)
    }

    @Test("MUXVO_UPDATE_TIMINGS_MS 时序毫秒化：轮询间隔=替值、72h 等比缩放；缺席=6h/72h 默认")
    func timingsOverride() {
        let defaults = UpdateAssembly.timings(environment: [:])
        #expect(defaults.checkInterval == 6 * 3600)
        #expect(defaults.snoozeRepromptDelay == 72 * 3600)
        // 替值 3000ms：checkInterval=3s，snooze 等比 = 3s × 12 = 36s。
        let scaled = UpdateAssembly.timings(environment: ["MUXVO_UPDATE_TIMINGS_MS": "3000"])
        #expect(scaled.checkInterval == 3)
        #expect(scaled.snoozeRepromptDelay == 36)
    }

    @Test("UpdateEvent → data.event 映射逐分支（auto-update.md §9 表）")
    func eventMapping() {
        #expect(BroadcastUpdateEventSink.dataEvent(for: .checking) == .updateChecking)
        #expect(BroadcastUpdateEventSink.dataEvent(for: .available(version: "2.0.0"))
            == .updateAvailable(version: "2.0.0"))
        #expect(BroadcastUpdateEventSink.dataEvent(for: .notAvailable) == .updateNotAvailable)
        #expect(BroadcastUpdateEventSink.dataEvent(
            for: .downloading(percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 77))
            == .updateDownloading(percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 77))
        #expect(BroadcastUpdateEventSink.dataEvent(for: .downloaded(version: "2.0.0"))
            == .updateDownloaded(version: "2.0.0"))
        #expect(BroadcastUpdateEventSink.dataEvent(for: .error) == .updateError)
    }
}

@Suite("WhatsNewService 数据链（auto-update.md §7）")
@MainActor
struct WhatsNewServiceTests {

    @Test("releaseNotes：locale en 读 en、其余一律 zh；目录/文件缺失 → []（空态）")
    func releaseNotesLocaleMapping() throws {
        try withTempRoot { root in
            try "## [1.0.0] - 2026-01-01\n### Added\n- 中文条目\n"
                .write(to: root.appendingPathComponent("CHANGELOG.zh.md"), atomically: true, encoding: .utf8)
            try "## [1.0.0] - 2026-01-01\n### Added\n- english item\n"
                .write(to: root.appendingPathComponent("CHANGELOG.en.md"), atomically: true, encoding: .utf8)
            let model = makeConfigModel(root: root)
            let log = FileUpdateLogger(path: root.appendingPathComponent("logs/update.log"))
            let service = WhatsNewService(
                configModel: model, log: log, changelogDirectory: root, appVersion: "1.0.0")

            #expect(service.releaseNotes(locale: "zh").first?.sections.first?.items == ["中文条目"])
            #expect(service.releaseNotes(locale: "en").first?.sections.first?.items == ["english item"])
            // en 之外一律 zh（legacy app-handlers.ts:33）。
            #expect(service.releaseNotes(locale: "fr").first?.sections.first?.items == ["中文条目"])

            let missing = WhatsNewService(
                configModel: model, log: log,
                changelogDirectory: root.appendingPathComponent("不存在"), appVersion: "1.0.0")
            #expect(missing.releaseNotes(locale: "zh") == [])
        }
    }

    @Test("UPD_whatsnew_seen_writeback: whatsNewStatus 查询即写回 config.json lastSeenVersion（首装不弹但写回；升级弹+写回+日志 token；同版不写）")
    func statusWriteback() throws {
        try withTempRoot { root in
            let logPath = root.appendingPathComponent("logs/update.log")
            let log = FileUpdateLogger(path: logPath)

            // 首装：lastSeen 缺席 → 不弹但写回（legacy App.tsx:180-182 恒更新）。
            let freshModel = makeConfigModel(root: root)
            let fresh = WhatsNewService(
                configModel: freshModel, log: log, changelogDirectory: root, appVersion: "2.0.0")
            let first = fresh.whatsNewStatus()
            #expect(first.shouldShow == false)
            #expect(first.appVersion == "2.0.0")
            #expect(freshModel.config.lastSeenVersion == "2.0.0")

            // 升级后首启：重建 model（同 store 文件=跨重启），版本升到 2.1.0 → 弹 + 写回 + 日志 token。
            let upgraded = WhatsNewService(
                configModel: makeConfigModel(root: root), log: log,
                changelogDirectory: root, appVersion: "2.1.0")
            let second = upgraded.whatsNewStatus()
            #expect(second.shouldShow == true)
            let written = makeConfigModel(root: root).config.lastSeenVersion
            #expect(written == "2.1.0")
            let logContent = try String(contentsOf: logPath, encoding: .utf8)
            #expect(logContent.contains("update:whats-new-shown v2.1.0"))

            // 同版本再查：不弹，且不再写。
            let same = WhatsNewService(
                configModel: makeConfigModel(root: root), log: log,
                changelogDirectory: root, appVersion: "2.1.0")
            #expect(same.whatsNewStatus().shouldShow == false)
        }
    }
}
