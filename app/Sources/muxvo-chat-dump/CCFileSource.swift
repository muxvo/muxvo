// CC 会话源 fs 薄壳（临时实现，批2 A2-3）——逐字复刻 legacy chat-dual-source.ts 的
// 文件级编排（scan/collect/read/search），逐行/逐字段语义全走 MuxvoChatHistory 已冻结的纯函数
// （ChatProjectMerger / SessionSummaryExtractor / ChatMessageProjector / SearchPredicate）。
//
// 定位：让双跑 harness 端到端可跑。批末换正式 ChatStore（A2-1）——两者驱动同一批纯函数，
// 故本壳与 legacy 对齐 = ChatStore 与 legacy 对齐的等价见证。
//
// 目录约定见 DumpArgs.swift 头注释：ccBase 直接含 <hash>/ 子目录；mirror（archivePath）同构扁平。
//
// 缓存：无（legacy 5 分钟 projectsCache/summaryCache 在新进程天然为空；本壳彻底不缓存，
// 每次全新扫，保 fileSize/mtime 与当次 stat 一致，§2.3 双跑须禁缓存）。

import Foundation
import MuxvoChatHistory
import MuxvoTranscript

struct CCFileSource {
    let ccBase: URL
    /// 镜像/归档扁平根（legacy archiveProjectsDir）；nil = 未挂镜像。
    let archiveBase: URL?

    private static let worktreeMarker = "--worktrees-"

    // MARK: - 文件条目（legacy FileEntry）

    struct FileEntry {
        let projectHash: String
        let fileName: String
        let filePath: URL
        let mtime: Double
        var archiveOnly: Bool = false
        var worktreeLabel: String? = nil
    }

    // MARK: - 目录扫描原语

