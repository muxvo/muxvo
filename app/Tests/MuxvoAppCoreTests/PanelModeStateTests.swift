// 波3b panelMode 权威态翻牌（task-center-panel.md §1 + 裁决①-panelMode mode-consistency 不变量）：
//   · native 持 panelMode 为权威态（默认 .terminal）；setPanelMode 置态 + 重推带 panelMode 的 UIState。
//   · **不变量**：每个 UIState 构造恒置当前 mode——taskCenter 期一次无关 push 不翻回 terminal（唯一真风险）。
//   · optional 语义向后兼容：既有无 panelMode 关注的 fixture/断言不受影响（缺省 = .terminal）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore

@Suite("panelMode 权威态与 mode-consistency 不变量（§1 / 裁决①）", .serialized)
@MainActor
struct PanelModeStateTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-panelmode-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    @Test("默认 .terminal；setPanelMode 置权威态 + 重推 UIState.panelMode；getter 同步")
    func setPanelModePushesAndTracks() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }

        // 默认权威态 = .terminal：任一 push 携 panelMode == .terminal。
        service.handleAction(.restoreTiling)
        #expect(pushes.last?.panelMode == .terminal)
        #expect(service.panelMode == .terminal)

        // 切 taskCenter：置权威态 + 重推。
        service.setPanelMode(.taskCenter)
        #expect(service.panelMode == .taskCenter)
        #expect(pushes.last?.panelMode == .taskCenter)

        // 切回 terminal。
        service.setPanelMode(.terminal)
        #expect(service.panelMode == .terminal)
        #expect(pushes.last?.panelMode == .terminal)
    }

    @Test("不变量：taskCenter 期一次无关 push 不翻回 terminal（mode 存活于无关 push）")
    func modeSurvivesUnrelatedPush() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushes: [UIState] = []
        service.onState = { pushes.append($0) }

        service.setPanelMode(.taskCenter)
        #expect(pushes.last?.panelMode == .taskCenter)

        // 无关 push（选中/平铺/搜索等非 mode 动作）——绝不省略 panelMode 键→翻回 terminal。
        service.handleAction(.restoreTiling)
        #expect(pushes.last?.panelMode == .taskCenter) // 存活，不被无关 push 复位
        #expect(service.panelMode == .taskCenter)
    }

    @Test("同 mode setPanelMode 幂等 no-op（不重推）")
    func sameModeIsNoOp() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        var pushCount = 0
        service.onState = { _ in pushCount += 1 }

        service.setPanelMode(.taskCenter)
        let afterFirst = pushCount
        service.setPanelMode(.taskCenter) // 同 mode → no-op
        #expect(pushCount == afterFirst)
    }
}
