// 终端会话恢复持久化面（terminal-session-restore.md §2/§3 SEC-M1/M2/M3 + MAJ-2）红→绿。
//
// 覆盖 TSR_ 案例：
//   · TSR_persist_debounced        高频锚点更新去抖 ~1s 落盘一次（假时钟）
//   · TSR_persist_roundtrip        落盘后重读形状一致
//   · TSR_anchor_file_0600_and_recheck  文件 0600 + 三字段复检
//   · TSR_cwd_shell_escaped        cwd 单引号转义 + cd -- 断选项
//   · TSR_sessionid_whitelist_rejects   sessionId 严格 UUID 正则（前导 -/纯 - 旧式被拒）
//   · TSR_transcript_realpath_containment  realpath 规范化 + ~/.claude 容器校验
//   · TSR_crash_loop_isolates      注入后 T 秒内累计 K 次崩溃 → 隔离；存活过窗 → 清零
//   · TSR_inject_cr_semantics（命令体形）注入串体（无 CR）形状——CR 语义在注入器层断言
// P-2 fast-follow（TSR_CX_，Codex 自动恢复）：
//   · TSR_CX_anchor_codex_roundtrip     .codex 锚点落盘/重读（transcriptPath=rollout 路径）
//   · TSR_CX_lenient_decode_drops_bad_entry  宽容逐条解码：未知 harness 只丢该条（替代旧 TSR_harness_cc_only 否定用例）
//   · TSR_CX_clear_if_matches_guards_cross_harness  条件清除防跨 harness 竞态误删
//   · TSR_CX_cross_harness_latest_wins  同 termId CC↔Codex 最近活跃覆盖（保计数）
import Darwin
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

// MARK: - 持久化（TerminalActiveSessionsStore）

@Suite("TerminalActiveSessionsStore（锚点持久化）")
struct TerminalActiveSessionsStoreTests {
    private func makeAnchor(
        sessionId: String = "11111111-2222-3333-4444-555555555555",
        cwd: String = "/proj", transcript: String = "/t.jsonl", ts: UInt64 = 100
    ) -> (String, String, String, UInt64) {
        (sessionId, cwd, transcript, ts)
    }

    @Test("TSR_persist_debounced：高频更新去抖 ~1s 落盘一次（假时钟）")
    func debouncedWrite() throws {
        try withTempRoot { root in
            let clock = TestClock(now: 0)
            let store = TerminalActiveSessionsStore(
                root: root, debounceMs: 1000, nowMs: { clock.now() })
            // t=0..400 五次更新 → dirty，未到 1s 不落盘。
            for i in 0..<5 {
                clock.set(UInt64(i) * 100)
                store.updateAnchor(
                    termId: "T1", sessionId: "11111111-2222-3333-4444-555555555555",
                    cwd: "/proj", transcriptPath: "/t.jsonl", lastActiveTs: UInt64(i) * 100)
            }
            clock.set(999)
            store.flushIfDue(nowMs: 999)
            #expect(store.diskWrites == 0, "去抖窗内（<1s）不落盘")
            clock.set(1000)
            store.flushIfDue(nowMs: 1000)
            #expect(store.diskWrites == 1, "满 1s 合并为一次落盘")
            #expect(store.readAll()["T1"]?.lastActiveTs == 400, "落盘反映最后一次更新")
        }
    }

    @Test("TSR_persist_roundtrip：落盘后新实例重读形状一致")
    func roundtrip() throws {
        try withTempRoot { root in
            let s1 = TerminalActiveSessionsStore(root: root)
            s1.updateAnchor(
                termId: "T9", sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                cwd: "/w", transcriptPath: "/w/x.jsonl", lastActiveTs: 42)
            s1.flush()
            let s2 = TerminalActiveSessionsStore(root: root)
            let a = s2.readAll()["T9"]
            #expect(a?.sessionId == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
            #expect(a?.harness == .cc)
            #expect(a?.cwd == "/w")
            #expect(a?.transcriptPath == "/w/x.jsonl")
            #expect(a?.lastActiveTs == 42)
            #expect(a?.resumeAttempts == 0)
            #expect(a?.lastResumeTs == nil)
        }
    }

