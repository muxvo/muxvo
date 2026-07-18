// MuxvoTerm 测试（批 1②）：真 PTY 集成 + 隔离模式会话 + env 合同 + 关闭协议。
// 纪律：只碰 $TMPDIR / 起 /bin/{cat,sh} 保确定性；测试收尾必收尸（无僵尸残留）。
// 命名：仅 3 个 spec-ID 测试用 `TERM_L1_0X:` 形状；其余测试名不得像 spec ID（防 E_FORGED_ID）。
import Darwin
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoTermCore
@testable import MuxvoTerm

// 轮询直到 cond() 成立或超时（真 PTY 字节需时间往返内核 → 读源 → vt）。
private func waitUntil(timeout: TimeInterval = 5, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout * muxvoCITimeoutScale())
    while Date() < deadline {
        if cond() { return true }
        usleep(20_000)
    }
    return cond()
}

// MARK: - 真 PTY 集成（3 个 spec-ID 测试）

@Suite("MuxvoTerm 真 PTY 集成")
struct MuxvoTermPTYTests {

    @Test("TERM_L1_02: PTY 写入后行规程回显可读")
    func writeEchoesBack() throws {
        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/cat" // cat 在 pty cooked 模式下回显输入
        cfg.argv = ["cat"]
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        session.write("muxvo-echo-42\n")
        #expect(waitUntil { session.dumpPlainText().contains("muxvo-echo-42") })
    }

    @Test("TERM_L1_03: resize 生效（stty 回读）+ 防御拒绝越界尺寸")
    func resizeTakesEffectAndDefends() throws {
        var cfg = TerminalSession.Config()
        cfg.cols = 100; cfg.rows = 30 // 初始异于目标，才能证明 resize 真生效
        cfg.executablePath = "/bin/sh"
        cfg.argv = ["sh", "-c", "sleep 0.3; stty size"]
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        #expect(session.resize(cols: 80, rows: 24))    // 合法：下发
        #expect(!session.resize(cols: 5, rows: 24))     // cols<10：拒绝
        #expect(!session.resize(cols: 80, rows: 1))     // rows<2：拒绝
        #expect(session.cols == 80 && session.rows == 24) // 被拒的不改状态

        // stty size 输出 "rows cols" = "24 80"
        #expect(waitUntil { session.dumpPlainText().contains("24 80") })
    }

    @Test("TERM_L1_05: 终端字节走原生可读，且桥协议无终端输出类 push 消息（负向）")
    func outputStaysNativeNeverBridged() throws {
        // 正向：feed 字节后原生侧（formatter dump）可读、不乱码
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false // 隔离模式：纯 vt 直灌
        let session = try TerminalSession(config: cfg)
        defer { session.close() }
        session.feed("hello 世界\r\n")
        #expect(session.dumpPlainText().contains("hello 世界"))

        // 负向：桥消息枚举里不存在任何「终端输出」类 push（终端字节流永不过桥）
        let forbidden = ["output", "terminal.data", "term.data", "terminal.bytes"]
        for type in BridgeMessageType.allCases {
            let raw = type.rawValue.lowercased()
            for f in forbidden {
                #expect(!raw.contains(f), "桥消息 \(type.rawValue) 不应承载终端输出")
            }
        }
    }
}

// MARK: - 优雅关闭协议（退出码/信号区分；无 spec-ID 命名）

@Suite("MuxvoTerm 关闭协议")
struct MuxvoTermCloseTests {

    @Test("顽固子进程忽略 SIGHUP → grace 超时被 SIGKILL 强杀收尸")
    func stubbornChildForceKilled() throws {
        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/sh"
        // trap "" 使 HUP/INT/TERM 置 SIG_IGN，并经 exec 被 sleep 继承 → 整组顽固。
        // echo READY 在装好 trap 后发出：测试等它出现再关闭——复刻「关闭发生在 shell 就绪后」，
        // 避免 SIGHUP 抢在 trap 装好前命中（子进程 exec 前信号已被重置为 SIG_DFL）。
        cfg.argv = ["sh", "-c", "trap \"\" HUP INT TERM; echo TRAP_READY; sleep 1000"]
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        #expect(waitUntil { session.dumpPlainText().contains("TRAP_READY") }) // trap 已装
        session.requestClose(graceMs: 200) // 注入短 grace
        let result = session.waitForExit(timeout: 5 * muxvoCITimeoutScale())
        #expect(result != nil)
        if let (exit, forced) = result {
            #expect(exit == .signaled(signal: SIGKILL)) // 9：强杀
            #expect(forced) // 走了 grace 超时升级
        }
    }

    @Test("温顺子进程收 SIGHUP 即退，不触发强杀升级")
    func gentleChildExitsOnSighup() throws {
        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/cat" // cat 不忽略 SIGHUP，默认动作即终结
        cfg.argv = ["cat"]
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        // 先确认 cat 已在运行（回显 marker），再关闭——复刻关闭发生在进程就绪后。
        session.write("ready\n")
        #expect(waitUntil { session.dumpPlainText().contains("ready") })
        session.requestClose(graceMs: 3000) // 宽 grace：SIGHUP 应远早于超时生效
        let result = session.waitForExit(timeout: 5 * muxvoCITimeoutScale())
        #expect(result != nil)
        if let (exit, forced) = result {
            #expect(exit == .signaled(signal: SIGHUP)) // 1：被关闭信号收尾
            #expect(!forced) // 未升级 SIGKILL
        }
    }