    /// 列子目录名（非目录忽略）。
    private func subdirNames(_ base: URL) -> [String] {
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: base, includingPropertiesForKeys: [.isDirectoryKey], options: [])
        else { return [] }
        return items.compactMap { url -> String? in
            (PosixStat.of(url)?.isDirectory == true) ? url.lastPathComponent : nil
        }
    }

    /// 列目录内 .jsonl 文件名。
    private func jsonlNames(_ dir: URL) -> [String] {
        guard let items = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        return items.filter { $0.hasSuffix(".jsonl") }
    }

    /// 扫会话文件 stat（legacy scanSessionFilesFromDir）→ (fileName, mtimeMs)。
    private func scanSessionFiles(_ dir: URL) -> [(fileName: String, mtime: Double)] {
        jsonlNames(dir).compactMap { name in
            guard let st = PosixStat.of(dir.appendingPathComponent(name)) else { return nil }
            return (name, Double(st.mtimeMs))
        }
    }

    // MARK: - §1 项目扫描

    /// legacy scanProjectsFromDir(324-386) → [ChatProjectInfo]。
    private func scanProjects(_ base: URL) -> [ChatProjectInfo] {
        subdirNames(base).compactMap { hash -> ChatProjectInfo? in
            let projectPath = base.appendingPathComponent(hash, isDirectory: true)
            guard let dirStat = PosixStat.of(projectPath) else { return nil }
            let jsonl = jsonlNames(projectPath)
            guard !jsonl.isEmpty else { return nil }
            let totalSize = jsonl.reduce(0) { sum, f in
                sum + (PosixStat.of(projectPath.appendingPathComponent(f))?.size ?? 0)
            }
            let displayPath = firstCwd(projectPath.appendingPathComponent(jsonl[0]))
            return ChatProjectMerger.buildProjectInfo(
                projectHash: hash,
                displayPath: displayPath,
                jsonlCount: jsonl.count,
                totalSize: totalSize,
                lastActivityMs: Double(dirStat.mtimeMs),
                source: .claudeCode)
        }
    }

    /// 首个 session 前 10 行首个非空 cwd（legacy 348-359）；读不到 ""。
    private func firstCwd(_ file: URL) -> String {
        var decoder = SessionJSONLDecoder()
        var result = ""
        for line in FileLineReader.firstLines(url: file, maxLines: 10) {
            if let r = decoder.record(from: line), let c = r.cwd, !c.isEmpty {
                result = c
                break
            }
        }
        return result
    }

    /// legacy getProjects(474-531)：CC + archive 合并（§1.4）+ worktree 归并（§1.2）。
    func getProjects() -> (projects: [ChatProjectInfo], worktreeMap: [String: [String]]) {
        let cc = scanProjects(ccBase)
        let archive = archiveBase.map { scanProjects($0) } ?? []
        let merged = ChatProjectMerger.merge(cc: cc, archive: archive)
        return (merged.projects, merged.worktreeMap)
    }

    // MARK: - §2 会话摘要

    /// 单文件 → SessionSummary（legacy extractSessionSummary + 空 title 过滤）。
    private func extractSummary(projectHash: String, filePath: URL, fileName: String) -> ChatSessionSummary? {
        guard let st = PosixStat.of(filePath) else { return nil }
        let sessionId = String(fileName.dropLast(".jsonl".count))
        var decoder = SessionJSONLDecoder()
        let records: [any ChatRecordReading] = FileLineReader
            .firstLines(url: filePath, maxLines: 20)
            .compactMap { decoder.record(from: $0) }
        return SessionSummaryExtractor.extract(
            records: records,
            projectHash: projectHash,
            sessionId: sessionId,
            fileSize: st.size,
            lastModifiedMs: Double(st.mtimeMs),
            source: .claudeCode)
    }

    /// legacy collectAndExtractSessions(402-442)：CC 优先去重 → mtime 降序 slice → 提取 → 空 title 过滤。
    private func collectAndExtract(cc: [FileEntry], archive: [FileEntry], limit: Int) -> [ChatSessionSummary] {
        let ccKeys = Set(cc.map { $0.projectHash + "/" + $0.fileName })
        var merged = cc
        for af in archive where !ccKeys.contains(af.projectHash + "/" + af.fileName) {
            var e = af
            e.archiveOnly = true
            merged.append(e)
        }
        merged.sort { $0.mtime > $1.mtime }
        let top = merged.prefix(limit)
        return top.compactMap { file in
            guard var summary = extractSummary(
                projectHash: file.projectHash, filePath: file.filePath, fileName: file.fileName)
            else { return nil }
            if file.archiveOnly { summary.archiveOnly = true }
            if let label = file.worktreeLabel { summary.worktreeLabel = label }
            return summary
        }
    }

    /// legacy getSessionsForProject(538-582)。worktreeMap 来自 getProjects()。
    func getSessionsForProject(_ projectHash: String, limit: Int, worktreeMap: [String: [String]]) -> [ChatSessionSummary] {
        let ccProjectPath = ccBase.appendingPathComponent(projectHash, isDirectory: true)
        var ccFiles = scanSessionFiles(ccProjectPath).map {
            FileEntry(
                projectHash: projectHash, fileName: $0.fileName,
                filePath: ccProjectPath.appendingPathComponent($0.fileName), mtime: $0.mtime)
        }
        // worktree 目录会话（§1.3）。
        for wtHash in worktreeMap[projectHash] ?? [] {
            let wtName = ChatProjectMerger.worktreeLabel(fromHash: wtHash)
            let wtPath = ccBase.appendingPathComponent(wtHash, isDirectory: true)
            for s in scanSessionFiles(wtPath) {
                ccFiles.append(FileEntry(
                    projectHash: projectHash, fileName: s.fileName,
                    filePath: wtPath.appendingPathComponent(s.fileName), mtime: s.mtime,
                    worktreeLabel: wtName))
            }
        }
        var archiveFiles: [FileEntry] = []
        if let archiveBase {
            let archiveProjectPath = archiveBase.appendingPathComponent(projectHash, isDirectory: true)
            archiveFiles = scanSessionFiles(archiveProjectPath).map {
                FileEntry(
                    projectHash: projectHash, fileName: $0.fileName,
                    filePath: archiveProjectPath.appendingPathComponent($0.fileName), mtime: $0.mtime)
            }
        }
        return collectAndExtract(cc: ccFiles, archive: archiveFiles, limit: limit)
    }

    /// legacy getAllRecentSessions(589-639)：各目录 parentHash remap + label，collect。
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] {
        func collectFromBase(_ base: URL) -> [FileEntry] {
            var out: [FileEntry] = []
            for dirName in subdirNames(base) {
                let projectPath = base.appendingPathComponent(dirName, isDirectory: true)
                let parentHash = ChatProjectMerger.parentProjectHash(dirName)
                let wtLabel = parentHash != nil ? ChatProjectMerger.worktreeLabel(fromHash: dirName) : nil
                for s in scanSessionFiles(projectPath) {
                    out.append(FileEntry(
                        projectHash: parentHash ?? dirName, fileName: s.fileName,
                        filePath: projectPath.appendingPathComponent(s.fileName), mtime: s.mtime,
                        worktreeLabel: wtLabel))
                }
            }
            return out
        }
        let ccFiles = collectFromBase(ccBase)
        let archiveFiles = archiveBase.map { collectFromBase($0) } ?? []
        return collectAndExtract(cc: ccFiles, archive: archiveFiles, limit: limit)
    }

    // MARK: - §3 详情投影

    /// legacy readSession(646-723)：CC → worktree fallback → archive fallback；>2MB+limit tail 读。
    func readSession(projectHash: String, sessionId: String, limit: Int?, worktreeMap: [String: [String]]) -> [ChatSessionMessage] {
        let ccFilePath = ccBase.appendingPathComponent(projectHash, isDirectory: true)
            .appendingPathComponent("\(sessionId).jsonl")
        var filePath = ccFilePath
        var stat = PosixStat.of(ccFilePath)
        if stat == nil {
            for wtHash in worktreeMap[projectHash] ?? [] {
                let wtFile = ccBase.appendingPathComponent(wtHash, isDirectory: true)
                    .appendingPathComponent("\(sessionId).jsonl")
                if let s = PosixStat.of(wtFile) {
                    filePath = wtFile
                    stat = s
                    break
                }
            }
        }
        if stat == nil {
            if let archiveBase {
                let archiveFile = archiveBase.appendingPathComponent(projectHash, isDirectory: true)
                    .appendingPathComponent("\(sessionId).jsonl")
                if let s = PosixStat.of(archiveFile) {
                    filePath = archiveFile
                    stat = s
                } else {
                    return []
                }
            } else {
                return []
            }
        }
        guard let st = stat else { return [] }

        let tailBytes = 2 * 1024 * 1024
        let readFromTail = (limit != nil) && st.size > tailBytes
        let startPos: UInt64 = readFromTail ? UInt64(st.size - tailBytes) : 0

        var messages: [ChatSessionMessage] = []
        var skipFirst = readFromTail
        var decoder = SessionJSONLDecoder()
        FileLineReader.forEachLine(url: filePath, start: startPos) { line in
            if skipFirst { skipFirst = false; return true }
            let record = decoder.record(from: line)
            messages.append(contentsOf: ChatMessageProjector.project(
                record: record, fallbackSessionId: sessionId))
            return true
        }
        if let limit, messages.count > limit {
            return Array(messages.suffix(limit))
        }
        return messages
    }

    // MARK: - §4 搜索

    /// legacy search(729-828)：CC 先、archive 后；(projectHash, sessionId) 去重（CC 占位优先）；
    /// 一文件首命中即停。结果顺序无关（归一层按 (projectHash, sessionId) 排序）。
    func search(_ query: String) -> [ChatSearchResult] {
        var results: [ChatSearchResult] = []
        var seen = Set<String>()

        func searchInDir(_ base: URL) {
            for dirName in subdirNames(base) {
                let projectHash = ChatProjectMerger.parentProjectHash(dirName) ?? dirName
                let projectPath = base.appendingPathComponent(dirName, isDirectory: true)
                for f in jsonlNames(projectPath) {
                    let sessionId = String(f.dropLast(".jsonl".count))
                    let key = projectHash + "/" + sessionId
                    if seen.contains(key) { continue }
                    seen.insert(key)
                    if let hit = searchFile(
                        projectPath.appendingPathComponent(f),
                        projectHash: projectHash, sessionId: sessionId, query: query)
                    {
                        results.append(hit)
                    }
                }
            }
        }

        searchInDir(ccBase)
        if let archiveBase { searchInDir(archiveBase) }
        return results
    }

    /// 单文件流式搜索，首命中即停（legacy searchFile 752-778）。
    private func searchFile(_ file: URL, projectHash: String, sessionId: String, query: String) -> ChatSearchResult? {
        var decoder = SessionJSONLDecoder()
        var hit: ChatSearchResult?
        FileLineReader.forEachLine(url: file) { line in
            guard let r = decoder.record(from: line), SearchPredicate.isSearchableType(r) else {
                return true
            }
            let text = SearchPredicate.extractSearchableText(r)
            if let match = SearchPredicate.firstMatch(text: text, query: query) {
                hit = ChatSearchResult(
                    projectHash: projectHash, sessionId: sessionId,
                    snippet: match.snippet, timestamp: r.timestamp ?? "")
                return false
            }
            return true
        }
        return hit
    }
}
