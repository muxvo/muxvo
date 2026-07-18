// WaitDetector 核心/总线/协调器/自应答/投影计数 单测（批5①，wait-detector.md §9「单测大头」）。
//
// 覆盖 §10 案例表：WD_layer0_notification/stop/userprompt、WD_reset_on_write、WD_acknowledge_tileclick、
// WD_priority_layer0_over_silence、WD_silence_30s、WD_silence_clear、WD_count_excludes_silence、
// WD_debounce_50ms、WD_waiteventbus_shape。detector 核 = 纯函数式表驱动 + 假时钟（无真钟/真进程）。
//
// 命名：@Test 描述含 WD_* 案例名；helper/Suite 名不得像 spec ID。
import Darwin
import Foundation
import Testing
import MuxvoKit
import MuxvoTermCore
@testable import MuxvoTerm

// MARK: - 共享 helper

private func pollUntil(timeout: TimeInterval = 3, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(5_000)
    }
    return cond()
}

private final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    init(_ start: UInt64) { value = start }
    func read() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ ms: UInt64) { lock.lock(); value = ms; lock.unlock() }
    var nowMs: () -> UInt64 { { self.read() } }
}

private func isolatedTemplate() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.spawnShell = false
    return c
}

private func tmpDir() -> String { FileManager.default.temporaryDirectory.path }

// MARK: - detector 核（假时钟，纯函数式）

@Suite("WaitDetectorCore 层合成 + 静默门控（批5①）", .serialized)
struct WaitDetectorCoreTests {

    @Test("WD_layer0_notification / WD_layer0_stop: Notification/Stop → WaitingInput(.layer0)")
    func layer0EntersWaiting() {
        for kind in [WaitEventKind.notification, .stop] {
            let core = WaitDetectorCore(startMs: 0)
            let c = core.ingest(kind, ts: 100)
            #expect(c.state == .waitingInput)
            #expect(c.source == .layer0)
            #expect(c.isWaiting)
            #expect(c.countsToNotification) // 强信号计入 count
        }
    }

    @Test("WD_layer0_userprompt: UserPromptSubmit 清红回 Running（兜粘贴/提交），hook 流仍记")
    func userPromptSubmitClearsToRunning() {
        let core = WaitDetectorCore(startMs: 0)
        _ = core.ingest(.notification, ts: 10)
        let c = core.ingest(.userPromptSubmit, ts: 20)
        #expect(c.state == .running)
        #expect(!c.isWaiting)
        #expect(core.hasLayer0Flow) // hasSeenLayer0 持久
    }

    @Test("WD_layer0_sessionstart_no_state: SessionStart → detector 零影响（不改态/不标 hook 流/不豁免静默）")
    func sessionStartHasNoDetectorEffect() {
        // 净态：sessionStart 不产生任何状态（登记 4：仅锚点采集，detector 零消费）。
        let core = WaitDetectorCore(startMs: 0)
        let c = core.ingest(.sessionStart, ts: 100)
        #expect(c.state == .running)
        #expect(!core.hasLayer0Flow, "不标 hook 流——否则 resume 后闲置会话失去静默兜底弱提示")
        // 等待态在场：sessionStart 不清红（resume 注入瞬间不得误清真实等待）。
        let core2 = WaitDetectorCore(startMs: 0)
        _ = core2.ingest(.notification, ts: 10)
        let c2 = core2.ingest(.sessionStart, ts: 20)
        #expect(c2.state == .waitingInput)
        #expect(c2.source == .layer0)
    }

    @Test("WD_reset_on_write: userInput reset → 全层清回 Running（idempotent 复摄不变）")
    func userInputResetsAllLayers() {
        let core = WaitDetectorCore(startMs: 0)
        _ = core.ingest(.notification, ts: 10)
        #expect(core.conclusion.isWaiting)
        let c1 = core.ingest(.userInput, ts: 20)
        #expect(c1.state == .running)
        let c2 = core.ingest(.userInput, ts: 30) // 再次同态 → 幂等
        #expect(c2.state == .running)
    }