    @Test("TSR_anchor_file_0600：落盘文件权限 0600（SEC-M2）")
    func filePermissions0600() throws {
        try withTempRoot { root in
            let store = TerminalActiveSessionsStore(root: root)
            store.updateAnchor(
                termId: "T1", sessionId: "11111111-2222-3333-4444-555555555555",
                cwd: "/p", transcriptPath: "/p/t.jsonl", lastActiveTs: 1)
            store.flush()
            let url = DataDirectory.terminalActiveSessionsURL(under: root)
            let perms = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber
            #expect(perms?.int16Value == 0o600, "锚点文件仅属主可读写（SEC-M2）")
        }
    }

    @Test("更新保留 crash-loop 计数（seed 后活更新不重置 resumeAttempts）")
    func updatePreservesCounters() throws {
        try withTempRoot { root in
            let store = TerminalActiveSessionsStore(root: root)
            store.seedRestored(termId: "T2", anchor: TerminalSessionAnchor(
                sessionId: "11111111-2222-3333-4444-555555555555", harness: .cc,
                cwd: "/p", transcriptPath: "/p/t.jsonl", lastActiveTs: 5,
                resumeAttempts: 2, lastResumeTs: 999))
            // 后续活跃 hook 更新只覆盖锚点字段，不碰计数。
            store.updateAnchor(
                termId: "T2", sessionId: "11111111-2222-3333-4444-555555555555",
                cwd: "/p", transcriptPath: "/p/t2.jsonl", lastActiveTs: 20)
            let a = store.readAll()["T2"]
            #expect(a?.resumeAttempts == 2 && a?.lastResumeTs == 999, "计数被保留")
            #expect(a?.transcriptPath == "/p/t2.jsonl" && a?.lastActiveTs == 20, "锚点字段被更新")
        }
    }

    @Test("TSR_CX_anchor_codex_roundtrip：.codex 锚点落盘/重读形状一致（P-2 fast-follow，transcriptPath=rollout 路径）")
    func codexAnchorRoundtrip() throws {
        try withTempRoot { root in
            let s1 = TerminalActiveSessionsStore(root: root)
            s1.updateAnchor(
                termId: "TX", sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                cwd: "/w", transcriptPath: "/h/.codex/sessions/2026/07/14/rollout-x.jsonl",
                lastActiveTs: 42, harness: .codex)
            s1.flush()
            let a = TerminalActiveSessionsStore(root: root).readAll()["TX"]
            #expect(a?.harness == .codex)
            #expect(a?.sessionId == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
            #expect(a?.transcriptPath == "/h/.codex/sessions/2026/07/14/rollout-x.jsonl")
        }
    }

    @Test("TSR_CX_lenient_decode_drops_bad_entry：未知 harness/坏条目只丢该条，同文件 cc/codex 条目存活（§2 前向加固）")
    func lenientDecodeDropsBadEntry() throws {
        try withTempRoot { root in
            let runDir = DataDirectory.runDirectoryURL(under: root)
            try FileManager.default.createDirectory(at: runDir, withIntermediateDirectories: true)
            let url = DataDirectory.terminalActiveSessionsURL(under: root)
            // 三条：cc 合法 + codex 合法 + 未知 harness（未来第三 harness/损坏）——旧版整体严格解码会全丢；
            // 宽容逐条解码只丢 gemini 那条。
            let json = """
            {"TCC":{"sessionId":"11111111-2222-3333-4444-555555555555","harness":"cc",\
            "cwd":"/p","transcriptPath":"/p/t.jsonl","lastActiveTs":1},\
            "TCX":{"sessionId":"22222222-3333-4444-5555-666666666666","harness":"codex",\
            "cwd":"/q","transcriptPath":"/q/r.jsonl","lastActiveTs":2},\
            "TBAD":{"sessionId":"33333333-4444-5555-6666-777777777777","harness":"gemini",\
            "cwd":"/r","transcriptPath":"/r/x.jsonl","lastActiveTs":3}}
            """
            try Data(json.utf8).write(to: url)
            let store = TerminalActiveSessionsStore(root: root)
            let all = store.readAll()
            #expect(all["TCC"]?.harness == .cc, "cc 条目存活")
            #expect(all["TCX"]?.harness == .codex, "codex 条目载入（P-2 fast-follow 后合法）")
            #expect(all["TBAD"] == nil, "未知 harness 只丢该条（不整文件报废）")
            #expect(all.count == 2)
        }
    }

