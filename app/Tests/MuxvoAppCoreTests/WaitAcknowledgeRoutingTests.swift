// ui.action → 隐含 wait acknowledge 路由（DOGFOOD_M3_08 ☆ 用户裁决 2026-07-04）：
// tileClick / sidebarSelect / acknowledgeWaiting 三动作均隐含 acknowledge（sidebarSelect 是本单补的缺口——
// 切到 sidebar 预览查看 = 已看过），其余动作不触发。纯函数 seam 照 DOGFOOD_M3_06 surfaceClickAction 先例，
// handleAction 顶部单点消费，防下次再漏。
//
// 命名纪律：本文件对应 wait-detector.md §10 案例 WD_ack_sidebar_select；测试名不得像 legacy spec ID。
import Foundation
import Testing
import MuxvoBridge
@testable import MuxvoAppCore

@Suite("ui.action 隐含 acknowledge 路由（DOGFOOD_M3_08）")
@MainActor
struct WaitAcknowledgeRoutingTests {

    @Test("WD_ack_sidebar_select: tileClick/sidebarSelect/acknowledgeWaiting → 目标 id；其余动作 → nil")
    func impliedAcknowledgeTargets() {
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.tileClick(terminalId: "T1")) == "T1")
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.sidebarSelect(terminalId: "T2")) == "T2")
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.acknowledgeWaiting(terminalId: "T3")) == "T3")
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.maximizeTile(terminalId: "T4")) == nil)
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.restoreTiling) == nil)
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.reorder(order: ["a", "b"])) == nil)
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.renameSubmit(terminalId: "T5", name: "x")) == nil)
    }

    @Test("TG_MIN_waiting_ack_on_restore: restoreTile → 目标 id（恢复即看过，term-grid.md §11）；minimizeTile/restoreAllMinimized → nil")
    func restoreTileImpliesAcknowledge() {
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.restoreTile(terminalId: "T6")) == "T6")
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.minimizeTile(terminalId: "T7")) == nil)
        #expect(TerminalService.impliedWaitAcknowledgeTarget(.restoreAllMinimized) == nil)
    }
}