    @Test("WD_acknowledge_tileclick: acknowledge（tileClick/acknowledgeWaiting）→ 清红")
    func acknowledgeClearsRed() {
        let core = WaitDetectorCore(startMs: 0)
        _ = core.ingest(.stop, ts: 10)
        #expect(core.conclusion.isWaiting)
        let c = core.ingest(.acknowledge, ts: 20)
        #expect(c.state == .running)
    }

    @Test("WD_silence_30s: 无 hook + 前台非 shell + 静默 ≥30s → 弱 WaitingInput(.silence)；29999ms 边界内不触发")
    func silenceFiresAt30sBoundary() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        // 边界内（29999ms）不触发。
        #expect(core.evaluateSilence(nowMs: 29_999).state == .running)
        // 恰 30000ms 触发弱信号（source=.silence，不计 count）。
        let c = core.evaluateSilence(nowMs: 30_000)
        #expect(c.state == .waitingInput)
        #expect(c.source == .silence)
        #expect(!c.countsToNotification) // 静默弱信号不计入 count
    }

    @Test("WD_silence_30s 门控：前台是 shell（无非 shell 前台）→ 永不触发静默")
    func silenceRequiresNonShellForeground() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(false)
        #expect(core.evaluateSilence(nowMs: 60_000).state == .running)
    }

    @Test("WD_silence_clear: 静默态收到任意输出（recordActivity）→ 下轮 evaluateSilence 清")
    func silenceClearsOnActivity() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        #expect(core.evaluateSilence(nowMs: 30_000).state == .waitingInput)
        core.recordActivity(ts: 30_000)                       // 新输出推进基准
        #expect(core.evaluateSilence(nowMs: 40_000).state == .running) // 距今仅 10s < 30s
    }

    @Test("WD_silence_clear：前台进程退出（processExit）→ 清静默弱信号 + 前台回空")
    func silenceClearsOnForegroundExit() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        _ = core.evaluateSilence(nowMs: 30_000)
        #expect(core.conclusion.source == .silence)
        let c = core.ingest(.processExit, ts: 30_000)
        #expect(c.state == .running)
    }

    @Test("WD_priority_layer0_over_silence: 收到过 Layer 0 的终端，静默 40s 永不触发弱信号（hasSeenLayer0 永久豁免）")
    func hookTerminalExemptFromSilence() {
        let core = WaitDetectorCore(startMs: 0)
        _ = core.ingest(.notification, ts: 0)
        _ = core.ingest(.userPromptSubmit, ts: 0) // 清 layer0 等待，但 hasSeenLayer0 持久
        core.setForegroundNonShell(true)
        #expect(core.evaluateSilence(nowMs: 40_000).state == .running) // 静默永不接管 hook 终端
        // reset 也不清 hasSeenLayer0：
        _ = core.ingest(.userInput, ts: 40_000)
        #expect(core.evaluateSilence(nowMs: 80_000).state == .running)
    }

    @Test("层优先级 Layer 0 > 静默：两层同时为真时，结论 source=.layer0（先判 layer0）")
    func layer0DominatesSilenceInConclusion() {
        let core = WaitDetectorCore(startMs: 0)
        // 直投 .silence（绕门控，仅无 hook 流接受）→ 先置静默。
        _ = core.ingest(.silence, ts: 0)
        #expect(core.conclusion.source == .silence)
        // 再来 Layer 0：hasSeenLayer0=true、layer0Waiting=true、silence 被清 → source=.layer0。
        _ = core.ingest(.notification, ts: 10)
        #expect(core.conclusion.source == .layer0)
    }

    // MARK: DOGFOOD_M3_08：ack 后静默抑制（☆ 用户裁决 2026-07-04：有新动静才再提）

    @Test("WD_silence_ack_no_rearm: ack 后无新输出，+30s/+10min 均不重触发静默弱信号")
    func silenceAckNoRearmWithoutNewOutput() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        #expect(core.evaluateSilence(nowMs: 30_000).source == .silence) // 首次触发
        _ = core.ingest(.acknowledge, ts: 30_500)                       // 用户确认
        #expect(core.conclusion.state == .running)
        // ack 后恰满 30s（旧代码：60_500-30_500=30_000 ≥ 阈值 → 重亮，红）。
        #expect(core.evaluateSilence(nowMs: 60_500).state == .running)
        // +10min 仍不重亮。
        #expect(core.evaluateSilence(nowMs: 630_500).state == .running)
    }

    @Test("WD_silence_ack_no_rearm 陷阱变体：poll 反复喂陈旧 lastOutputMs（ts ≤ 水位）不解除抑制")
    func staleActivityDoesNotLiftSuppression() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        _ = core.evaluateSilence(nowMs: 30_000)
        _ = core.ingest(.acknowledge, ts: 30_500)
        // 模拟 poll 每轮以陈旧 lastOutputMs=10_000 喂入（< ack 水位）——绝不解除。
        for now in stride(from: UInt64(31_000), through: 70_000, by: 1_000) {
            core.recordActivity(ts: 10_000)
            #expect(core.evaluateSilence(nowMs: now).state == .running)
        }
    }

    @Test("WD_silence_new_output_new_episode: ack 后新输出（ts>水位）解除 → 再静默满 30s 重新触发；29999ms 边界内不触发")
    func newOutputOpensNewEpisode() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        _ = core.evaluateSilence(nowMs: 30_000)
        _ = core.ingest(.acknowledge, ts: 30_500)
        core.recordActivity(ts: 61_000) // 新输出 > 水位 30_500 → 开新 episode
        #expect(core.evaluateSilence(nowMs: 90_999).state == .running)  // 距新输出 29_999ms
        let c = core.evaluateSilence(nowMs: 91_000)                     // 满 30s
        #expect(c.state == .waitingInput)
        #expect(c.source == .silence) // 语义保真：提醒没被修死
    }

    @Test("WD_silence_ack_no_rearm（userInput 变体）：键入同样置抑制；其后新输出开新 episode")
    func userInputAlsoSuppresses() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        _ = core.evaluateSilence(nowMs: 30_000)
        _ = core.ingest(.userInput, ts: 30_500)
        #expect(core.evaluateSilence(nowMs: 60_500).state == .running)  // 旧代码红
        core.recordActivity(ts: 32_000) // echo 回显（> 输入 ts）→ 解除
        #expect(core.evaluateSilence(nowMs: 62_000).state == .waitingInput)
    }

    @Test("WD_silence_ack_no_rearm（直投变体）：抑制期内 .silence 直投同样被门控")
    func directSilenceInjectionSuppressed() {
        let core = WaitDetectorCore(startMs: 0)
        core.setForegroundNonShell(true)
        _ = core.evaluateSilence(nowMs: 30_000)
        _ = core.ingest(.acknowledge, ts: 30_500)
        _ = core.ingest(.silence, ts: 40_000) // replay/直投路径
        #expect(core.conclusion.state == .running) // 旧代码红：直投绕过抑制
    }
}