    @Test("TSR_CX_clear_if_matches_guards_cross_harness：条件清除守卫——harness/sessionId 不匹配不误删（跨 harness 竞态）")
    func clearIfMatchesGuards() throws {
        try withTempRoot { root in
            let store = TerminalActiveSessionsStore(root: root)
            let codexSid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
            let ccSid = "11111111-2222-3333-4444-555555555555"
            // 场景：codex 锚点在 → 用户退 codex 秒起 claude → CC hook 已覆写 .cc 锚点 → 采集器迟到的
            // 「codex 前台退出确认」clearIfMatches 不得误删新 .cc 锚点。
            store.updateAnchor(
                termId: "T", sessionId: codexSid, cwd: "/p", transcriptPath: "/p/r.jsonl",
                lastActiveTs: 1, harness: .codex)
            store.updateAnchor(
                termId: "T", sessionId: ccSid, cwd: "/p", transcriptPath: "/p/t.jsonl",
                lastActiveTs: 2, harness: .cc)
            store.clearIfMatches(termId: "T", harness: .codex, sessionId: codexSid)
            #expect(store.readAll()["T"]?.sessionId == ccSid, "harness 已变 .cc → 条件清除 no-op（不误删）")
            // sessionId 不匹配（同 harness 换会话）→ 亦 no-op。
            store.updateAnchor(
                termId: "T", sessionId: codexSid, cwd: "/p", transcriptPath: "/p/r.jsonl",
                lastActiveTs: 3, harness: .codex)
            store.clearIfMatches(
                termId: "T", harness: .codex, sessionId: "99999999-9999-9999-9999-999999999999")
            #expect(store.readAll()["T"] != nil, "sessionId 不匹配 → no-op")
            // 双匹配 → 移除。
            store.clearIfMatches(termId: "T", harness: .codex, sessionId: codexSid)
            #expect(store.readAll()["T"] == nil, "harness+sessionId 双匹配 → 清除")
        }
    }

    @Test("TSR_CX_cross_harness_latest_wins：同 termId CC↔Codex 切换 = 最近活跃覆盖同一键（保 crash-loop 计数）")
    func crossHarnessLatestWins() throws {
        try withTempRoot { root in
            let store = TerminalActiveSessionsStore(root: root)
            store.seedRestored(termId: "T", anchor: TerminalSessionAnchor(
                sessionId: "11111111-2222-3333-4444-555555555555", harness: .cc,
                cwd: "/p", transcriptPath: "/p/t.jsonl", lastActiveTs: 1,
                resumeAttempts: 2, lastResumeTs: 999))
            store.updateAnchor(
                termId: "T", sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                cwd: "/p", transcriptPath: "/p/r.jsonl", lastActiveTs: 5, harness: .codex)
            let a = store.readAll()["T"]
            #expect(a?.harness == .codex, "后采集者覆盖（最近活跃语义）")
            #expect(a?.resumeAttempts == 2 && a?.lastResumeTs == 999, "跨 harness 覆盖仍保 crash-loop 计数")
        }
    }

    @Test("clear + pruneKeepingOnly：删条目 / 只保留活体键")
    func clearAndPrune() throws {
        try withTempRoot { root in
            let store = TerminalActiveSessionsStore(root: root)
            for id in ["A", "B", "C"] {
                store.updateAnchor(
                    termId: id, sessionId: "11111111-2222-3333-4444-555555555555",
                    cwd: "/p", transcriptPath: "/p/t.jsonl", lastActiveTs: 1)
            }
            store.clear(termId: "A")
            #expect(store.readAll()["A"] == nil)
            store.pruneKeepingOnly(["B"])
            #expect(Set(store.readAll().keys) == ["B"], "只保留活体键")
        }
    }
}

// MARK: - 恢复闸纯逻辑（TerminalRestoreGate）

