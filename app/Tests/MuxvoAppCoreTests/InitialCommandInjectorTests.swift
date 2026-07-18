// InitialCommandInjector + 共用静默门原语 单测（terminal-session-restore.md §3 注入路径）红→绿。
//
// 覆盖 TSR_ 案例：
//   · TSR_restore_injects_resume       构建 `cd -- '<esc cwd>' && claude --resume <id>` + CR，过门写一次
//   · TSR_inject_cr_semantics          注入串尾恰一个 CR
//   · TSR_user_input_aborts_injection  注入前/中检出真人键 → abort、零写、返回 false
// + 共用门（SilenceGateInjector）= 唯一底层原语（MIN-6，与 TakeoverTextInjector 兄弟薄封装）。
import Foundation
import Testing

@testable import MuxvoAppCore

@Suite("InitialCommandInjector（恢复注入，案 A）")
struct InitialCommandInjectorTests {
    private let sid = "11111111-2222-3333-4444-555555555555"

    @Test("TSR_restore_injects_resume + TSR_inject_cr_semantics：过门注入含 cd 前缀的 resume 串 + 尾 CR")
    func injectsResumeWithCR() async {
        // 时间线：t=0 基线；t=100 首输出；此后静默 → 注入落 t≥600（首输出 +500ms 静默）。
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let injected = await InitialCommandInjector.run(
            cwd: "/proj dir", sessionId: sid,
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(injected)
        #expect(writes.items == ["cd -- '/proj dir' && claude --resume \(sid)\r"],
                "注入串含 cd 前缀 + 单引号转义 + cd -- 断选项 + 尾 CR，恰一次（--resume 后不带 --，M5-R1）")
        #expect(writes.items.first?.filter { $0 == "\r" || $0 == "\n" }.count == 1, "恰一个 CR")
    }

    @Test("harness=.codex：过门注入 `codex resume <sid>` 串 + 尾 CR（M5-R1 Codex 续聊注入形）")
    func injectsCodexResumeWithCR() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let injected = await InitialCommandInjector.run(
            cwd: "/proj dir", sessionId: sid, harness: .codex,
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(injected)
        #expect(writes.items == ["cd -- '/proj dir' && codex resume \(sid)\r"],
                "Codex 注入串 = cd 前缀 + 转义 + `codex resume <sid>`（位置参数无 --）+ 尾 CR，恰一次")
        #expect(writes.items.first?.filter { $0 == "\r" || $0 == "\n" }.count == 1, "恰一个 CR")
    }

    @Test("非法 sessionId → 零注入（协调层已 gate，此为纵深防线）")
    func rejectsBadSessionId() async {
        let writes = InjWrites()
        let injected = await InitialCommandInjector.run(
            cwd: "/p", sessionId: "-rf; rm",
            baselineMs: 0, lastOutput: { 100 }, write: { writes.append($0) },
            nowMs: { 5_000 }, sleepMs: { _ in })
        #expect(!injected && writes.items.isEmpty)
    }

    @Test("M-1：控制字节 cwd → 注入器纵深防线拒注入（零写、false）")
    func rejectsControlByteCwd() async {
        let writes = InjWrites()
        let injected = await InitialCommandInjector.run(
            cwd: "/proj\rmalicious", sessionId: sid,
            baselineMs: 0, lastOutput: { 100 }, write: { writes.append($0) },
            nowMs: { 5_000 }, sleepMs: { _ in })
        #expect(!injected && writes.items.isEmpty, "控制字节 cwd → 退化，绝不注入变形串进 PTY")
    }

    @Test("TSR_user_input_aborts_injection：注入前检出真人键 → abort、零写、false（不报错）")
    func abortsOnHumanInput() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        // humanInputArrived 恒 true（人已在打字）→ 门未及注入即 abort。
        let injected = await InitialCommandInjector.run(
            cwd: "/p", sessionId: sid,
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 }, // 已见首输出、已静默——正常本会注入
            write: { writes.append($0) },
            humanInputArrived: { true },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(!injected && writes.items.isEmpty, "人键介入 → abort 退化普通 shell，绝不硬注入")
    }

    @Test("TSR_inject_waits_first_resize：静默门已可注入但 sizeReady 未翻 → 等翻 true 后写入、恰一次（登记⑩）")
    func waitsForFirstResize() async {
        // 时间线：t=100 首输出、t≥600 静默门本可注入；sizeReady 在 t=1200 才翻 true → 写入必须发生在 ≥1200。
        // 若尺寸就绪门失效提前注入，run 会在 t≈600 返回、假时钟停在 <1200 → 断言抓获。
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let injected = await InitialCommandInjector.run(
            cwd: "/p", sessionId: sid,
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            sizeReady: { clock.now() >= 1_200 },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(injected)
        #expect(writes.items.count == 1, "尺寸就绪后恰一次写入")
        #expect(clock.now() >= 1_200, "写入不得早于 sizeReady 翻 true（登记⑩前置等待）")
    }

    @Test("TSR_inject_size_timeout_fallback：sizeReady 恒 false → 5s 超时后仍照常注入（兜底不弃，登记⑩）")
    func sizeTimeoutFallsBackToInject() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let injected = await InitialCommandInjector.run(
            cwd: "/p", sessionId: sid,
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            sizeReady: { false },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(injected, "超时兜底 = 照常注入（终端洞不可见场景，不劣于修复前）")
        #expect(writes.items.count == 1)
        #expect(clock.now() >= InitialCommandInjector.sizeReadyTimeoutMs, "注入发生在尺寸就绪超时之后")
    }

    @Test("TSR_human_abort_during_size_wait：尺寸就绪等待期真人键 → abort、零写、false（登记⑩）")
    func abortsOnHumanInputDuringSizeWait() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let human = InjFlag()
        let injected = await InitialCommandInjector.run(
            cwd: "/p", sessionId: sid,
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            humanInputArrived: { human.value },
            sizeReady: { false }, // 恒未就绪 → 一直停在前置等待期
            nowMs: { clock.now() },
            sleepMs: { ms in
                if clock.now() >= 300 { human.set() } // 等待途中人开始打字
                clock.advance(ms)
            })
        #expect(!injected && writes.items.isEmpty, "前置等待期人键 → abort 退化普通 shell")
        #expect(clock.now() < InitialCommandInjector.sizeReadyTimeoutMs, "abort 发生在等待期内（非超时路径）")
    }

    @Test("SilenceGateInjector：等待途中人键置位 → abort（共用底层原语，MIN-6）")
    func sharedPrimitiveAbortMidWait() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let human = InjFlag()
        let injected = await SilenceGateInjector.run(
            payload: "X\r",
            baselineMs: 0,
            lastOutput: { 100 }, // 已见首输出
            write: { writes.append($0) },
            abortIf: { human.value },
            nowMs: { clock.now() },
            sleepMs: { ms in
                // 第一次 wait 后（静默未满 500ms）人开始打字。
                if clock.now() < 300 { human.set() }
                clock.advance(ms)
            })
        #expect(!injected && writes.items.isEmpty, "等待途中人键置位 → abort")
    }
}

