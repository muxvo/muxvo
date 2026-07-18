// muxvo-chat-dump 参数解析单测（M7 批6，台账 MINOR-2：可执行此前无测试 target）。
// 钉 DumpArgs.parse 的源推断（§8.3）、命令映射、严格拒未知 flag、merge-archive flag 隔离。
import Foundation
import Testing

@testable import muxvo_chat_dump

@Suite("muxvo-chat-dump 参数解析（DumpArgs.parse）")
struct DumpArgsTests {

    // MARK: 源推断（§8.3：cc-only / codex-only / aggregate）

    @Test("仅 --cc-base → sourceMode .cc")
    func ccOnlyIsCC() throws {
        let a = try DumpArgs.parse(["--cc-base", "/tmp/projects", "projects"])
        #expect(a.sourceMode == .cc)
        #expect(a.command == .projects)
    }

    @Test("仅 --codex-base → sourceMode .codex")
    func codexOnlyIsCodex() throws {
        let a = try DumpArgs.parse(["--codex-base", "/tmp/sessions", "projects"])
        #expect(a.sourceMode == .codex)
    }

    @Test("--cc-base + --codex-base → sourceMode .aggregate")
    func bothIsAggregate() throws {
        let a = try DumpArgs.parse(["--cc-base", "/tmp/p", "--codex-base", "/tmp/s", "projects"])
        #expect(a.sourceMode == .aggregate)
    }

    // MARK: 命令映射

    @Test("index / projects 命令")
    func simpleCommands() throws {
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "index"]).command == .index)
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "projects"]).command == .projects)
    }

    @Test("sessions --project <hash> vs --all")
    func sessionsCommands() throws {
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "sessions", "--project", "abc"]).command
            == .sessionsProject(hash: "abc"))
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "sessions", "--all"]).command == .sessionsAll)
    }

    @Test("sessions 缺 --project/--all → 拒")
    func sessionsNeedsProjectOrAll() {
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["--cc-base", "/tmp/p", "sessions"])
        }
    }

    @Test("session --project --session；缺任一即拒")
    func sessionCommand() throws {
        #expect(try DumpArgs.parse(
            ["--cc-base", "/tmp/p", "session", "--project", "h", "--session", "s1"]).command
            == .session(project: "h", session: "s1"))
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["--cc-base", "/tmp/p", "session", "--project", "h"])
        }
    }

    @Test("search --query")
    func searchCommand() throws {
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "search", "--query", "hi"]).command
            == .search(query: "hi"))
    }

    // MARK: merge-archive（独立离线命令，不需源）

    @Test("merge-archive --dry-run 免 --marker；真跑缺 --marker 即拒")
    func mergeArchiveDryRunVsMarker() throws {
        // dry-run：不需 --cc-base/--codex-base，也不需 --marker。
        let dry = try DumpArgs.parse(
            ["merge-archive", "--source", "/tmp/src", "--dest", "/tmp/dst", "--dry-run"])
        guard case let .mergeArchive(_, _, marker, dryRun) = dry.command else {
            Issue.record("应为 mergeArchive"); return
        }
        #expect(dryRun)
        #expect(marker == nil)

        // 真跑缺 --marker → 拒（防误写真实池）。
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["merge-archive", "--source", "/tmp/src", "--dest", "/tmp/dst"])
        }
        // 真跑带 --marker → 通过。
        let real = try DumpArgs.parse(
            ["merge-archive", "--source", "/tmp/src", "--dest", "/tmp/dst", "--marker", "/tmp/m"])
        guard case let .mergeArchive(_, _, m2, dry2) = real.command else {
            Issue.record("应为 mergeArchive"); return
        }
        #expect(!dry2)
        #expect(m2 != nil)
    }

    @Test("merge-archive 专属 flag 不得泄漏到其它命令")
    func mergeFlagsIsolated() {
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["--cc-base", "/tmp/p", "projects", "--source", "/tmp/x"])
        }
    }

    // MARK: 严格性 + 其它 flag

    @Test("缺子命令 / 未知参数 / --limit 非整数 → 拒")
    func strictErrors() {
        #expect(throws: DumpArgs.ParseError.self) { _ = try DumpArgs.parse(["--cc-base", "/tmp/p"]) }
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["--cc-base", "/tmp/p", "--bogus", "projects"])
        }
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["--cc-base", "/tmp/p", "--limit", "abc", "projects"])
        }
    }

    @Test("至少给一个源（非 merge-archive）")
    func needsSource() {
        #expect(throws: DumpArgs.ParseError.self) { _ = try DumpArgs.parse(["projects"]) }
    }

    @Test("--reader shell|chatstore 解析；非法值拒")
    func readerFlag() throws {
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "--reader", "chatstore", "projects"]).reader
            == .chatstore)
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "projects"]).reader == .shell) // 默认
        #expect(throws: DumpArgs.ParseError.self) {
            _ = try DumpArgs.parse(["--cc-base", "/tmp/p", "--reader", "bogus", "projects"])
        }
    }

    @Test("--limit 整数解析")
    func limitParsed() throws {
        #expect(try DumpArgs.parse(["--cc-base", "/tmp/p", "--limit", "42", "sessions", "--all"]).limit == 42)
    }
}