@Suite("TerminalRestoreGate（恢复闸纯逻辑）")
struct TerminalRestoreGateTests {
    @Test("TSR_sessionid_whitelist_rejects：严格 UUID 正则（前导 -/纯 - 旧式被拒，SEC-M3）")
    func sessionIdRegex() {
        #expect(TerminalRestoreGate.isValidSessionId("11111111-2222-3333-4444-555555555555"))
        #expect(TerminalRestoreGate.isValidSessionId("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))
        // 旧式过宽 `^[0-9a-f-]+$` 会放行的被拒：
        #expect(!TerminalRestoreGate.isValidSessionId("-rf"))
        #expect(!TerminalRestoreGate.isValidSessionId("--------"))
        #expect(!TerminalRestoreGate.isValidSessionId(""))
        #expect(!TerminalRestoreGate.isValidSessionId("11111111-2222-3333-4444-55555555555"), "缺一位")
        #expect(!TerminalRestoreGate.isValidSessionId("11111111-2222-3333-4444-5555555555GG"), "非 hex")
        #expect(!TerminalRestoreGate.isValidSessionId("11111111222233334444555555555555"), "无分隔")
        #expect(!TerminalRestoreGate.isValidSessionId("AAAAAAAA-2222-3333-4444-555555555555"), "大写不收（CC 小写）")
    }

    @Test("cwdHasControlBytes：CR/LF/ESC/DEL/C0 检出（M-1 回修，控制字节 cwd 退化 M3 不注入变形串）")
    func cwdControlBytes() {
        #expect(!TerminalRestoreGate.cwdHasControlBytes("/proj dir"), "普通路径含空格不算控制字节")
        #expect(!TerminalRestoreGate.cwdHasControlBytes("/a/b-c_d.e"))
        #expect(TerminalRestoreGate.cwdHasControlBytes("/a\rb"), "CR")
        #expect(TerminalRestoreGate.cwdHasControlBytes("/a\nb"), "LF")
        #expect(TerminalRestoreGate.cwdHasControlBytes("/a\u{1b}[3~b"), "ESC")
        #expect(TerminalRestoreGate.cwdHasControlBytes("/a\u{07}b"), "BEL/C0")
        #expect(TerminalRestoreGate.cwdHasControlBytes("/a\u{7f}b"), "DEL")
    }