// MARK: - 终端自应答识别（WD_reset_on_write 排除项）

@Suite("TerminalAutoResponse 自应答识别（批5①）")
struct TerminalAutoResponseTests {
    private func bytes(_ s: String) -> [UInt8] { Array(s.utf8) }

    @Test("WD_reset_on_write 排除：CPR/焦点/DA 自应答判为自应答（不触发 reset）")
    func recognizesAutoResponses() {
        #expect(TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[24;80R")))  // 光标位置报告
        #expect(TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[1;1R")))
        #expect(TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[I")))       // 焦点进入
        #expect(TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[O")))       // 焦点离开
        #expect(TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[?1;2c")))   // 设备属性
        #expect(TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[?c")))      // DA 无参数
    }

    @Test("WD_reset_on_write：真实用户字节不判为自应答（触发 reset）")
    func realUserInputNotAutoResponse() {
        #expect(!TerminalAutoResponse.isAutoResponse(bytes("ls -la\r")))
        #expect(!TerminalAutoResponse.isAutoResponse(bytes("y")))
        #expect(!TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[A")))        // 上方向键（非自应答）
        #expect(!TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[24;80Rls"))) // 混入用户字节 → 非纯自应答
        #expect(!TerminalAutoResponse.isAutoResponse([]))                        // 空帧
        #expect(!TerminalAutoResponse.isAutoResponse(bytes("\u{1b}[24;R")))      // 缺列数 → 非 CPR
    }
}

