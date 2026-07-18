// BridgeBus fs.request 接线单测（批A，plan-native §5.1 / §7.1）：#6 fs.request 激活后 decode→onFsRequest
// 闭包→okReply（仿 term.command/orch）；业务失败经 FsResponse.rejected 类型化 payload（信封仍 ok:true）；
// 未接处理器回 UNAVAILABLE；payload 不符 schema 回 BAD_REQUEST。
// 命名纪律：非 spec-ID 翻牌，测试名一律中文开头（spec-runner 防伪面）。
import Foundation
import Testing

@testable import MuxvoBridge

@MainActor
@Suite("BridgeBus fs.request（#6，M6 批A 激活）")
struct BridgeBusFsRequestTests {

    private func makeBus() -> BridgeBus {
        let bus = BridgeBus(appVersion: "0.0.0-test")
        bus.pushSink = { _ in }
        return bus
    }

    private func envelope(_ type: String, payload: Any? = nil) -> [String: Any] {
        var e: [String: Any] = ["v": 1, "type": type]
        if let payload { e["payload"] = payload }
        return e
    }

    private func errorCode(_ reply: [String: Any]) -> String? {
        (reply["error"] as? [String: Any])?["code"] as? String
    }

    @Test("readDir 分发到 onFsRequest 闭包并回传 dir（ok:true 类型化 payload round-trip）")
    func readDirDispatched() async throws {
        let bus = makeBus()
        var received: FsRequest?
        bus.onFsRequest = { req in
            received = req
            return .dir(entries: [FsEntry(name: "a.txt", isDirectory: false, size: 12)], truncated: nil)
        }
        let reply = await bus.handleIncoming(
            envelope("fs.request", payload: ["kind": "readDir", "path": "/Users/test/proj"]))
        #expect(received == .readDir(path: "/Users/test/proj"))
        #expect(reply["ok"] as? Bool == true)
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let resp = try JSONDecoder().decode(FsResponse.self, from: data)
        #expect(resp == .dir(entries: [FsEntry(name: "a.txt", isDirectory: false, size: 12)], truncated: nil))
    }

    @Test("业务失败 rejected 透传为 ok:true 的类型化 payload（不占信封错误，同 term.command 先例）")
    func rejectedPassthrough() async throws {
        let bus = makeBus()
        bus.onFsRequest = { _ in .rejected(code: "PERM_DENIED", message: "无法读取此目录") }
        let reply = await bus.handleIncoming(
            envelope("fs.request", payload: ["kind": "readDir", "path": "/root"]))
        #expect(reply["ok"] as? Bool == true) // 信封仍 ok:true
        let payload = try #require(reply["payload"] as? [String: Any])
        let data = try JSONSerialization.data(withJSONObject: payload)
        let resp = try JSONDecoder().decode(FsResponse.self, from: data)
        #expect(resp == .rejected(code: "PERM_DENIED", message: "无法读取此目录"))
    }

    @Test("worktree 三态与 showFileMenu 全 decode 并分发")
    func allVariantsDecoded() async {
        let bus = makeBus()
        var got: [FsRequest] = []
        bus.onFsRequest = { req in got.append(req); return .worktreeRemoved }
        _ = await bus.handleIncoming(envelope("fs.request", payload: [
            "kind": "showFileMenu", "path": "/a", "isDirectory": true, "x": 10.0, "y": 20.0]))
        _ = await bus.handleIncoming(envelope("fs.request", payload: ["kind": "worktreeStatus", "cwd": "/repo"]))
        _ = await bus.handleIncoming(envelope("fs.request", payload: ["kind": "worktreeCreate", "repoPath": "/repo"]))
        _ = await bus.handleIncoming(envelope("fs.request", payload: ["kind": "worktreeRemove", "worktreePath": "/repo/.worktrees/wt-1"]))
        #expect(got == [
            .showFileMenu(path: "/a", isDirectory: true, x: 10, y: 20),
            .worktreeStatus(cwd: "/repo"),
            .worktreeCreate(repoPath: "/repo"),
            .worktreeRemove(worktreePath: "/repo/.worktrees/wt-1"),
        ])
    }

    @Test("readFile/writeFile 新变体 decode 并分发（往返 fileContent/fileWritten；encoding 省略/未知字段容错）")
    func readWriteVariantsDecoded() async throws {
        let bus = makeBus()
        var got: [FsRequest] = []
        bus.onFsRequest = { req in
            got.append(req)
            switch req {
            case .readFile: return .fileContent(content: "hi", encoding: "utf8", truncated: nil, mtimeMs: 42)
            case .writeFile: return .fileWritten(mtimeMs: 99)
            default: return .rejected(code: "INTERNAL", message: "x")
            }
        }
        let r1 = await bus.handleIncoming(envelope("fs.request", payload: [
            "kind": "readFile", "path": "/a.txt", "encoding": "utf8"]))
        // encoding 省略（→ nil）+ 未知字段容错（沿用现例，keyed 容器忽略未知键）。
        _ = await bus.handleIncoming(envelope("fs.request", payload: [
            "kind": "readFile", "path": "/b.txt", "unknownField": "tolerated"]))
        let r3 = await bus.handleIncoming(envelope("fs.request", payload: [
            "kind": "writeFile", "path": "/c.txt", "content": "data", "baseMtimeMs": 7]))
        // baseMtimeMs 省略（→ nil，无条件写路径）。
        _ = await bus.handleIncoming(envelope("fs.request", payload: [
            "kind": "writeFile", "path": "/d.txt", "content": "data"]))
        #expect(got == [
            .readFile(path: "/a.txt", encoding: "utf8"),
            .readFile(path: "/b.txt", encoding: nil),
            .writeFile(path: "/c.txt", content: "data", baseMtimeMs: 7),
            .writeFile(path: "/d.txt", content: "data", baseMtimeMs: nil),
        ])
        // fileContent 以类型化 payload 往返（信封 ok:true）。
        #expect(r1["ok"] as? Bool == true)
        let p1 = try #require(r1["payload"] as? [String: Any])
        let resp1 = try JSONDecoder().decode(FsResponse.self, from: JSONSerialization.data(withJSONObject: p1))
        #expect(resp1 == .fileContent(content: "hi", encoding: "utf8", truncated: nil, mtimeMs: 42))
        let p3 = try #require(r3["payload"] as? [String: Any])
        let resp3 = try JSONDecoder().decode(FsResponse.self, from: JSONSerialization.data(withJSONObject: p3))
        #expect(resp3 == .fileWritten(mtimeMs: 99))
    }

    @Test("无原生处理器（onFsRequest=nil，FsRequestRouter 未接线）回 UNAVAILABLE")
    func unavailableWithoutHandler() async {
        let bus = makeBus() // 不设 onFsRequest
        let reply = await bus.handleIncoming(
            envelope("fs.request", payload: ["kind": "readDir", "path": "/x"]))
        #expect(errorCode(reply) == "UNAVAILABLE")
    }

    @Test("payload 不符 schema 回 BAD_REQUEST（未知 kind / 缺必填 / payload 整缺）")
    func badSchema() async {
        let bus = makeBus()
        bus.onFsRequest = { _ in .worktreeRemoved }
        #expect(errorCode(await bus.handleIncoming(
            envelope("fs.request", payload: ["kind": "teleport"]))) == "BAD_REQUEST")
        #expect(errorCode(await bus.handleIncoming(
            envelope("fs.request", payload: ["kind": "readDir"]))) == "BAD_REQUEST") // 缺 path
        #expect(errorCode(await bus.handleIncoming(
            envelope("fs.request"))) == "BAD_REQUEST") // payload 整缺
    }
}
