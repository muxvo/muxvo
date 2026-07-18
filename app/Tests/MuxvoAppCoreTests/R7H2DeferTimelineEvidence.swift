// T1' 契约取证（2026-07-10 第八轮；前身=m3-r7 批0 H2 推迟时间线，其预案「T1' 终审后另立契约测试」
// 即本次改写）：F7 门=合并窗新契约的定量时间线——settle 路径流式期全扣（原 H2 段保留）+ bounds 尾沿
// force 流式中落地（新段，经 flushBoundsForceCommit 共用入口，生产=门首扣后 ~200ms timer）+ 停流后
// 无重复提交。时间线落 ~/Library/Caches/muxvo-build/logs/t1-bounds-force-timeline.md
// （批0 原档 m3-r7-h2-defer-timeline.md 为历史证据不覆盖）。
// 装配/时钟纪律照 A6 逐条（真时钟 feed + 假时钟 settler，spawnShell=false 隔离会话）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoTerm
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("T1' 取证：F7 合并窗（settle 全扣）+ bounds 尾沿 force 落地时间线", .serialized)
@MainActor
struct R7H2DeferTimelineEvidence {

    private final class AtomicFlag: @unchecked Sendable {
        private let lock = NSLock()
        private var v = false
        var value: Bool { lock.lock(); defer { lock.unlock() }; return v }
        func set(_ nv: Bool) { lock.lock(); v = nv; lock.unlock() }
    }

    private func rect(_ id: String, w: CGFloat, h: CGFloat = 800) -> TermRect {
        TermRect(terminalId: id, x: 0, y: 0, w: w, h: h, visible: true, role: .grid)
    }

