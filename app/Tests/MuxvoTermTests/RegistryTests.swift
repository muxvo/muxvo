// SessionRegistry 9 条 spec-ID 翻牌（批2①）：上限 20 / Stopping 超时 / 关闭 grace 升级 /
// scrollback 字节预算裁决。恰 1 active @Test per spec-ID，全部经 SessionRegistry 公共 API
// 断言。命名：仅这 9 个 @Test 用 spec-ID 形状；helper/Suite 名不得像 spec ID（防 E_FORGED_ID）。
//
// scrollback 五条（TERM_L2_84/85/86、PERF_L2_03/10）的裁决出处 = terminal-session.md §6.2：
// 「用户裁决全程 10000（2026-07-02）；vendor max_scrollback 系字节预算（C 头注释误导），
// 实现取 12MiB ≈ ≥10000 行@80列，断言按此口径」。85/86/10 本质是「legacy 缩减行为不复刻」
// 的裁决验证——legacy 有「非可见缩到 1000、不可逆、refocus 不恢复」，本实现根本无 visibility
// 分级/无缩减路径，故按 §6.2 断言「同一预算常量 + 无缩减 + 灌超即封顶」。
import Darwin
import Foundation
import Testing
import MuxvoTermCore
@testable import MuxvoTerm

// 轮询直到 cond() 成立或超时（真 PTY 字节需时间往返内核 → 读源 → vt）。
private func pollUntil(timeout: TimeInterval = 6, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout * muxvoCITimeoutScale())
    while Date() < deadline {
        if cond() { return true }
        usleep(20_000)
    }
    return cond()
}

/// 可注入的假毫秒时钟（TERM_L2_31 验 Stopping 驻留超时用；lock 保线程安全，registry queue 上读）。
private final class ControllableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    init(_ start: UInt64) { value = start }
    func read() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ ms: UInt64) { lock.lock(); value = ms; lock.unlock() }
    var nowMs: @Sendable () -> UInt64 { { self.read() } }
}

/// 隔离会话配置（spawnShell:false）：无真 PTY，供上限/态机/scrollback 数据面断言，避免起真 shell。
private func isolatedConfig() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.spawnShell = false
    return c
}

/// scrollback 断言用隔离配置（固定 80×24，字节→行换算口径按 §6.2 的 12MiB@80列）。
private func scrollbackConfig() -> TerminalSession.Config {
    var c = isolatedConfig()
    c.cols = 80; c.rows = 24
    return c
}

/// 往隔离会话直灌 `count` 行（每行 "X\r\n"），驱动 scrollback 累积。
private func feedLines(_ session: TerminalSession, _ count: Int) {
    var blob = String(); blob.reserveCapacity(count * 3)
    for _ in 0 ..< count { blob += "X\r\n" }
    session.feed(blob)
}

@Suite("SessionRegistry spec-ID 翻牌（9 条）", .serialized)
struct RegistryFlipTests {

    // MARK: 关闭 grace 升级（真 PTY）

    @Test("APP_L2_06: 关闭 grace 默认 5000ms；短 grace 下顽固进程超时被 SIGKILL、温顺进程 SIGHUP 即退不升级")
    func closeGraceDefaultAndEscalation() throws {
        // 常量口径：默认关闭 grace 5000ms（spec expectedValue，TerminalSession 权威）
        #expect(TerminalSession.defaultCloseGraceMs == 5000)

        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }

        // 顽固：trap 掉 HUP/INT/TERM → SIGHUP 无效 → 注入短 grace 超时升级 SIGKILL（forced==true）
        var stubborn = TerminalSession.Config()
        stubborn.executablePath = "/bin/sh"
        stubborn.argv = ["sh", "-c", "trap \"\" HUP INT TERM; echo TRAP_READY; sleep 1000"]
        guard case let .success(stubbornID) = registry.create(config: stubborn) else {
            Issue.record("顽固会话创建应成功"); return
        }
        let stubbornSession = registry.session(for: stubbornID)
        #expect(pollUntil { stubbornSession?.dumpPlainText().contains("TRAP_READY") == true }) // trap 已装
        registry.close(stubbornID, graceMs: 200) // 注入短 grace
        #expect(registry.awaitReaped(stubbornID) != nil) // 事件驱动等收尸（替代 pollUntil，M7 批6）
        if let (exit, forced) = registry.exitInfo(of: stubbornID) {
            #expect(exit == .signaled(signal: SIGKILL)) // 9：grace 超时强杀
            #expect(forced)                              // 升级发生
        }

