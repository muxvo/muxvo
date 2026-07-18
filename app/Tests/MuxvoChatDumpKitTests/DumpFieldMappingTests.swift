// dump 字段映射单测（chat-data.md §8.1 legacy 字段名逐字 + §8.2 归一）——钉住：
//  · 四类型字段名与 chat.types.ts 逐字一致；
//  · 可选键 nil 省略 / 非 nil 出现（totalSize/cwd/worktreeLabel/archiveOnly/gitBranch）；
//  · source 必填（claude-code / codex）；
//  · mtime floor 到整数毫秒（lastActivity / lastModified）；
//  · content 两形态（string ∣ block[]）+ 块字段保真；type 三态映射。

import Foundation
import MuxvoChatHistory
import MuxvoTranscript
import XCTest

@testable import MuxvoChatDumpKit

final class DumpFieldMappingTests: XCTestCase {

    /// 编码单条记录 → JSONSerialization 回读（模拟 diff.mjs 侧 JSON.parse）。
    private func roundTrip(_ dict: [String: Any]) -> [String: Any] {
        let data = try! DumpJSON.encode([dict])
        let arr = try! JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        return arr[0]
    }
    private func i64(_ o: [String: Any], _ k: String) -> Int64? { (o[k] as? NSNumber)?.int64Value }

    // MARK: - ProjectInfo（§8.1）

    func testProjectFieldsAndTotalSizeOmittedWhenNil() {
        let p = ChatProjectInfo(
            projectHash: "-Users-x", displayPath: "/Users/x", displayName: "x",
            sessionCount: 3, totalSize: nil, lastActivity: 1_783_332_090_123.9, source: .claudeCode)
        let o = roundTrip(DumpJSON.project(p))
        XCTAssertEqual(Set(o.keys), ["projectHash", "displayPath", "displayName", "sessionCount", "lastActivity", "source"])
        XCTAssertEqual(o["projectHash"] as? String, "-Users-x")
        XCTAssertEqual(o["source"] as? String, "claude-code")
        XCTAssertEqual(i64(o, "lastActivity"), 1_783_332_090_123)  // §8.2 floor
        XCTAssertNil(o["totalSize"])  // §8.2 规则4 nil 省略
    }

    func testProjectTotalSizePresentWhenSet() {
        let p = ChatProjectInfo(
            projectHash: "-h", displayPath: "/p", displayName: "p",
            sessionCount: 1, totalSize: 42, lastActivity: 0, source: .codex)
        let o = roundTrip(DumpJSON.project(p))
        XCTAssertEqual(i64(o, "totalSize"), 42)
        XCTAssertEqual(o["source"] as? String, "codex")
    }

    // MARK: - SessionSummary（§8.1）

    func testSummaryOptionalKeysOmitted() {
        let s = ChatSessionSummary(
            sessionId: "sid", projectHash: "-h", title: "t", startedAt: "2026-07-07T00:00:00.000Z",
            lastModified: 100.7, fileSize: 5, source: .codex)
        let o = roundTrip(DumpJSON.summary(s))
        XCTAssertEqual(Set(o.keys), ["sessionId", "projectHash", "title", "startedAt", "lastModified", "fileSize", "source"])
        XCTAssertNil(o["cwd"])
        XCTAssertNil(o["worktreeLabel"])
        XCTAssertNil(o["archiveOnly"])
        XCTAssertEqual(i64(o, "lastModified"), 100)  // floor
        XCTAssertEqual(o["source"] as? String, "codex")
    }

    func testSummaryOptionalKeysPresent() {
        let s = ChatSessionSummary(
            sessionId: "sid", projectHash: "-h", title: "t", startedAt: "2026",
            lastModified: 0, fileSize: 0, cwd: "/c", worktreeLabel: "wt-1", archiveOnly: true,
            source: .claudeCode)
        let o = roundTrip(DumpJSON.summary(s))
        XCTAssertEqual(o["cwd"] as? String, "/c")
        XCTAssertEqual(o["worktreeLabel"] as? String, "wt-1")
        XCTAssertEqual(o["archiveOnly"] as? Bool, true)
    }

    // MARK: - SessionMessage（§8.1）

    func testMessageStringContentGitBranchOmitted() {
        let m = ChatSessionMessage(
            uuid: "u", type: .user, sessionId: "s", cwd: "/c", timestamp: "ts", content: .text("hi"))
        let o = roundTrip(DumpJSON.message(m))
        XCTAssertEqual(Set(o.keys), ["uuid", "type", "sessionId", "cwd", "timestamp", "content"])
        XCTAssertEqual(o["type"] as? String, "user")
        XCTAssertEqual(o["content"] as? String, "hi")
        XCTAssertNil(o["gitBranch"])
    }

    func testMessageBlockContentAndGitBranch() {
        let block = ChatContentBlock(
            type: "image", source: .object(["type": .string("base64"), "data": .string("AAA")]))
        let m = ChatSessionMessage(
            uuid: "u", type: .assistant, sessionId: "s", cwd: "/c", gitBranch: "main",
            timestamp: "ts", content: .blocks([block]))
        let o = roundTrip(DumpJSON.message(m))
        XCTAssertEqual(o["gitBranch"] as? String, "main")
        XCTAssertEqual(o["type"] as? String, "assistant")
        let blocks = o["content"] as? [[String: Any]]
        XCTAssertEqual(blocks?.count, 1)
        XCTAssertEqual(blocks?.first?["type"] as? String, "image")
        XCTAssertEqual((blocks?.first?["source"] as? [String: Any])?["data"] as? String, "AAA")
    }

    func testSystemMessageType() {
        let m = ChatSessionMessage(uuid: "u", type: .system, sessionId: "s", cwd: "", timestamp: "", content: .text(""))
        XCTAssertEqual(roundTrip(DumpJSON.message(m))["type"] as? String, "system")
    }

    // MARK: - SearchResult（§8.1）

    func testSearchResultFields() {
        let r = ChatSearchResult(projectHash: "-h", sessionId: "s", snippet: "snip", timestamp: "ts")
        let o = roundTrip(DumpJSON.searchResult(r))
        XCTAssertEqual(Set(o.keys), ["projectHash", "sessionId", "snippet", "timestamp"])
        XCTAssertEqual(o["snippet"] as? String, "snip")
    }
}
