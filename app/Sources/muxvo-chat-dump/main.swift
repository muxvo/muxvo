// muxvo-chat-dump：M5 双跑对照 dump（chat-data.md §8）。
//
// 输出四类型 legacy 字段名 JSON 到 stdout（一行紧凑数组），供 tools/chat-dual-run/diff.mjs 与
// legacy-dump.mts 逐字段对照。源由 --cc-base / --codex-base 推断（§8.3 per-source 主口径 + aggregate）。
//
// CC 侧 fs 壳为临时实现（CCFileSource，驱动 MuxvoChatHistory 冻结纯函数）；批末换正式 ChatStore。
// Codex 侧直用 MuxvoChatHistory.CodexSessionSource（批1 已实装 fs 读者）。

import Foundation
import MuxvoChatDumpKit
import MuxvoChatHistory

/// 序列化四类型记录数组到 stdout（紧凑 JSON + 换行）。编码逻辑在 MuxvoChatDumpKit（可单测）。
func writeRecords(_ records: [[String: Any]]) {
    do {
        let data = try DumpJSON.encode(records)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } catch {
        FileHandle.standardError.write(Data("muxvo-chat-dump: JSON 序列化失败：\(error)\n".utf8))
        exit(70)
    }
}

// 大默认 limit：sessions 列表保「全量」（§8.2 归一层按 (projectHash, sessionId) 重排，
// mtime-sort 不影响最终 diff；全量避免 topN 截断处的 mtime 平局分歧）。
let keepAllLimit = 1_000_000

let argv = Array(CommandLine.arguments.dropFirst())
let args: DumpArgs
do {
    args = try DumpArgs.parse(argv)
} catch {
    FileHandle.standardError.write(Data("muxvo-chat-dump: \(error)\n".utf8))
    exit(64)
}

/// Codex 根：--codex-base 是 sessions 目录，取其父作 codexBasePath（含 .codex-global-state.json）。
func codexSource() -> CodexSessionSource? {
    guard let sessionsDir = args.codexBase else { return nil }
    let root = sessionsDir.deletingLastPathComponent()
    return CodexSessionSource(codexBasePath: root)
}

func ccSource() -> CCFileSource? {
    guard let ccBase = args.ccBase else { return nil }
    return CCFileSource(ccBase: ccBase, archiveBase: args.mirror)
}

// MARK: - index（性能记录，非 diff 面 → stdout 一个 JSON 对象）