    @Test("自发退出携带退出码（WIFEXITED 区分）")
    func spontaneousExitCarriesCode() throws {
        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/sh"
        // 小睡确保退出观察进程源在子进程退出前已注册（消除竞态）
        cfg.argv = ["sh", "-c", "sleep 0.1; exit 7"]
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        let result = session.waitForExit(timeout: 5 * muxvoCITimeoutScale())
        #expect(result != nil)
        if let (exit, forced) = result {
            #expect(exit == .exited(code: 7))
            #expect(!forced)
        }
    }
}

// MARK: - env 合同 + OSC7 + scrollback（数据面；无 spec-ID 命名）

@Suite("MuxvoTerm 数据面能力")
struct MuxvoTermDataPlaneTests {

    @Test("hasReceivedResize：spawn 默认不算、<10×2 被拒不算、首个外部 resize（含同尺寸幂等）置位（登记⑩）")
    func hasReceivedResizeSemantics() throws {
        // 会话 1：同尺寸幂等路径——tile 恰为 spawn 默认 80×24 时首次 sync 也必须算就绪。
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false // 隔离模式：纯 vt，resize 的 pty 半恒 no-op true
        let s = try TerminalSession(config: cfg)
        defer { s.close() }
        #expect(!s.hasReceivedResize, "spawn 默认 80×24 不算「外部尺寸已达」")
        #expect(!s.resize(cols: 5, rows: 1))
        #expect(!s.hasReceivedResize, "<10×2 被拒的退化 rect 不算就绪")
        #expect(s.resize(cols: 80, rows: 24)) // 同尺寸短路（幂等 accepted）
        #expect(s.hasReceivedResize, "同尺寸幂等命中也算首个外部尺寸已达（登记⑩）")

        // 会话 2：常规变尺寸路径。
        var cfg2 = TerminalSession.Config()
        cfg2.spawnShell = false
        let s2 = try TerminalSession(config: cfg2)
        defer { s2.close() }
        #expect(s2.resize(cols: 100, rows: 30))
        #expect(s2.hasReceivedResize)
    }

    @Test("env 合同装配逐条（纯函数，消费 MuxvoTermCore.EnvContract）")
    func envContractPure() {
        let source = [
            "CLAUDECODE": "1",     // 应删
            "LANG": "C",           // 应兜底
            "PATH": "/usr/bin:/bin",
            "SHELL": "/bin/zsh",
        ]
        let env = EnvContract.build(base: source, terminalID: "term-abc", isDarwin: true)
        #expect(env["CLAUDECODE"] == nil)                 // 删除
        #expect(env["TERM_PROGRAM"] == "Apple_Terminal")  // 未设 → 注入
        #expect(env["LANG"] == "en_US.UTF-8")             // C → 兜底
        #expect(env["COLORTERM"] == "truecolor")          // 新增
        #expect(env["TERM"] == "xterm-256color")          // 已裁决⑨
        #expect(env["MUXVO_TERM_ID"] == "term-abc")       // 注入 UUID
        #expect(env["PATH"] == "/usr/bin:/bin")           // 其余继承
    }

    @Test("env 合同真落子进程（sh 回显）")
    func envContractReachesChild() throws {
        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/sh"
        cfg.argv = ["sh", "-c",
            "echo MUXENV TERM=$TERM CT=$COLORTERM TP=$TERM_PROGRAM CC=[$CLAUDECODE] ID=$MUXVO_TERM_ID"]
        cfg.envSource = ["CLAUDECODE": "1", "PATH": "/usr/bin:/bin"] // 注入 CLAUDECODE 验删除
        let session = try TerminalSession(id: SessionID(raw: "envchild-9"), config: cfg)
        defer { session.close() }

        #expect(waitUntil { session.dumpPlainText().contains("MUXENV") })
        let dump = session.dumpPlainText()
        #expect(dump.contains("TERM=xterm-256color"))
        #expect(dump.contains("CT=truecolor"))
        #expect(dump.contains("TP=Apple_Terminal"))
        #expect(dump.contains("CC=[]"))          // CLAUDECODE 已删
        #expect(dump.contains("ID=envchild-9"))  // MUXVO_TERM_ID = 会话 id
    }

    @Test("OSC7 序列经 pwd 回调更新会话 cwd")
    func osc7UpdatesCwd() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false // 隔离模式：直灌 OSC7
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        // OSC 7 ; file://host/path BEL
        session.feed("\u{1b}]7;file://localhost/private/tmp/muxvo-osc7\u{07}")
        // 回调在 vt_write 内同步跑（会话 queue），feed 返回后 cwd 已更新
        #expect(session.cwd.hasPrefix("file://"))
        #expect(session.cwd.contains("/private/tmp/muxvo-osc7"))
    }

    @Test("scrollback 字节预算：默认 80 列保留 ≥10000 历史行且封顶（不无限增长）")
    func scrollbackCaps() throws {
        // libghostty max_scrollback 是字节预算（非行数，ghostty 源码实证；见 TerminalSession
        // maxScrollbackBytes 注释）。用户裁决「全程 10000 行」→ 取 12 MiB 预算，80 列下约 12041 行。
        // 断言意图：默认宽度下保留 ≥10000 历史行（承接目标）+ 灌 40000 行确有封顶（<40000，
        // 证明字节预算生效、非无限增长）。精确常量口径的翻牌属批 2。
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 80; cfg.rows = 24
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        let fed = 40_000
        var blob = String(); blob.reserveCapacity(fed * 3)
        for _ in 0..<fed { blob += "X\r\n" }
        session.feed(blob)

        let sb = session.scrollbackRowCount()
        #expect(sb >= TerminalSession.scrollbackTargetRows) // 保留 ≥10000 历史行（用户裁决意图）
        #expect(sb < fed)                                    // 确有封顶：远少于灌入量，非无限增长
    }
}