    @Test("anchorComplete：三字段齐备合法才过（SEC-M2 复检）")
    func anchorComplete() {
        let ok = TerminalSessionAnchor(
            sessionId: "11111111-2222-3333-4444-555555555555", harness: .cc,
            cwd: "/p", transcriptPath: "/p/t.jsonl", lastActiveTs: 1)
        #expect(TerminalRestoreGate.anchorComplete(ok))
        #expect(!TerminalRestoreGate.anchorComplete(TerminalSessionAnchor(
            sessionId: "", harness: .cc, cwd: "/p", transcriptPath: "/t", lastActiveTs: 1)))
        #expect(!TerminalRestoreGate.anchorComplete(TerminalSessionAnchor(
            sessionId: "x", harness: .cc, cwd: "", transcriptPath: "/t", lastActiveTs: 1)))
        #expect(!TerminalRestoreGate.anchorComplete(TerminalSessionAnchor(
            sessionId: "x", harness: .cc, cwd: "/p", transcriptPath: "", lastActiveTs: 1)))
    }

    @Test("isWithinContainer：路径分量边界（不误配 -x 兄弟目录）")
    func containment() {
        #expect(TerminalRestoreGate.isWithinContainer(path: "/h/.claude/projects/a.jsonl", container: "/h/.claude"))
        #expect(TerminalRestoreGate.isWithinContainer(path: "/h/.claude", container: "/h/.claude"))
        #expect(!TerminalRestoreGate.isWithinContainer(path: "/h/.claude-evil/x", container: "/h/.claude"))
        #expect(!TerminalRestoreGate.isWithinContainer(path: "/etc/passwd", container: "/h/.claude"))
    }

    @Test("TSR_transcript_realpath_containment：realpath 解析 .. / symlink，逃逸容器即失败；缺文件失败")
    func transcriptPrecheck() throws {
        try withTempRoot { root in
            let container = root.appendingPathComponent(".claude", isDirectory: true)
            let projects = container.appendingPathComponent("projects", isDirectory: true)
            try FileManager.default.createDirectory(at: projects, withIntermediateDirectories: true)
            // 容器内真实文件 → 过。
            let good = projects.appendingPathComponent("good.jsonl")
            try Data("x".utf8).write(to: good)
            #expect(TerminalRestoreGate.transcriptPrecheckPasses(rawPath: good.path, container: container.path))
            // 缺文件（TSR_precheck_transcript_missing_skips 的判据）→ 失败。
            #expect(!TerminalRestoreGate.transcriptPrecheckPasses(
                rawPath: projects.appendingPathComponent("nope.jsonl").path, container: container.path))
            // symlink 逃逸：容器内 link 指向容器外真实文件 → realpath 落容器外 → 失败。
            let outside = root.appendingPathComponent("outside.jsonl")
            try Data("y".utf8).write(to: outside)
            let escape = projects.appendingPathComponent("escape.jsonl")
            try FileManager.default.createSymbolicLink(at: escape, withDestinationURL: outside)
            #expect(!TerminalRestoreGate.transcriptPrecheckPasses(rawPath: escape.path, container: container.path),
                    "symlink 逃逸容器 → 预检失败（SEC-M1）")
            // .. 穿越：容器内路径带 .. 指向外部 → realpath 规范化后落外 → 失败。
            let traversal = projects.path + "/../../outside.jsonl"
            #expect(!TerminalRestoreGate.transcriptPrecheckPasses(rawPath: traversal, container: container.path),
                    ".. 穿越 → 预检失败（SEC-M1）")
        }
    }

    @Test("TSR_crash_loop_isolates：注入后 T 秒内累计 K 次 → 隔离；存活过窗 → 清零")
    func crashLoopVerdict() {
        let K = 3
        let T: UInt64 = 30_000
        // 首次（无 lastResumeTs）→ 不隔离、attempts 归 0（正常尝试）。
        var v = TerminalRestoreGate.crashLoopVerdict(
            resumeAttempts: 0, lastResumeTs: nil, nowMs: 100_000, thresholdK: K, windowMs: T)
        #expect(!v.isolate && v.newAttempts == 0)
        // 上次 resume 后窗内又崩（now-lastResumeTs < T）→ attempts++。
        v = TerminalRestoreGate.crashLoopVerdict(
            resumeAttempts: 0, lastResumeTs: 90_000, nowMs: 100_000, thresholdK: K, windowMs: T)
        #expect(!v.isolate && v.newAttempts == 1)
        v = TerminalRestoreGate.crashLoopVerdict(
            resumeAttempts: 1, lastResumeTs: 95_000, nowMs: 100_000, thresholdK: K, windowMs: T)
        #expect(!v.isolate && v.newAttempts == 2)
        // 累计达 K → 隔离。
        v = TerminalRestoreGate.crashLoopVerdict(
            resumeAttempts: 2, lastResumeTs: 99_000, nowMs: 100_000, thresholdK: K, windowMs: T)
        #expect(v.isolate && v.newAttempts == 3)
        // 存活过窗（now-lastResumeTs >= T）→ 清零、不隔离（成功续跑）。
        v = TerminalRestoreGate.crashLoopVerdict(
            resumeAttempts: 2, lastResumeTs: 50_000, nowMs: 100_000, thresholdK: K, windowMs: T)
        #expect(!v.isolate && v.newAttempts == 0)
    }
}

// MARK: - 注入命令构建（ResumeCommand）