// 轻量线程安全盒（测试收集用）。
private final class Locked<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T
    init(_ v: T) { value = v }
    func get() -> T { lock.lock(); defer { lock.unlock() }; return value }
    func mutate(_ f: (inout T) -> Void) { lock.lock(); f(&value); lock.unlock() }
}

// MARK: - WaitEventBus 多订阅

@Suite("WaitEventBus 多订阅冻结形状（批5①）")
struct WaitEventBusTests {

    @Test("WD_waiteventbus_shape: WaitEvent{termId,event,ts,raw} 冻结；两订阅者同流；ts/raw 不改")
    func multiSubscriberSameStream() {
        let bus = WaitEventBus()
        let q = DispatchQueue(label: "test.bus")
        let boxA = Locked<[WaitEvent]>([])
        let boxB = Locked<[WaitEvent]>([])
        bus.subscribe(deliverOn: q) { ev in boxA.mutate { $0.append(ev) } }
        bus.subscribe(deliverOn: q) { ev in boxB.mutate { $0.append(ev) } }
        #expect(bus.subscriberCount == 2)

        let event = WaitEvent(termId: "T1", event: .notification, ts: 42, raw: "{\"a\":1}")
        bus.publish(event)

        #expect(pollUntil { boxA.get().count == 1 && boxB.get().count == 1 })
        for box in [boxA, boxB] {
            let got = box.get().first!
            #expect(got.termId == "T1")
            #expect(got.event == .notification)
            #expect(got.ts == 42)          // 总线不改 ts
            #expect(got.raw == "{\"a\":1}") // 总线不改 raw
        }
        #expect(bus.totalPublished == 1)
    }

    @Test("unsubscribe 后不再收（幂等注销）")
    func unsubscribeStops() {
        let bus = WaitEventBus()
        let q = DispatchQueue(label: "test.bus2")
        let box = Locked<[WaitEvent]>([])
        let token = bus.subscribe(deliverOn: q) { ev in box.mutate { $0.append(ev) } }
        bus.unsubscribe(token)
        bus.unsubscribe(token) // 幂等
        bus.publish(WaitEvent(termId: "T", event: .stop, ts: 1))
        usleep(50_000)
        #expect(box.get().isEmpty)
        #expect(bus.subscriberCount == 0)
    }
}

// MARK: - WaitDetectorHub 路由（bus → core → onConclusion）

@Suite("WaitDetectorHub 硬事件路由 + 静默轮询（批5①）", .serialized)
struct WaitDetectorHubTests {
    /// 收集 onConclusion（SessionID, source）序列。
    private func makeHub(
        foregroundNonShell: Bool = false
    ) -> (WaitEventBus, WaitDetectorHub, Locked<[(String, WaitSource?)]>) {
        let bus = WaitEventBus()
        let sink = Locked<[(String, WaitSource?)]>([])
        let hub = WaitDetectorHub(
            bus: bus,
            onConclusion: { id, source in sink.mutate { $0.append((id.raw, source)) } },
            foregroundProbe: { _ in foregroundNonShell })
        return (bus, hub, sink)
    }

    @Test("硬事件经 bus → hub 路由 → onConclusion（edge-triggered，重复态不重发）")
    func routesBusEventsToConclusion() {
        let (bus, hub, sink) = makeHub()
        bus.publish(WaitEvent(termId: "A", event: .notification, ts: 100))
        #expect(pollUntil { sink.get().contains { $0.0 == "A" && $0.1 == .layer0 } })

        // 再来一条 .stop（仍 waiting/.layer0，结论未变）→ 不应新增 emit（edge-triggered 去重）。
        let countAfterFirst = sink.get().count
        bus.publish(WaitEvent(termId: "A", event: .stop, ts: 110))
        usleep(60_000)
        #expect(sink.get().count == countAfterFirst)

        // userInput → running（结论变化，emit nil）。
        bus.publish(WaitEvent(termId: "A", event: .userInput, ts: 120))
        #expect(pollUntil { sink.get().last?.1 == nil && sink.get().last?.0 == "A" })
        _ = hub
    }

