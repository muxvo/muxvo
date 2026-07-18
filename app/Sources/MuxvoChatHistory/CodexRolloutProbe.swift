// CodexRolloutProbe：Codex rollout 定向读（terminal-session-restore.md §1.5，P-2 fast-follow r3）。
//
// CodexAnchorTracker 的 listCandidates 注入闭包实现（装配层 SessionHub 接线）。**定向读、严禁全量扫**
// （M5 P0 594MB `findAllSessionFiles` 全量扫 12s 教训）：只列覆盖时间窗的日期目录（本地今天/昨天 + UTC
// 今天，跨午夜/时区安全）、mtime ≥ 窗起点的 `rollout-*.jsonl`、只读**首行** session_meta 取 {id,cwd}、
// 候选上限截断。fail-open：任一层失败静默跳过（同 CodexDirectory 目录发现）。
//
// codex 格式知识（CodexSessionMeta/CodexSessionId/CodexFile 均 internal）归本模块，故 probe 落此处；
// 结果类型 public 供 MuxvoAppCore 映射成 MuxvoTerm.RolloutCandidate（两模块无直接依赖，装配层桥接）。
import Foundation

/// rollout 候选命中（probe 产出；装配层映射 MuxvoTerm.RolloutCandidate）。
public struct CodexRolloutHit: Sendable, Equatable {
    public let sessionId: String
    public let cwd: String
    public let rolloutPath: String
    public let mtimeMs: Int64
    public init(sessionId: String, cwd: String, rolloutPath: String, mtimeMs: Int64) {
        self.sessionId = sessionId
        self.cwd = cwd
        self.rolloutPath = rolloutPath
        self.mtimeMs = mtimeMs
    }
}

public enum CodexRolloutProbe {
    /// 候选上限（防 rollout 风暴——同窗大量文件时按 mtime 降序取前 N）。
    public static let maxCandidates = 32
    /// 首行读硬上限（不可信数据防线，同 SessionTracker.maxRawBytes 口径）：session_meta 首行含完整
    /// system prompt（实测 ~17KB，随 codex 版本增长），留余量取 256KB；超此或无换行 → 视作损坏跳过。
    /// **只读前 maxFirstLineBytes 字节**（非整文件物化），JSON decode 至多触碰这段（M5 P0 大文件教训）。
    static let maxFirstLineBytes = 256 * 1024

    /// 定向读窗口内候选。
    /// - Parameters:
    ///   - sessionsDir: `~/.codex/sessions`（测试隔离传临时目录）。
    ///   - sinceMs / nowMs: 时间窗 [since, now]；只出 mtimeMs ≥ sinceMs 的 rollout（now 用于算日期目录）。
    public static func recentCandidates(sessionsDir: URL, sinceMs: Int64, nowMs: Int64) -> [CodexRolloutHit] {
        var hits: [CodexRolloutHit] = []
        for dateDir in dateDirs(nowMs: nowMs) {
            let dir = sessionsDir
                .appendingPathComponent(dateDir, isDirectory: true) // "YYYY/MM/DD" 相对
            guard let entries = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { continue }
            for entry in entries where entry.hasPrefix("rollout-") && entry.hasSuffix(".jsonl") {
                let file = dir.appendingPathComponent(entry, isDirectory: false)
                guard let st = PosixStat.of(file), st.mtimeMs >= sinceMs else { continue } // mtime 窗过滤
                guard let meta = readMetaFirstLine(file) else { continue } // 首行非 session_meta → 跳过（fail-open）
                let sid = meta.id.isEmpty
                    ? CodexSessionId.extract(fromFileName: entry) : meta.id
                guard !sid.isEmpty else { continue }
                hits.append(CodexRolloutHit(
                    sessionId: sid, cwd: meta.cwd, rolloutPath: file.path, mtimeMs: st.mtimeMs))
            }
        }
        // mtime 降序（最近活跃优先），截上限。
        hits.sort { $0.mtimeMs > $1.mtimeMs }
        return hits.count > maxCandidates ? Array(hits.prefix(maxCandidates)) : hits
    }

    /// 覆盖时间窗的日期目录（相对 "YYYY/MM/DD"）：本地今天/昨天 + UTC 今天（跨午夜/时区防御，去重）。
    /// 从 nowMs 派生（可测；不调 Date.now）。
    static func dateDirs(nowMs: Int64) -> [String] {
        let now = Date(timeIntervalSince1970: Double(nowMs) / 1000.0)
        var localCal = Calendar(identifier: .gregorian)
        localCal.timeZone = .current
        var utcCal = Calendar(identifier: .gregorian)
        utcCal.timeZone = TimeZone(identifier: "UTC") ?? .current
        var dirs: [String] = []
        var seen = Set<String>()
        func add(_ cal: Calendar, _ offset: Int) {
            guard let d = cal.date(byAdding: .day, value: offset, to: now) else { return }
            let c = cal.dateComponents([.year, .month, .day], from: d)
            guard let y = c.year, let m = c.month, let day = c.day else { return }
            let s = String(format: "%04d/%02d/%02d", y, m, day)
            if seen.insert(s).inserted { dirs.append(s) }
        }
        add(localCal, 0)   // 本地今天
        add(localCal, -1)  // 本地昨天
        add(utcCal, 0)     // UTC 今天（时区偏移防御）
        return dirs
    }

    /// 读 rollout 首行 session_meta（**只读前 maxFirstLineBytes 字节**，decode 至多触碰这段——防损坏/
    /// 无换行大行在 main 上整行物化 + parse）。首个 `\n` 前为首行；无换行（整段超上限）→ 视损坏跳过；
    /// 首行非 session_meta / 坏 JSON → nil（fail-open）。
    static func readMetaFirstLine(_ file: URL) -> CodexSessionMeta? {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? handle.close() }
        guard let head = try? handle.read(upToCount: maxFirstLineBytes), !head.isEmpty else { return nil }
        // 首个换行前 = 首行。无换行且已达上限 → 首行超限，视损坏跳过（不 parse 截断串）。
        let lineData: Data
        if let nl = head.firstIndex(of: 0x0A) {
            lineData = head[head.startIndex..<nl]
        } else if head.count < maxFirstLineBytes {
            lineData = head // 文件本身 < 上限且无换行（单行无尾换行）
        } else {
            return nil // 达上限仍无换行 → 首行超 maxFirstLineBytes，损坏跳过
        }
        guard let obj = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { return nil }
        return CodexSessionMeta.parse(obj)
    }
}