@Suite("ResumeCommand（注入串构建 + 转义）")
struct ResumeCommandTests {
    @Test("TSR_cwd_shell_escaped：cwd 单引号转义 + cd -- 断选项（SEC-B1）")
    func shellEscape() {
        // 内部单引号 → '\'' ；元字符被单引号包裹，shell 不展开。
        #expect(ResumeCommand.singleQuoteEscape("/a/b") == "'/a/b'")
        #expect(ResumeCommand.singleQuoteEscape("/a b/c") == "'/a b/c'")
        #expect(ResumeCommand.singleQuoteEscape("/a'b") == "'/a'\\''b'")
        let sid = "11111111-2222-3333-4444-555555555555"
        let body = ResumeCommand.resumeCommandBody(cwd: "/a/$(rm -rf x); b&c", sessionId: sid)
        #expect(body == "cd -- '/a/$(rm -rf x); b&c' && claude --resume \(sid)",
                "元字符被单引号包裹、cd -- 断选项 → 无命令注入（--resume 后不带 --，M5-R1）")
        // 前导 - 的 cwd 亦被单引号裹 + cd -- 断选项。
        let body2 = ResumeCommand.resumeCommandBody(cwd: "-rf", sessionId: sid)
        #expect(body2 == "cd -- '-rf' && claude --resume \(sid)")
        // M-1 回修（控制字节对抗样本）：单引号只杀 shell 元字符，控制字节须由 cwdHasControlBytes 前置拦截
        // → 该锚点退化 M3（不注入变形串进 PTY，对齐兄弟注入器 normalize 口径）。
        #expect(TerminalRestoreGate.cwdHasControlBytes("/proj\r\n"), "内嵌 CR/LF 被识别")
        #expect(TerminalRestoreGate.cwdHasControlBytes("/proj\u{1b}injected"), "内嵌 ESC 被识别")
        #expect(ResumeCommand.buildInjectionIfSafe(cwd: "/proj\rmalicious", sessionId: sid) == nil,
                "控制字节 cwd → 拒构建注入串（退化 M3）")
        #expect(ResumeCommand.buildInjectionIfSafe(cwd: "/proj dir", sessionId: sid)
                == "cd -- '/proj dir' && claude --resume \(sid)\r", "干净 cwd → 正常构建")
    }

    @Test("TSR_inject_cr_semantics：注入串尾恰一个 CR、串内无其他 CR/LF（案 A，P-1）")
    func crSemantics() {
        let sid = "11111111-2222-3333-4444-555555555555"
        let s = ResumeCommand.buildResumeInjection(cwd: "/proj", sessionId: sid)
        #expect(s.hasSuffix("\r"), "尾部自动回车（P-1 已裁）")
        #expect(s.filter { $0 == "\r" || $0 == "\n" }.count == 1, "恰一个 CR、无其他 CR/LF")
        #expect(s == "cd -- '/proj' && claude --resume \(sid)\r")
    }

    @Test("M5-R1 resume 形（--resume 后不带 --）：commander 可选值参数被 `--` 吞值 → 交互选择器（真机回归修正）")
    func resumeNoDoubleDash() {
        let sid = "11111111-2222-3333-4444-555555555555"
        // 无 harness 旧签名恒等 .claude；串内 `--resume` 与 sid 之间无 `--`（旧回归形已废）。
        let claudeBody = ResumeCommand.resumeCommandBody(cwd: "/proj", sessionId: sid)
        #expect(claudeBody == "cd -- '/proj' && claude --resume \(sid)")
        #expect(!claudeBody.contains("--resume -- "), "绝不回退到 `--resume -- <sid>`（会打开交互选择列表）")
        #expect(ResumeCommand.resumeCommandBody(cwd: "/proj", sessionId: sid, harness: .claude) == claudeBody,
                "harness=.claude 与无 harness 旧签名恒等")
    }

    @Test("M5-R1 Codex resume 形：`cd -- '<esc>' && codex resume <sid>` + 尾 CR + cwd 转义（位置参数无 --）")
    func codexResumeShape() {
        let sid = "11111111-2222-3333-4444-555555555555"
        // 命令体：codex resume <sid>（位置参数、无 --；与 CodexAdapter.makeTakeoverArgv 同形）。
        #expect(ResumeCommand.resumeCommandBody(cwd: "/proj dir", sessionId: sid, harness: .codex)
                == "cd -- '/proj dir' && codex resume \(sid)")
        // 元字符 cwd 单引号转义（SEC-B1）对 codex 同样生效。
        #expect(ResumeCommand.resumeCommandBody(cwd: "/a/$(x); b&c", sessionId: sid, harness: .codex)
                == "cd -- '/a/$(x); b&c' && codex resume \(sid)")
        // 完整注入串 = 命令体 + 尾恰一个 CR。
        let inj = ResumeCommand.buildInjectionIfSafe(cwd: "/proj", sessionId: sid, harness: .codex)
        #expect(inj == "cd -- '/proj' && codex resume \(sid)\r")
        #expect(inj?.filter { $0 == "\r" || $0 == "\n" }.count == 1, "恰一个 CR")
        // 控制字节 cwd → 拒构建（M-1 纵深防线对 codex harness 同守）。
        #expect(ResumeCommand.buildInjectionIfSafe(cwd: "/proj\rx", sessionId: sid, harness: .codex) == nil)
    }
}

// MARK: - 测试时钟（本套件本地）

final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var t: UInt64
    init(now: UInt64) { t = now }
    func now() -> UInt64 { lock.withLock { t } }
    func set(_ v: UInt64) { lock.withLock { t = v } }
}
