// Codex 纯函数内核案例（CD_codex_* 子集 + 目录/snippet 边界）：projectHash 红线、sessionId、
// snippet 窗口、目录发现。ChatModels-free，独立于 A1-2 四输出类型。行为权威 chat-data.md §5 + §7。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("Codex 源纯函数内核（§5 目录/编码/snippet）")
struct CodexPrimitivesTests {

    // §5.3 红线：同 cwd 下 encodeProjectHash 与 CC 目录名编码逐字符一致。
    // 期望串 = CC 目录真值（`cwd.replace(/[^a-zA-Z0-9-]/g,'-')`），覆盖 `_`/`.`/空格/`&`/中文/worktree。
    @Test("CD_codex_projecthash_matches_cc：同 cwd Codex 编码 == CC 目录名（含四大特殊字符）")
    func CD_codex_projecthash_matches_cc() {
        #expect(CodexProjectHash.encode("/Users/alice/repo") == "-Users-alice-repo")
        #expect(CodexProjectHash.encode("/Users/alice/my_repo") == "-Users-alice-my-repo")   // _ → -
        #expect(CodexProjectHash.encode("/Users/alice/repo.git") == "-Users-alice-repo-git")  // . → -
        #expect(CodexProjectHash.encode("/Users/alice/a b") == "-Users-alice-a-b")            // 空格 → -
        #expect(CodexProjectHash.encode("/Users/alice/a&b") == "-Users-alice-a-b")            // & → -
        // worktree：`.worktrees` 的 `/.` → `--`，dash 本身保留 → 产出 §1.2 认得的 `--worktrees-` 标记。
        #expect(
            CodexProjectHash.encode("/Users/alice/repo/.worktrees/wt-1")
                == "-Users-alice-repo--worktrees-wt-1"
        )
        // 中文：每个 BMP 汉字单 UTF-16 码元 → 单 `-`。
        #expect(CodexProjectHash.encode("/Users/alice/中文") == "-Users-alice---")
        // 空 cwd → 空串（legacy `if (!cwd) return ''`）。
        #expect(CodexProjectHash.encode("") == "")
    }

    // §7 NIT：emoji 是代理对（2 UTF-16 码元），逐码元各出一 `-` → 一 emoji 两 `--`（刻意复刻 JS 无 u-flag）。
    @Test("CD_codex_projecthash_emoji_surrogate：emoji 代理对逐码元双 dash（NIT 复刻 JS）")
    func CD_codex_projecthash_emoji_surrogate() {
        #expect(CodexProjectHash.encode("/tmp/🎉") == "-tmp---")  // 🎉 U+1F389 → 两码元 → "--"
    }

    // §5.1：rollout-YYYY-MM-DDTHH-MM-SS-{UUID}.jsonl 去 .jsonl、按 - 切、取末 5 段（UUID 5 组）。
    @Test("CD_codex_sessionid_last5_groups：文件名末 5 段拼 UUID，不足 5 段用整 base")
    func CD_codex_sessionid_last5_groups() {
        #expect(
            CodexSessionId.extract(
                fromFileName: "rollout-2026-06-04T18-39-26-019e9237-6c4c-79e0-8676-f8b9a700a0f8.jsonl"
            ) == "019e9237-6c4c-79e0-8676-f8b9a700a0f8"
        )
        // 目录前缀被 basename 剥离，不影响提取。
        #expect(
            CodexSessionId.extract(
                fromFileName: "2026/06/04/rollout-2026-06-04T18-39-26-aaaa-bbbb-cccc-dddd-eeee.jsonl"
            ) == "aaaa-bbbb-cccc-dddd-eeee"
        )
        // 不足 5 段 → 整 base。
        #expect(CodexSessionId.extract(fromFileName: "a-b-c.jsonl") == "a-b-c")
        #expect(CodexSessionId.extract(fromFileName: "weird.jsonl") == "weird")
    }

    // §5.3 per-source：Codex snippet = 命中前 30 + query + 后 30（UTF-16 码元），大小写不敏感、原串保真。
    @Test("CD_codex_search_snippet_window_30：Codex snippet 前 30 后 30（非 CC 的 170）")
    func CD_codex_search_snippet_window_30() {
        let a30 = String(repeating: "a", count: 40)
        let b30 = String(repeating: "b", count: 40)
        let message = a30 + "NEEDLE" + b30
        let snippet = CodexSnippet.make(message: message, query: "needle")  // 小写 query 命中大写原文
        #expect(snippet == String(repeating: "a", count: 30) + "NEEDLE" + String(repeating: "b", count: 30))
        #expect(snippet?.utf16.count == 66)  // 30 + 6 + 30
    }

    @Test("CD_codex_search_snippet_clamps_start：命中靠头 → from clamp 到 0")
    func CD_codex_search_snippet_clamps_start() {
        #expect(CodexSnippet.make(message: "hi NEEDLE tail", query: "needle") == "hi NEEDLE tail")
        #expect(CodexSnippet.make(message: "no match here", query: "zzz") == nil)  // 无命中 → nil
    }

    // §5.3 / CD_search_chinese_emoji（Codex 变体）：中文子串命中，原串保真。
    @Test("CD_codex_search_chinese：中文子串命中，snippet 保真")
    func CD_codex_search_chinese() {
        let snippet = CodexSnippet.make(message: "前缀内容 查询关键词 后缀内容", query: "查询关键词")
        #expect(snippet == "前缀内容 查询关键词 后缀内容")  // 全长 < 窗口 → 整串
    }

    // §5.1：sessions/YYYY/MM/DD/*.jsonl 三层数字校验，非法层/非 .jsonl 跳过。
    @Test("CD_codex_dir_discovery：只收 YYYY/MM/DD 下 .jsonl，非法层与非 jsonl 跳过")
    func CD_codex_dir_discovery() throws {
        try withTempRoot { root in
            let sessions = root.appendingPathComponent("sessions", isDirectory: true)
            let fm = FileManager.default
            // 合法：2026/06/04 下两个 .jsonl
            let ok = sessions.appendingPathComponent("2026/06/04", isDirectory: true)
            try fm.createDirectory(at: ok, withIntermediateDirectories: true)
            try "{}".write(to: ok.appendingPathComponent("rollout-x.jsonl"), atomically: true, encoding: .utf8)
            try "{}".write(to: ok.appendingPathComponent("rollout-y.jsonl"), atomically: true, encoding: .utf8)
            try "not-jsonl".write(to: ok.appendingPathComponent("notes.txt"), atomically: true, encoding: .utf8)
            // 非法年份目录（非 4 位数字）
            let badYear = sessions.appendingPathComponent("abcd/06/04", isDirectory: true)
            try fm.createDirectory(at: badYear, withIntermediateDirectories: true)
            try "{}".write(to: badYear.appendingPathComponent("rollout-z.jsonl"), atomically: true, encoding: .utf8)
            // 非法月份（单位数字）
            let badMonth = sessions.appendingPathComponent("2026/6/04", isDirectory: true)
            try fm.createDirectory(at: badMonth, withIntermediateDirectories: true)
            try "{}".write(to: badMonth.appendingPathComponent("rollout-w.jsonl"), atomically: true, encoding: .utf8)

            let found = CodexDirectory.findAllSessionFiles(sessionsDir: sessions)
                .map { $0.lastPathComponent }.sorted()
            #expect(found == ["rollout-x.jsonl", "rollout-y.jsonl"])
        }
    }

    @Test("CD_codex_dir_missing_empty：sessions 目录不存在 → 空数组，不抛错")
    func CD_codex_dir_missing_empty() throws {
        try withTempRoot { root in
            let sessions = root.appendingPathComponent("sessions", isDirectory: true)  // 未创建
            #expect(CodexDirectory.findAllSessionFiles(sessionsDir: sessions).isEmpty)
        }
    }

    @Test("CD_codex_isdigits：三层长度精确的 ASCII 数字校验")
    func CD_codex_isdigits() {
        #expect(CodexDirectory.isDigits("2026", count: 4))
        #expect(CodexDirectory.isDigits("06", count: 2))
        #expect(!CodexDirectory.isDigits("6", count: 2))     // 长度不符
        #expect(!CodexDirectory.isDigits("abcd", count: 4))  // 非数字
        #expect(!CodexDirectory.isDigits("２０２６", count: 4))  // 全角非 ASCII 数字
    }
}