    @Test("T1' 时间线：settle 路径流式全扣（合并窗）→ bounds 尾沿 force 流式中落地 → 停流无重复提交")
    func deferTimelineDuringStream() throws {
        let registry = SessionRegistry()
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        guard case let .success(sid) = registry.create(config: cfg) else {
            throw CocoaError(.featureUnsupported)
        }
        defer { registry.close(sid) }
        let s = try #require(registry.session(for: sid))
        let provider = SurfaceProvider(registry: registry, device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        host.view.frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        host.applyLayout([rect(sid.raw, w: 1200)], stateId: "s1")
        let surface = try #require(
            host.attachedSurfaceView(forKey: "\(sid.raw)#grid") as? TerminalSurfaceView)
        var now: UInt64 = 1_000
        surface.settleNowMs = { now }
        surface.layout()
        now += 200
        surface.flushGridSettle()
        let baseline = Int(s.cols)

        // 流式：真时钟 30ms 间隔 feed（<quietMs 400 → 门恒关），照 A6。
        let feeding = AtomicFlag()
        let feeder = Thread {
            while feeding.value { s.feed("stream-tick\r\n"); Thread.sleep(forTimeInterval: 0.03) }
        }
        feeding.set(true); feeder.start()
        let deadline0 = Date().addingTimeInterval(3)
        while s.msSinceLastOutput() == nil && Date() < deadline0 { Thread.sleep(forTimeInterval: 0.01) }
        #expect(s.msSinceLastOutput() != nil)

        // T0：变窄（1200→900pt，模拟拖分隔条松手报文；trailing 由门管辖）。
        var timeline: [String] = []
        let t0 = Date()
        host.applyLayout([rect(sid.raw, w: 900)], stateId: "narrow")
        surface.layout()
        func sample(_ note: String) {
            let ms = Int(Date().timeIntervalSince(t0) * 1000)
            timeline.append("| \(ms) | \(Int(s.cols)) | \(s.msSinceLastOutputForTestDescription) | \(note) |")
        }
        sample("T0 变窄报文（1200→900pt）")

        // 段1（原 H2 契约保留）：settle 路径流式期全扣——每 ~100ms 推一次 trailing（等价生产门内
        // 重挂 timer 到期重试），共 0.7s，全部被扣；门首扣即武装 bounds 尾沿 force（T1' 接线证据）。
        var deferredFlushes = 0
        for i in 1...7 {
            Thread.sleep(forTimeInterval: 0.1)
            now += 100
            surface.flushGridSettle()
            let held = Int(s.cols) == baseline
            if held { deferredFlushes += 1 }
            sample("流式中重试#\(i)（推迟=\(held)）")
        }
        let heldAll = Int(s.cols) == baseline
        #expect(heldAll) // settle 路径契约不变：活跃期恒扣（合并窗）
        let armedDuringStream = surface.boundsForceTimerArmedForTest
        #expect(armedDuringStream) // T1'：门扣下即武装尾沿 force

        // 段2（T1' 新契约）：尾沿到期（生产 ~200ms timer；取证经共用入口手动触发，Thread.sleep 阻塞
        // 主 runloop 故真 timer 在本测不自发 fire——确定性）→ 流式中 force 绕门落地现时几何。
        let stillStreaming = s.msSinceLastOutput().map { $0 < 400 } ?? false
        surface.flushBoundsForceCommit()
        let landedAtMs = Int(Date().timeIntervalSince(t0) * 1000)
        sample("尾沿 force 到期（流式中=\(stillStreaming)）→ 落地")
        let cell = surface.cellSizePxForTest
        let want = Int(900 * 2) / cell.w // O1a：宽度无下限项，恒 bounds 容量
        #expect(stillStreaming)          // 落地发生在流式中（与原契约的本质分野）
        #expect(Int(s.cols) == want)
        #expect(!surface.boundsForceTimerArmedForTest)

        // 段3：停流后无重复提交（force 已收编候选；静默到期无残余可吐）。
        feeding.set(false)
        let appliedAfterForce = s.resizeAppliedCountForTest
        Thread.sleep(forTimeInterval: 0.5) // 真时钟静默 > quietMs(400)
        now += 500
        surface.flushGridSettle()
        sample("停流后静默复查（重复提交=\(s.resizeAppliedCountForTest != appliedAfterForce)）")
        #expect(s.resizeAppliedCountForTest == appliedAfterForce)
        #expect(Int(s.cols) == want)

        let md = """
        # T1' 取证：F7 合并窗 + bounds 尾沿 force 时间线（2026-07-10 第八轮；前身 m3-r7 批0 H2 时间线）

        - 装配：隔离会话（spawnShell=false）、tile 1200pt→900pt 变窄、真时钟 30ms feed（<quietMs 400）
        - 基线 cols=\(baseline)，终值期望 cols=\(want)（=bounds 容量，O1a 宽度无下限），cellW=\(cell.w)
        - 段1（合并窗，原 H2 契约保留）：流式期 0.7s 内 settle 重试 \(deferredFlushes)/7 次全扣（cols 恒=基线）；
          门首扣即武装 bounds 尾沿 force（armed=\(armedDuringStream)）
        - 段2（T1' 新契约）：尾沿 force 于 T0+\(landedAtMs)ms **流式中**落地终值（生产=门首扣后 ~200ms one-shot
          timer，输出不重置；取证经 flushBoundsForceCommit 共用入口触发——Thread.sleep 阻塞 runloop，真 timer
          不自发 fire，确定性）
        - 段3：停流后无重复提交（force 落地即收编 settler 候选 + disarm）
        - 结论：**F7 自「饿死门」改「合并窗」——settle 路径流式全扣不变，落地职责移交尾沿 force，bounds 稳定后
          流式与否均有界落地**。原契约「停流才落地」对 0 gap 流（CC background-agent spinner 分钟级）= 永不落地，
          即第八轮聚焦切换饿死根因；红档见 t1-red-unit.log（A11/A12：force 置 false 时 cols 滞留 141、右溢出）。
        - 保真旁注（沿批0 Gap-3 口径）：settle 钟为注入假钟+手动 100ms 节拍；F7 门判据 msSinceLastOutput 用
          真墙钟、feed 为真 30ms 投喂——每次 flush 真到门、真被拦，段1/段2 结论不受节拍差影响。

        | T0 起毫秒 | session.cols | msSinceLastOutput | 事件 |
        |---|---|---|---|
        \(timeline.joined(separator: "\n"))
        """
        let path = NSHomeDirectory() + "/Library/Caches/muxvo-build/logs/t1-bounds-force-timeline.md"
        try? md.appending("\n").write(toFile: path, atomically: true, encoding: .utf8)
    }
}

private extension TerminalSession {
    /// 取证显示用（避免 Optional 串进 markdown 表格）。
    var msSinceLastOutputForTestDescription: String {
        msSinceLastOutput().map { "\($0)ms" } ?? "nil"
    }
}