// MARK: - CwdPinInjector（dogfood-r2#4 根因 B）

@Suite("CwdPinInjector（create{cwd} 显式目录钉住注入）")
struct CwdPinInjectorTests {
    @Test("过门注入 `cd -- '<esc>' && clear` + 尾恰一 CR（含空格路径单引号转义）")
    func injectsCdClearWithCR() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let injected = await CwdPinInjector.run(
            cwd: "/repo dir/.worktrees/wt-1",
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(injected)
        #expect(writes.items == ["cd -- '/repo dir/.worktrees/wt-1' && clear\r"],
                "payload = cd -- 断选项 + 单引号转义 + && clear + 尾 CR，恰一次")
        #expect(writes.items.first?.filter { $0 == "\r" || $0 == "\n" }.count == 1, "恰一个 CR")
    }

    @Test("路径内含单引号 → SEC-B1 同式转义（'\\''），元字符零注入面")
    func escapesSingleQuoteInPath() {
        #expect(CwdPinInjector.buildInjectionIfSafe(cwd: "/a'b; rm -rf /")
                == "cd -- '/a'\\''b; rm -rf /' && clear\r",
                "单引号闭合-转义-重开，; 等元字符全被单引号杀死")
    }

    @Test("M-1 同闸：控制字节 cwd → 拒注入（零写、false）")
    func rejectsControlByteCwd() async {
        let writes = InjWrites()
        let injected = await CwdPinInjector.run(
            cwd: "/proj\rmalicious",
            baselineMs: 0, lastOutput: { 100 }, write: { writes.append($0) },
            nowMs: { 5_000 }, sleepMs: { _ in })
        #expect(!injected && writes.items.isEmpty, "控制字节 cwd → 退化，绝不注入变形串进 PTY")
    }

    @Test("真人键先到 → abort、零写、false（不抢用户键盘，终端留在漂移目录）")
    func abortsOnHumanInput() async {
        let clock = InjClock(now: 0)
        let writes = InjWrites()
        let injected = await CwdPinInjector.run(
            cwd: "/p",
            baselineMs: 0,
            lastOutput: { clock.now() < 100 ? 0 : 100 },
            write: { writes.append($0) },
            humanInputArrived: { true },
            nowMs: { clock.now() },
            sleepMs: { ms in clock.advance(ms) })
        #expect(!injected && writes.items.isEmpty, "人键介入 → abort 退化，绝不硬注入")
    }
}

// MARK: - 本套件本地假件

final class InjClock: @unchecked Sendable {
    private let lock = NSLock()
    private var t: UInt64
    init(now: UInt64) { t = now }
    func now() -> UInt64 { lock.withLock { t } }
    func advance(_ d: UInt64) { lock.withLock { t += d } }
}

final class InjWrites: @unchecked Sendable {
    private let lock = NSLock()
    private var _items: [String] = []
    func append(_ s: String) { lock.withLock { _items.append(s) } }
    var items: [String] { lock.withLock { _items } }
}

final class InjFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var v = false
    func set() { lock.withLock { v = true } }
    var value: Bool { lock.withLock { v } }
}