    @Test("acknowledge/noteUserInput 便捷法经 bus 同源清红")
    func acknowledgeViaHub() {
        let (bus, hub, sink) = makeHub()
        bus.publish(WaitEvent(termId: "B", event: .notification, ts: 1))
        #expect(pollUntil { hub.conclusion(for: "B").isWaiting })
        hub.acknowledge(termId: "B", ts: 2)
        #expect(pollUntil { !hub.conclusion(for: "B").isWaiting })
        #expect(sink.get().last?.1 == nil)
    }

    @Test("WD_priority_layer0_over_silence（hub poll）：hook 终端 poll 静默 40s 不触发弱信号")
    func pollExemptsHookTerminal() {
        let (bus, hub, _) = makeHub(foregroundNonShell: true)
        bus.publish(WaitEvent(termId: "H", event: .notification, ts: 0))
        #expect(pollUntil { hub.conclusion(for: "H").source == .layer0 })
        bus.publish(WaitEvent(termId: "H", event: .userPromptSubmit, ts: 0))
        #expect(pollUntil { !hub.conclusion(for: "H").isWaiting })
        // poll 静默 40s：hasSeenLayer0 → 永久豁免，仍 running。
        let live = [WaitDetectorHub.LiveTerminal(termId: "H", shellPid: 0, lastOutputMs: 0)]
        hub.poll(live: live, nowMs: 40_000)
        #expect(hub.conclusion(for: "H").state == .running)
    }

    @Test("WD_silence_ack_no_rearm（hub poll 全链）：ack 后 poll 满 30s 不重亮；新输出后再静默重亮")
    func pollDoesNotRearmAfterAcknowledge() {
        let (_, hub, _) = makeHub(foregroundNonShell: true)
        let live0 = [WaitDetectorHub.LiveTerminal(termId: "R", shellPid: 1234, lastOutputMs: 0)]
        hub.poll(live: live0, nowMs: 0)
        hub.poll(live: live0, nowMs: 30_000)
        #expect(hub.conclusion(for: "R").source == .silence) // 首次触发
        hub.acknowledge(termId: "R", ts: 30_500)
        #expect(pollUntil { !hub.conclusion(for: "R").isWaiting })
        // ack 后 30s+：poll 仍喂陈旧 lastOutputMs=0 → 不重亮（旧代码红）。
        hub.poll(live: live0, nowMs: 61_000)
        #expect(hub.conclusion(for: "R").state == .running)
        // 新输出（lastOutputMs=62_000 > 水位）→ 开新 episode → 再静默满 30s 重亮。
        let live1 = [WaitDetectorHub.LiveTerminal(termId: "R", shellPid: 1234, lastOutputMs: 62_000)]
        hub.poll(live: live1, nowMs: 62_000)
        #expect(hub.conclusion(for: "R").state == .running)
        hub.poll(live: live1, nowMs: 92_000)
        #expect(hub.conclusion(for: "R").source == .silence)
    }

    @Test("WD_silence_30s（hub poll）：非 hook 终端静默满 30s → 弱 WaitingInput(.silence)；剪除消失终端")
    func pollFiresSilenceAndPrunes() {
        let (_, hub, _) = makeHub(foregroundNonShell: true)
        // lastOutputMs 恒 0（无新输出）；首 poll 建 core（基准 = lastOutputMs），第二 poll 距今 30s 触发。
        let live = [WaitDetectorHub.LiveTerminal(termId: "S", shellPid: 1234, lastOutputMs: 0)]
        hub.poll(live: live, nowMs: 0)
        #expect(hub.conclusion(for: "S").state == .running) // 刚见，未静默
        hub.poll(live: live, nowMs: 30_000)
        #expect(hub.conclusion(for: "S").source == .silence)
        // 终端消失（不在 live 表）→ core 被剪除，结论回缺省 running。
        hub.poll(live: [], nowMs: 31_000)
        #expect(hub.conclusion(for: "S").state == .running)
    }
}

// MARK: - UIStateProjection 等待计数/去抖（投影层）