func runIndex() {
    let start = Date()
    var projectCount = 0
    var sessionCount = 0
    if let cc = ccSource() {
        let (projects, _) = cc.getProjects()
        projectCount += projects.count
        sessionCount += cc.getAllRecentSessions(limit: keepAllLimit).count
    }
    if let codex = codexSource() {
        projectCount += codex.getProjects().count
        sessionCount += codex.getAllRecentSessions(limit: keepAllLimit).count
    }
    let elapsedMs = Int(Date().timeIntervalSince(start) * 1000)
    let summary: [String: Any] = [
        "command": "index",
        "sourceMode": "\(args.sourceMode)",
        "projectCount": projectCount,
        "sessionCount": sessionCount,
        "elapsedMs": elapsedMs,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

// MARK: - merge-archive（离线归档并入，legacy-archive-reclaim 批）

/// 输出单 JSON 对象（sortedKeys 稳定序 + 换行），与 runIndex 同风格。
func writeReport(_ report: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

/// dry-run：只读预估（plan()，零写盘）→ exit 0。
/// 真跑：migrateIfNeeded（marker 幂等 seal）→ done/skippedMarker exit 0，partial exit 65。
func runMergeArchive(source: URL, dest: URL, marker: URL?, dryRun: Bool) -> Never {
    var report: [String: Any] = [
        "command": "merge-archive",
        "mode": dryRun ? "dry-run" : "apply",
        "source": source.path,
        "dest": dest.path,
    ]
    if dryRun {
        // marker 有无均不影响 plan（不看 marker、零写盘）；传占位路径即可。
        let mig = ChatArchiveMigrator(
            legacyRoot: source, sharedRoot: dest,
            markerURL: marker ?? source.appendingPathComponent(".dry-run-marker-unused"))
        let plan = mig.plan()
        report["toCopy"] = plan.toCopy
        report["toCopyBytes"] = plan.toCopyBytes
        report["toReplace"] = plan.toReplace
        report["toReplaceBytes"] = plan.toReplaceBytes
        report["toSkip"] = plan.toSkip
        report["unreadable"] = plan.unreadable
        writeReport(report)
        exit(0)
    }
    // DumpArgs 保证真跑必有 marker。
    let mig = ChatArchiveMigrator(legacyRoot: source, sharedRoot: dest, markerURL: marker!)
    switch mig.migrateIfNeeded() {
    case .skippedMarker:
        report["outcome"] = "skippedMarker"
        writeReport(report)
        exit(0)
    case .done(let copied, let skipped):
        report["outcome"] = "done"
        report["copied"] = copied
        report["skipped"] = skipped
        writeReport(report)
        exit(0)
    case .partial(let copied, let skipped, let failed):
        report["outcome"] = "partial"
        report["copied"] = copied
        report["skipped"] = skipped
        report["failed"] = failed
        writeReport(report)
        exit(65)  // 有硬失败未 seal：脚本侧必须能看见
    }
}

// MARK: - 分发

if case .mergeArchive(let source, let dest, let marker, let dryRun) = args.command {
    runMergeArchive(source: source, dest: dest, marker: marker, dryRun: dryRun)
}

// --reader chatstore：切 A2-1 正式 ChatStore（chat.db reconcile 查询面），验 ChatStore vs legacy。
if args.reader == .chatstore {
    ChatStoreDump.run(args, keepAllLimit: keepAllLimit)
    exit(0)
}

switch args.command {
case .index:
    runIndex()

case .projects:
    switch args.sourceMode {
    case .cc:
        let (projects, _) = ccSource()!.getProjects()
        writeRecords(projects.map(DumpJSON.project))
    case .codex:
        writeRecords(codexSource()!.getProjects().map(DumpJSON.project))
    case .aggregate:
        let (cc, _) = ccSource()!.getProjects()
        let codex = codexSource()!.getProjects()
        writeRecords(Aggregate.projects(cc: cc, codex: codex).map(DumpJSON.project))
    }

case .sessionsProject(let hash):
    let limit = args.limit ?? keepAllLimit
    switch args.sourceMode {
    case .cc:
        let cc = ccSource()!
        let (_, wtMap) = cc.getProjects()
        writeRecords(cc.getSessionsForProject(hash, limit: limit, worktreeMap: wtMap).map(DumpJSON.summary))
    case .codex:
        writeRecords(codexSource()!.getSessionsForProject(hash, limit: limit).map(DumpJSON.summary))
    case .aggregate:
        let cc = ccSource()!
        let (_, wtMap) = cc.getProjects()
        let ccS = cc.getSessionsForProject(hash, limit: limit, worktreeMap: wtMap)
        let codexS = codexSource()!.getSessionsForProject(hash, limit: limit)
        writeRecords(Aggregate.sessions(cc: ccS, codex: codexS, limit: limit).map(DumpJSON.summary))
    }

case .sessionsAll:
    let limit = args.limit ?? keepAllLimit
    switch args.sourceMode {
    case .cc:
        writeRecords(ccSource()!.getAllRecentSessions(limit: limit).map(DumpJSON.summary))
    case .codex:
        writeRecords(codexSource()!.getAllRecentSessions(limit: limit).map(DumpJSON.summary))
    case .aggregate:
        let ccS = ccSource()!.getAllRecentSessions(limit: limit)
        let codexS = codexSource()!.getAllRecentSessions(limit: limit)
        writeRecords(Aggregate.sessions(cc: ccS, codex: codexS, limit: limit).map(DumpJSON.summary))
    }

case .session(let project, let session):
    let limit = args.limit  // nil = 全读（无 tail）
    switch args.sourceMode {
    case .cc:
        let cc = ccSource()!
        let (_, wtMap) = cc.getProjects()
        writeRecords(cc.readSession(projectHash: project, sessionId: session, limit: limit, worktreeMap: wtMap).map(DumpJSON.message))
    case .codex:
        writeRecords(codexSource()!.readSession(sessionId: session, limit: limit).map(DumpJSON.message))
    case .aggregate:
        let cc = ccSource()!
        let (_, wtMap) = cc.getProjects()
        let ccM = cc.readSession(projectHash: project, sessionId: session, limit: limit, worktreeMap: wtMap)
        let codexM = codexSource()!.readSession(sessionId: session, limit: limit)
        writeRecords(Aggregate.readSession(cc: ccM, codex: codexM).map(DumpJSON.message))
    }

case .search(let query):
    switch args.sourceMode {
    case .cc:
        writeRecords(ccSource()!.search(query).map(DumpJSON.searchResult))
    case .codex:
        writeRecords(codexSource()!.search(query).map(DumpJSON.searchResult))
    case .aggregate:
        let ccR = ccSource()!.search(query)
        let codexR = codexSource()!.search(query)
        writeRecords(Aggregate.search(cc: ccR, codex: codexR).map(DumpJSON.searchResult))
    }

case .mergeArchive:
    fatalError("unreachable：merge-archive 已在分发前拦截（runMergeArchive -> Never）")
}
