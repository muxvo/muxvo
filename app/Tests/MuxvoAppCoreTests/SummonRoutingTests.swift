// 呼出点击路由单测（interactive-worker.md §4，M4b B2-7 MAJOR-2）：AppDelegate 全装配难脱窗构造，
// 故把 didReceive 的两件事抽成最小可测单元——① 从通知 userInfo 提取 taskId（SummonRouting 纯函数）；
// ② routeSummon 落点（记 taskId + 切任务中心，terminalService 缺席即仅记不崩）。
// 命名纪律：非 spec-ID 翻牌，测试名不得像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoStorage

@testable import MuxvoAppCore

@Suite("呼出点击路由（§4 MAJOR-2）", .serialized)
struct SummonRoutingTests {
    @Test("解析：summonTaskId 从 userInfo 取 taskId——键命中取值、缺键/非串/他键 → nil")
    func summonTaskIdParse() {
        #expect(SummonRouting.summonTaskId(fromUserInfo: [OrchNotifier.summonTaskIdKey: "t-7"]) == "t-7")
        #expect(SummonRouting.summonTaskId(fromUserInfo: [:]) == nil)
        #expect(SummonRouting.summonTaskId(fromUserInfo: ["other": "x"]) == nil)
        #expect(SummonRouting.summonTaskId(fromUserInfo: [OrchNotifier.summonTaskIdKey: 42]) == nil,
                "非字符串值 → nil（不误取）")
    }

    @MainActor
    @Test("落点：routeSummon 记录 taskId（terminalService 缺席仅记不崩，切屏走既有 setPanelMode 路径）")
    func routeSummonRecordsTaskId() {
        let delegate = AppDelegate()
        #expect(delegate.lastRoutedSummonTaskId == nil)
        delegate.routeSummon(taskId: "task-42")
        #expect(delegate.lastRoutedSummonTaskId == "task-42", "点击落点须记末次路由 taskId")
    }

    @MainActor
    @Test("MW_summon_routes_active_window：routeSummon 落最近活跃窗（activeContext）——切该窗任务中心、其余窗零扰动（裁决⑥）")
    func MW_summon_routes_active_window() {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-summon-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let hub = SessionHub(
            configModel: ConfigModel(store: store), ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        let ctx2 = wm.newWindow()
        defer { ctx1.service.stop(); ctx2.service.stop() }

        let delegate = AppDelegate()
        delegate.windowManager = wm

        // routeSummon 落 activeContext（§6.1 keyWindow→last-active→首窗兜底；优先级由 MW_menu_routes_key_window
        // 纯函数覆盖）——此处解析目标一次，routeSummon 复现同解析（同状态、无变更）。
        let target = wm.activeContext
        delegate.routeSummon(taskId: "t-summon")

        #expect(delegate.lastRoutedSummonTaskId == "t-summon")
        #expect(target?.service.panelMode == .taskCenter, "呼出切最近活跃窗任务中心（裁决⑥）")
        for c in wm.contexts where c.windowId != target?.windowId {
            #expect(c.service.panelMode == .terminal, "呼出只切最近活跃窗，其余窗零扰动")
        }
    }
}