        // 温顺：cat 不忽略 SIGHUP → SIGHUP 即退，宽 grace 下不触发升级（forced==false）
        var gentle = TerminalSession.Config()
        gentle.executablePath = "/bin/cat"
        gentle.argv = ["cat"]
        guard case let .success(gentleID) = registry.create(config: gentle) else {
            Issue.record("温顺会话创建应成功"); return
        }
        let gentleSession = registry.session(for: gentleID)
        gentleSession?.write("ready\n")
        #expect(pollUntil { gentleSession?.dumpPlainText().contains("ready") == true }) // cat 已就绪
        registry.close(gentleID, graceMs: 3000) // 宽 grace：SIGHUP 应远早于超时
        #expect(registry.awaitReaped(gentleID) != nil) // 事件驱动等收尸（替代 pollUntil，M7 批6）
        if let (exit, forced) = registry.exitInfo(of: gentleID) {
            #expect(exit == .signaled(signal: SIGHUP)) // 1：被关闭信号收尾
            #expect(!forced)                            // 未升级
        }
    }

    // MARK: Stopping 驻留超时（假时钟）

    @Test("TERM_L2_31_trans_stopping_disconnected: 假时钟 Stopping 驻留满 5000ms grace → TIMEOUT → Disconnected")
    func stoppingTimesOutToDisconnected() {
        let clock = ControllableClock(0)
        let registry = SessionRegistry(nowMs: clock.nowMs)
        defer { registry.shutdownForTeardown() }

        // 隔离会话：无 PTY → requestClose no-op、无退出 waiter，会话停在 Stopping 由假时钟驱动超时
        guard case let .success(id) = registry.create(config: isolatedConfig()) else {
            Issue.record("隔离会话创建应成功"); return
        }
        #expect(registry.state(of: id) == .running)
        registry.close(id) // 默认 grace = closeGraceMs = 5000；stoppingSinceMs = clock 现值 0
        #expect(registry.state(of: id) == .stopping)

        // grace 未满（4999ms）：不超时，仍 Stopping
        clock.set(4999)
        registry.pumpTimeouts(nowMs: clock.read())
        #expect(registry.state(of: id) == .stopping)

        // grace 恰满（5000ms）：TIMEOUT → Disconnected（spec expectedValue 5000ms）
        clock.set(5000)
        registry.pumpTimeouts(nowMs: clock.read())
        #expect(registry.state(of: id) == .disconnected)
    }

    // MARK: 全局池上限 40（multi-window.md §3；每窗 20 冻结文案 oracle 迁到 projection 层 TerminalServiceTests）

    @Test("MW_global_cap40_message: registry 全局池第 40 个成功、第 41 个拒绝带全局文案（裁决⑧）")
    func MW_global_cap40_message() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }

        // 用隔离会话避免 40 个真 shell（Registry create 支持 spawnShell:false）。
        for i in 1 ... SessionRegistry.maxTerminalCount {
            guard case .success = registry.create(config: isolatedConfig()) else {
                Issue.record("第 \(i) 个（≤40）应创建成功"); return
            }
        }
        #expect(registry.count == 40)

        // 第 41 个：registry 层拒绝 + **全局池文案**（multi-window.md §3 裁决⑧；每窗 20 冻结文案由
        // projection 层先拦，此处是全局兜顶——含 worker/接管会话的硬顶）。
        let result = registry.create(config: isolatedConfig())
        guard case let .failure(.maxReached(message)) = result else {
            Issue.record("第 41 个应以 maxReached 拒绝，实际 \(result)"); return
        }
        #expect(message == "已达全局最大终端数（40），请关闭不用的终端或窗口")
        #expect(registry.count == 40) // 拒绝不新增
    }

    @Test("全局池常量 == 40 + 满员快照 maxReached==true（registry 层口径）")
    func maxTerminalCountConstantAndMaxReachedSnapshot() {
        #expect(SessionRegistry.maxTerminalCount == 40)

        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }

        for _ in 1 ..< SessionRegistry.maxTerminalCount { // 建 39 个
            guard case .success = registry.create(config: isolatedConfig()) else {
                Issue.record("39 个内应成功"); return
            }
        }
        #expect(!registry.maxReached) // 39 个：未满
        guard case .success = registry.create(config: isolatedConfig()) else {
            Issue.record("第 40 个应成功"); return
        }
        #expect(registry.maxReached) // 满 40：全局快照 maxReached==true
    }

    // MARK: scrollback 字节预算（§6.2 裁决）

    @Test("TERM_L2_84_buffer_limit_focused: 灌 40000 行 → scrollback ≥10000 且 <40000（字节口径 12MiB，见 §6.2）")
    func focusedBufferKeeps10000WithCap() throws {
        // §6.2：用户裁决「全程 10000」；vendor max_scrollback 系字节预算（C 头误导），取 12MiB
        // ≈ ≥10000 行@80列。断言口径 = 灌 40000 行后 ≥10000 且确有封顶（<灌入量，证字节预算生效）。
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        guard case let .success(id) = registry.create(config: scrollbackConfig()),
              let session = registry.session(for: id)
        else { Issue.record("会话创建应成功"); return }

        let fed = 40_000
        feedLines(session, fed)
        let sb = session.scrollbackRowCount()
        #expect(sb >= TerminalSession.scrollbackTargetRows) // ≥10000（承接目标）
        #expect(sb < fed)                                   // 有封顶，非无限增长
    }

    @Test("TERM_L2_85_buffer_limit_hidden: 不可见会话与可见同一预算常量（无 visibility 分级、无缩减）")
    func hiddenBufferSameBudgetNoReduction() throws {
        // §6.2 裁决：不复刻 legacy「非可见缩到 1000」。预算是全局唯一常量，会话核心无
        // visibility/focus 分级 API——Config 只有单一 maxScrollback 旋钮，默认即全局常量，
        // 不存在 hidden 专属的更小预算。
        #expect(TerminalSession.Config().maxScrollback == TerminalSession.maxScrollbackBytes)

        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        // 该会话从不「聚焦」（Registry/Session 无可见性概念）——按 legacy 应缩到 1000 行；
        // 裁决后不缩：灌 40000 仍保留 ≥10000（>> legacy 的 1000），明确否定 hidden 缩减。
        guard case let .success(id) = registry.create(config: scrollbackConfig()),
              let session = registry.session(for: id)
        else { Issue.record("会话创建应成功"); return }

        feedLines(session, 40_000)
        let sb = session.scrollbackRowCount()
        #expect(sb >= TerminalSession.scrollbackTargetRows) // 未缩到 1000
        #expect(sb > 1000)                                  // 明确否定 legacy 的 hidden=1000
    }

    @Test("TERM_L2_86_buffer_no_restore: 无「缩减后恢复」路径（同一会话续灌 scrollback 持续 ≥10000）")
    func noBufferReductionThusNoRestore() throws {
        // §6.2 裁决：legacy 有「hidden 缩到 1000 → refocus 不恢复」的不可逆缩减；本实现根本
        // 无缩减路径，故「恢复」无从谈起。正向验证：同一会话反复续灌（模拟切走再切回后继续
        // 产出），scrollback 始终维持 ≥10000（预算恒定，无回收/无缩减/无恢复）。
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        guard case let .success(id) = registry.create(config: scrollbackConfig()),
              let session = registry.session(for: id)
        else { Issue.record("会话创建应成功"); return }

        feedLines(session, 40_000)
        let first = session.scrollbackRowCount()
        #expect(first >= TerminalSession.scrollbackTargetRows) // 首轮即保留 ≥10000
        #expect(first < 40_000)                                // 已封顶

        feedLines(session, 40_000) // 续灌（模拟切走再切回后继续产出）
        let second = session.scrollbackRowCount()
        // 无缩减/无回收：续灌后仍稳定在字节预算的封顶带（≥10000、<灌入量），绝不塌回
        // legacy 的 hidden=1000。（行数在预算封顶处随 trim 边界有个位百分点浮动，非缩减。）
        #expect(second >= TerminalSession.scrollbackTargetRows)
        #expect(second < 40_000)
        #expect(second > 1000) // 明确否定「缩减到 1000」——无该路径故无「恢复」可言
    }

    @Test("PERF_L2_03: scrollback 常量口径——maxScrollbackBytes==12MiB（12MiB@80列 ≥10000 行换算）")
    func scrollbackConstantCaliber() throws {
        // §6.2：libghostty max_scrollback 系字节预算（非行数，C 头误导）。合同常量 = 12 MiB，
        // 换算 12MiB@80列≈12041 行 ≥10000（用户裁决意图）。spec 记为
        // ScrollbackPolicy.maxScrollbackBytes；本实现同一口径落 TerminalSession（常量家所在）。
        #expect(TerminalSession.maxScrollbackBytes == 12 * 1024 * 1024)
        #expect(TerminalSession.scrollbackTargetRows == 10_000)

        // 换算注记的行为侧佐证：12MiB 预算 / 80 列 应可容 ≥10000 行
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        guard case let .success(id) = registry.create(config: scrollbackConfig()),
              let session = registry.session(for: id)
        else { Issue.record("会话创建应成功"); return }
        feedLines(session, 40_000)
        #expect(session.scrollbackRowCount() >= TerminalSession.scrollbackTargetRows)
    }

    @Test("PERF_L2_10: bufferDiscardReversible 概念不存在——丢弃不可逆（无恢复 API、封顶后旧行不回来）")
    func bufferDiscardIsIrreversible() throws {
        // §6.2 裁决：设计上丢弃不可逆（PERF_L2_10 expectedValue=false）。ghostty ring buffer
        // 封顶即丢最旧行，无「恢复已丢弃行」的 API/路径。正向验证：灌超预算 → 稳定封顶（旧行
        // 已丢），再灌既不恢复被丢的旧行、也不无限增长——封顶值稳定即证不可逆丢弃。
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        guard case let .success(id) = registry.create(config: scrollbackConfig()),
              let session = registry.session(for: id)
        else { Issue.record("会话创建应成功"); return }

        feedLines(session, 40_000)
        let capped = session.scrollbackRowCount()
        #expect(capped >= TerminalSession.scrollbackTargetRows)
        #expect(capped < 40_000) // 已丢弃最旧行（封顶）

        feedLines(session, 40_000)
        let afterMore = session.scrollbackRowCount()
        #expect(afterMore < 40_000)                              // 不无限增长
        #expect(afterMore >= TerminalSession.scrollbackTargetRows) // 续灌不「恢复」已丢弃行、仍封顶同一量级
    }
}
