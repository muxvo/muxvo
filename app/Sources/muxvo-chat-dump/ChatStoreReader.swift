// ChatStore 后端 dump（--reader chatstore）——把 dump 的 CC/aggregate 查询切到 A2-1 正式 ChatStore
// （chat.db reconcile + 查询面），验 **ChatStore vs legacy = 0**（M5 批2 真验收，§8）。
//
// per-source（§8.3）由注入 base 决定：
//   cc        → ChatStore(ccBase, mirror, codexBase=nil)
//   codex     → ChatStore(ccBase=空临时目录, mirror=nil, codexBase=~/.codex)  // CC 面空，纯 Codex
//   aggregate → ChatStore(ccBase, mirror, codexBase=~/.codex)                 // 跨源归并/去重（§5.4）
//
// 每次调用新起进程 = 新鲜空 chat.db（A2-1 口径：reconcile 全量鲜提取 = 禁 5min 缓存等价）。

import Foundation
import MuxvoChatDumpKit
import MuxvoChatHistory

enum ChatStoreDump {

    static func run(_ args: DumpArgs, keepAllLimit: Int) {
        let store: ChatStore
        do { store = try makeStore(args) } catch { fail("ChatStore 构造失败：\(error)") }

        do {
            switch args.command {
            case .index:
                let start = Date()
                let projectCount = try store.projects().count
                let sessionCount = try store.allRecentSessions(limit: keepAllLimit).count
                let elapsedMs = Int(Date().timeIntervalSince(start) * 1000)
                let summary: [String: Any] = [
                    "command": "index", "reader": "chatstore", "sourceMode": "\(args.sourceMode)",
                    "projectCount": projectCount, "sessionCount": sessionCount, "elapsedMs": elapsedMs,
                ]
                if let d = try? JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]) {
                    FileHandle.standardOutput.write(d)
                    FileHandle.standardOutput.write(Data([0x0A]))
                }
            case .projects:
                writeRecords(try store.projects().map(DumpJSON.project))
            case .sessionsProject(let hash):
                writeRecords(try store.sessions(projectHash: hash, limit: args.limit ?? keepAllLimit).map(DumpJSON.summary))
            case .sessionsAll:
                writeRecords(try store.allRecentSessions(limit: args.limit ?? keepAllLimit).map(DumpJSON.summary))
            case .session(let project, let session):
                writeRecords(try store.messages(projectHash: project, sessionId: session, limit: args.limit).map(DumpJSON.message))
            case .search(let query):
                writeRecords(try store.search(query: query).map(DumpJSON.searchResult))
            case .mergeArchive:
                fail("merge-archive 不走 --reader chatstore（main 分发前已拦截，此处不可达）")
            }
        } catch {
            fail("ChatStore 查询失败：\(error)")
        }
    }

    private static func makeStore(_ args: DumpArgs) throws -> ChatStore {
        // db 策略：
        //  · 无 --db → 每进程新鲜临时空库（reconcile 全量鲜提取；fixture/正确性档用，禁缓存等价）。
        //  · 有 --db → 持久库跨命令复用（首命令全量 reconcile，后续按 mtime 增量跳过——静态语料下
        //    与全量鲜提取等价，真数据档避免每命令重扫 GB 级语料；活跃写会话仍属 live 残差范畴）。
        let dbURL: URL
        if let p = args.dbPath {
            dbURL = p  // 持久，不删
        } else {
            dbURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("chat-dump-\(UUID().uuidString).db")
            try? FileManager.default.removeItem(at: dbURL)  // 临时库保空
        }
        let db = try ChatDatabase.open(at: dbURL)

        let ccBaseForStore: URL
        let codexRoot: URL?
        switch args.sourceMode {
        case .cc:
            ccBaseForStore = args.ccBase!
            codexRoot = nil
        case .codex:
            ccBaseForStore = try emptyDir()  // CC 面空 → 纯 Codex
            codexRoot = args.codexBase!.deletingLastPathComponent()
        case .aggregate:
            ccBaseForStore = args.ccBase!
            codexRoot = args.codexBase!.deletingLastPathComponent()
        }
        return ChatStore(ccBase: ccBaseForStore, mirrorBase: args.mirror, codexBase: codexRoot, database: db)
    }

    private static func emptyDir() throws -> URL {
        let d = FileManager.default.temporaryDirectory
            .appendingPathComponent("chat-dump-emptycc-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func fail(_ msg: String) -> Never {
        FileHandle.standardError.write(Data("muxvo-chat-dump: \(msg)\n".utf8))
        exit(70)
    }
}
