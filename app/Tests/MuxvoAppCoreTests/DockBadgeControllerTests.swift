// DockBadgeController 直测（M6 批1）。注入 setBadge 收集器 + 假 timer 工厂（手动 tick），验 off/realtime/
// timed 三模式 legacy dock-badge.ts 亲验行为。非 spec（中文名，防伪面）。
// 尾部另有徽标口径装配套件（settings-dogfood 批：silence 计入 Σ、浮卡分流）。
import Foundation
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("DockBadgeController（off/realtime/timed，legacy dock-badge.ts 亲验）")
struct DockBadgeControllerTests {
    final class Spy {
        var badges: [String?] = []
        var timerInterval: TimeInterval?
        var fire: (() -> Void)?
        var timersMade = 0
    }

    final class SpyTimer: DockBadgeTimer {
        func invalidate() {}
    }

    private func make(mode: DockBadgeMode, interval: Int, spy: Spy) -> DockBadgeController {
        DockBadgeController(
            mode: mode, intervalMin: interval,
            setBadge: { spy.badges.append($0) },
            makeTimer: { iv, fire in
                spy.timerInterval = iv
                spy.fire = fire
                spy.timersMade += 1
                return SpyTimer()
            })
    }

    @Test("realtime：waitingCount>0 显数字，=0 清；不起 timer")
    func realtime() {
        let spy = Spy()
        let c = make(mode: .realtime, interval: 1, spy: spy)
        c.update(waitingCount: 2)
        c.update(waitingCount: 0)
        #expect(spy.badges.contains("2"))
        #expect(spy.badges.last! == nil) // 最后清
        #expect(spy.timersMade == 0)
    }

    @Test("off：恒清，waitingCount 变化从不显数字")
    func off() {
        let spy = Spy()
        let c = make(mode: .off, interval: 1, spy: spy)
        c.update(waitingCount: 5)
        #expect(spy.badges.allSatisfy { $0 == nil })
    }

    @Test("timed：起 interval*60 秒 timer；tick 采样最新 count 落徽标（onStateChange 亦即时刷）")
    func timed() {
        let spy = Spy()
        let c = make(mode: .timed, interval: 3, spy: spy)
        #expect(spy.timerInterval == 180)
        #expect(spy.timersMade == 1)
        c.update(waitingCount: 4) // legacy onStateChange 在 timed 亦即时刷
        #expect(spy.badges.contains("4"))
        // 手动 tick → applyBadge 采样最新 count
        spy.badges.removeAll()
        spy.fire?()
        #expect(spy.badges == ["4"])
    }

    @Test("reconfigure：realtime→off 清 + off 下不显；→timed 重起 timer")
    func reconfigureTransitions() {
        let spy = Spy()
        let c = make(mode: .realtime, interval: 1, spy: spy)
        c.update(waitingCount: 3)
        #expect(spy.badges.contains("3"))
        c.reconfigure(mode: .off, intervalMin: 1)
        #expect(spy.badges.last! == nil)
        c.update(waitingCount: 9)
        #expect(spy.badges.last! == nil) // off 下不显
        c.reconfigure(mode: .timed, intervalMin: 2)
        #expect(spy.timerInterval == 120)
    }
}

// MARK: - 徽标口径装配（settings-dogfood 批：deliver → hub Σ 用可见等待数，浮卡保持强口径）

/// wait-detector.md §8 Dock badge 行：Dock 徽标=等待中终端总数（含静默弱信号，与 in-app WaitingInput 黄灯一致，
/// legacy dock-badge.ts 口径）；浮卡 waitingNotification 维持强口径（WD_count_excludes_silence 冻结）。
/// 真 spawn service（照 SurfaceClickDispatchTests 体例）经 hubNoteWaiting 公开缝驱动等待态，
/// 断言缝 hub.windowWaitingTotalForTest（deliver 喂 Σ 的装配直证——修前必红：silence 喂 0）。
@Suite("Dock 徽标口径装配（silence 计入 Σ / 浮卡分流）", .serialized)
@MainActor
struct DockBadgeSemanticAssemblyTests {

    /// noteWaiting 经 50ms 去抖（StateDebouncer.flush 只在暂存满窗后 emit）：推进真时钟 + 反复 flush
    /// 直至 deliver 落 Σ（生产由 hub 心跳泵周期 flush，此处等价手泵）。
    private func pumpUntilBadgeTotal(
        _ service: TerminalService, _ expected: Int, timeout: TimeInterval = 3
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            service.hubFlushProjection()
            if service.hub.windowWaitingTotalForTest == expected { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        service.hubFlushProjection()
        return service.hub.windowWaitingTotalForTest == expected
    }

    @Test("silence 等待 → hub Σ=1（徽标口径）且浮卡 nil；layer0 → Σ=1 且浮卡 count=1；清 → Σ=0")
    func silenceFeedsBadgeButNotNotification() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-badgecal-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
        let ids = service.createStartupTerminals(count: 1)
        try #require(ids.count == 1)
        defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }
        let sid = SessionID(raw: ids[0])

        var last: UIState?
        service.onState = { last = $0 }

        // 静默弱信号：徽标 Σ 计入、浮卡不出（口径分流）。
        service.hubNoteWaiting(sid, .silence)
        #expect(await pumpUntilBadgeTotal(service, 1),
                "silence 须计入 Dock 徽标 Σ（修前红：强口径喂 0；实得 \(service.hub.windowWaitingTotalForTest)）")
        #expect(last?.waitingNotification == nil, "silence 不出浮卡（强口径冻结）")

        // 强信号：两口径同为 1，浮卡出现（Σ 不变仍 1，以浮卡出现为推送落地信号）。
        service.hubNoteWaiting(sid, .layer0)
        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline, last?.waitingNotification == nil {
            service.hubFlushProjection()
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        #expect(service.hub.windowWaitingTotalForTest == 1)
        #expect(last?.waitingNotification?.count == 1)

        // 清：Σ 归零、浮卡消失。
        service.hubNoteWaiting(sid, nil)
        #expect(await pumpUntilBadgeTotal(service, 0))
        #expect(last?.waitingNotification == nil)
    }
}