@Suite("UIStateProjection WaitDetector 计数与去抖（批5①）", .serialized)
struct ProjectionWaitTests {

    @Test("WD_count_excludes_silence: 强信号(.layer0)计入 waitingCount；静默弱信号不计但仍显红")
    func countExcludesSilence() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)
        guard case let .created(id, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let sid = SessionID(raw: id)

        // 强信号 → count=1，state=waitingInput。
        projection.noteWaiting(sid, .layer0)
        var snap = projection.snapshot()
        #expect(snap.waitingCount == 1)
        #expect(snap.terminals.first { $0.id == id }?.state == .waitingInput)

        // 静默弱信号 → 仍显红（state=waitingInput）但 count 归 0（不出浮卡计数）。
        projection.noteWaiting(sid, .silence)
        snap = projection.snapshot()
        #expect(snap.waitingCount == 0)
        #expect(snap.terminals.first { $0.id == id }?.state == .waitingInput)

        // 清 → running，count=0。
        projection.noteWaiting(sid, nil)
        snap = projection.snapshot()
        #expect(snap.waitingCount == 0)
        #expect(snap.terminals.first { $0.id == id }?.state == .running)
    }

    @Test("WD_dock_badge_includes_silence: visibleWaitingCount 含静默弱信号（Dock 徽标口径），浮卡 waitingCount 维持强口径")
    func visibleCountIncludesSilence() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)
        guard case let .created(id, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let sid = SessionID(raw: id)

        // 静默弱信号 → 徽标口径计入 1，浮卡口径 0（两口径分流，wait-detector.md §7）。
        projection.noteWaiting(sid, .silence)
        var snap = projection.snapshot()
        #expect(snap.visibleWaitingCount == 1)
        #expect(snap.waitingCount == 0)

        // 强信号 → 两口径均 1。
        projection.noteWaiting(sid, .layer0)
        snap = projection.snapshot()
        #expect(snap.visibleWaitingCount == 1)
        #expect(snap.waitingCount == 1)

        // 清 → 双归零。
        projection.noteWaiting(sid, nil)
        snap = projection.snapshot()
        #expect(snap.visibleWaitingCount == 0)
        #expect(snap.waitingCount == 0)
    }

    @Test("WD_debounce_50ms: 50ms 内 waiting↔running 抖动只出最终一条（假时钟）")
    func debounces50ms() {
        let clock = FakeClock(1_000)
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), nowMs: clock.nowMs, configTemplate: isolatedTemplate)
        guard case let .created(id, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let sid = SessionID(raw: id)

        // 收集去抖后 emit 的快照（create 时的立即推不计入本窗口）。
        let emits = Locked<[ProjectionSnapshot]>([])
        projection.onSnapshot = { snap in emits.mutate { $0.append(snap) } }

        // t=1000: waiting；t=1010: running；t=1020: waiting —— 三次抖动，均非终态 → 去抖暂存不即推。
        projection.noteWaiting(sid, .layer0);  clock.set(1_010)
        projection.noteWaiting(sid, nil);      clock.set(1_020)
        projection.noteWaiting(sid, .layer0)
        #expect(emits.get().isEmpty) // 窗口内一条未推

        // 推进钟满 50ms 并 flush → 只出最终一条（waitingInput，count=1）。
        clock.set(1_070)
        projection.flush()
        #expect(emits.get().count == 1)
        #expect(emits.get().last?.waitingCount == 1)
    }

    @Test("noteWaiting 无变化不记（相同 source 幂等，不触发去抖）")
    func noteWaitingIdempotent() {
        let clock = FakeClock(0)
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), nowMs: clock.nowMs, configTemplate: isolatedTemplate)
        guard case let .created(id, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let sid = SessionID(raw: id)
        projection.noteWaiting(sid, .layer0)
        clock.set(100); projection.flush()
        let emits = Locked<[ProjectionSnapshot]>([])
        projection.onSnapshot = { snap in emits.mutate { $0.append(snap) } }
        projection.noteWaiting(sid, .layer0) // 同 source → 无变化
        clock.set(200); projection.flush()
        #expect(emits.get().isEmpty)
    }
}
