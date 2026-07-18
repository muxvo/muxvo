// Codex 会话源读者（§5）：镜像 CC reader 的 API，输出同四类型，source=.codex。
// 行为权威 chat-data.md §5，对照 legacy codex-chat-source.ts（读行为不抄结构）。
//
// 分层纪律（纯函数 vs fs 薄壳）：
//  · CodexLineParser / CodexSessionMeta = 纯解析（吃已解码 [String:Any]，吐输出类型），可独立单测。
//  · CodexSessionSource = fs 薄壳（扫目录 / stat / 逐行读），把解码后的行喂纯解析层。
//  · projectHash 编码 / sessionId 提取 / snippet / 目录发现在 CodexPrimitives.swift（ChatModels-free）。
//
// per-source 差异（§5.3，与 CC 刻意不同，双跑按源各比各的，勿强求跨源一致）：
//  · title 兜底 sessionId（CC 空 title 丢弃）；startedAt = mtime 的 ISO（CC 用首条 timestamp）；
//  · search snippet 后 30（CC 后 170），只搜 user_message；
//  · uuid 带 `codex-` 前缀，但工具消息有 call_id 时 uuid = call_id（无前缀，§5.2 已知例外）。
//
// 已知 legacy 行为登记（双跑红线，勿"修正"）：Codex `_buildSummary` **不设 cwd**——故 Codex
// SessionSummary.cwd 恒 nil（省略），与 CC 设 cwd 不同。§9 resume 若需 Codex cwd 属下游（批3/4）
// 关注点，数据面批1 严格对齐 legacy 不外溢，偏差已在批末报告登记待裁决。
import Foundation

// MARK: - session_meta（首行元数据）

/// Codex 会话首行 `session_meta` 的 payload 投影（§5.2 readSessionMeta:55-85）。
struct CodexSessionMeta: Equatable {
    let id: String
    let cwd: String
    let timestamp: String

    /// 从已解码的一行 JSON 投影；非 session_meta / 无 payload → nil（legacy 67）。
    static func parse(_ obj: [String: Any]) -> CodexSessionMeta? {
        guard (obj["type"] as? String) == "session_meta",
              let payload = obj["payload"] as? [String: Any]
        else { return nil }
        let id = (payload["id"] as? String) ?? ""
        let cwd = (payload["cwd"] as? String) ?? ""
        // legacy 72：payload.timestamp || entry.timestamp || ''
        let timestamp = (payload["timestamp"] as? String) ?? (obj["timestamp"] as? String) ?? ""
        return CodexSessionMeta(id: id, cwd: cwd, timestamp: timestamp)
    }
}

// MARK: - 行 → SessionMessage（纯投影，parseCodexMessageLine:88-172）

enum CodexLineParser {
    /// 一行已解码 JSON → ChatSessionMessage（null 表跳过）。逐字对齐 legacy 四分支 + 跳过面。
    static func parseMessage(
        _ entry: [String: Any],
        sessionId: String,
        cwd: String,
        lineIndex: Int
    ) -> ChatSessionMessage? {
        let timestamp = (entry["timestamp"] as? String) ?? ""
        guard let type = entry["type"] as? String else { return nil }
        guard let payload = entry["payload"] as? [String: Any] else { return nil }  // legacy 97：!payload → null
        let payloadType = payload["type"] as? String

        // 1. event_msg + user_message（空 message → null，102-113）
        if type == "event_msg" && payloadType == "user_message" {
            let message = (payload["message"] as? String) ?? ""
            if message.isEmpty { return nil }
            return ChatSessionMessage(
                uuid: "codex-\(sessionId)-user-\(lineIndex)",
                type: .user, sessionId: sessionId, cwd: cwd, timestamp: timestamp,
                content: .text(message)
            )
        }

        // 2. event_msg + agent_message（空 message → null，116-127）
        if type == "event_msg" && payloadType == "agent_message" {
            let message = (payload["message"] as? String) ?? ""
            if message.isEmpty { return nil }
            return ChatSessionMessage(
                uuid: "codex-\(sessionId)-agent-\(lineIndex)",
                type: .assistant, sessionId: sessionId, cwd: cwd, timestamp: timestamp,
                content: .text(message)
            )
        }

        // 3. response_item + function_call / custom_tool_call（129-145）
        if type == "response_item"
            && (payloadType == "function_call" || payloadType == "custom_tool_call")
        {
            // name = payload.name || payloadType（legacy `||`：空串亦兜底 payloadType）
            let rawName = payload["name"] as? String
            let name = (rawName?.isEmpty == false) ? rawName! : (payloadType ?? "")
            // input = function_call ? payload.arguments : payload.input（缺键 → 省略；存在即保真 JSON）
            let inputKey = payloadType == "function_call" ? "arguments" : "input"
            let input = payload[inputKey].map { JSONValue(any: $0) }
            // uuid：call_id 优先（**无 codex- 前缀**，§5.2 已知例外）；缺 or 空串则 codex-{sid}-tool-{i}
            // （legacy 138 `payload.call_id || ...` 真值语义，空串亦兜底——与上方 name 的真值语义一致）
            let uuid = nonEmpty(payload["call_id"] as? String) ?? "codex-\(sessionId)-tool-\(lineIndex)"
            return ChatSessionMessage(
                uuid: uuid, type: .assistant, sessionId: sessionId, cwd: cwd, timestamp: timestamp,
                content: .blocks([ChatContentBlock(type: "tool_use", name: name, input: input)])
            )
        }

        // 4. response_item + function_call_output / custom_tool_call_output（147-168）
        if type == "response_item"
            && (payloadType == "function_call_output" || payloadType == "custom_tool_call_output")
        {
            // output：legacy 153 `(payload.output as string) || ''`——`as string` 是 TS 编译期 cast，
            // 运行期不改值；`|| ''` 只对 falsy 兜底。故数组/对象/非零数（JS 恒 truthy）**原样保真**，
            // falsy（缺键/null/空串/0/false）→ ""。旧实现 `as? String ?? ""` 把数组/对象型 output 静默丢
            // 成空串（真实数据 36 条命中 → 双跑 §8.3 RED + 产品数据丢失），此处按真值语义保真。
            let rawOutput = payload["output"]
            let output: JSONValue = jsTruthy(rawOutput) ? JSONValue(any: rawOutput) : .string("")
            let callId = payload["call_id"] as? String          // 缺则省略 tool_use_id（legacy 164 无 ||，空串亦保留）
            return ChatSessionMessage(
                uuid: "codex-\(sessionId)-result-\(lineIndex)",
                type: .assistant, sessionId: sessionId, cwd: cwd, timestamp: timestamp,
                content: .blocks([
                    ChatContentBlock(type: "tool_result", content: output, toolUseId: callId)
                ])
            )
        }

        // 跳过：session_meta / turn_context / token_count / reasoning / agent_reasoning 等（170-171）
        return nil
    }
}

// MARK: - fs 薄壳读者

/// Codex 会话源读者。`codexBasePath` = `~/.codex`（含 `sessions/` 与 `.codex-global-state.json`）。
/// 本 struct 恒无缓存（批1 纯层：双跑 harness 要求每会话重提取，§2.4 注）；prime 路径的
/// per-file 增量缓存在 memo 侧（CodexIndexCache，P0 风暴修复批3），不落 reader。
public struct CodexSessionSource: Sendable {
    public let codexBasePath: URL

    public init(codexBasePath: URL) { self.codexBasePath = codexBasePath }

    /// internal：MemoizingCodexSource 的 prime 增量缓存（CodexIndexCache）做目录发现用。
    var sessionsDir: URL { codexBasePath.appendingPathComponent("sessions", isDirectory: true) }
    private var globalStatePath: URL {
        codexBasePath.appendingPathComponent(".codex-global-state.json", isDirectory: false)
    }

    /// 索引条目（对齐 legacy SessionIndexEntry:26-33）。mtime 为原始毫秒浮点（lastModified 用；
    /// startedAt 另按 §5.3 truncate 后 ISO）。
    struct IndexEntry {
        let filePath: URL
        let sessionId: String
        let mtime: Double
        let size: Int
        let cwd: String
        let title: String
    }

    // MARK: 索引 / 全局标题

    /// 扫全部会话文件，读 session_meta 取 cwd/id，拼 thread-title（buildIndex:248-281）。
    func buildIndex() -> [IndexEntry] {
        let files = CodexDirectory.findAllSessionFiles(sessionsDir: sessionsDir)
        let titles = getThreadTitles()
        var entries: [IndexEntry] = []
        for file in files {
            // PosixStat（st_mtimespec 整数毫秒）：FileManager Date 的 Double 秒往返在 ms 边界丢尾数，
            // 与 Node stat.mtimeMs 差 ±1ms（startedAt=mtime→ISO 是双跑逐 ms 对齐红线，§5.2/§8.2）。
            guard let st = PosixStat.of(file) else { continue }
            let size = st.size
            let mtime = Double(st.mtimeMs)
            let filenameSid = CodexSessionId.extract(fromFileName: file.lastPathComponent)
            let meta = readSessionMeta(file)
            let cwd = meta?.cwd ?? ""
            // title 查表用 filenameSid → meta.id（legacy 261-264，查表在 id 覆盖之前）
            let title = nonEmpty(titles[filenameSid]) ?? nonEmpty(titles[meta?.id ?? ""]) ?? ""
            // 存储 sessionId = meta.id || filenameSid（id 权威，legacy 268）
            let storedSid = nonEmpty(meta?.id) ?? filenameSid
            entries.append(IndexEntry(
                filePath: file, sessionId: storedSid, mtime: mtime, size: size, cwd: cwd, title: title
            ))
        }
        return entries
    }

    /// `.codex-global-state.json` 的 `thread-titles.titles`（getThreadTitles:190-201）。缺失 → 空。
    func getThreadTitles() -> [String: String] {
        guard let data = try? Data(contentsOf: globalStatePath),
              let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tt = state["thread-titles"] as? [String: Any],
              let titles = tt["titles"] as? [String: Any]
        else { return [:] }
        // 仅收字符串值（非字符串标题忽略）。
        return titles.compactMapValues { $0 as? String }
    }

    /// 读首个非空行；仅当它是 session_meta 才返回 meta（legacy readSessionMeta 只看第一非空行）。
    func readSessionMeta(_ file: URL) -> CodexSessionMeta? {
        var result: CodexSessionMeta?
        CodexFile.forEachLine(url: file) { line in
            if let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] {
                result = CodexSessionMeta.parse(obj)
            }
            return false  // 只看首个非空行即停（对齐 legacy 无条件 break）
        }
        return result
    }

    /// 首条 user_message 文本截前 100 UTF-16 码元（_extractFirstUserMessage:458-483）。无则空串。
    func extractFirstUserMessage(_ file: URL) -> String {
        var result = ""
        CodexFile.forEachLine(url: file) { line in
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
            else { return true }  // 坏行跳过、继续扫（legacy catch→continue）
            if (obj["type"] as? String) == "event_msg",
               let payload = obj["payload"] as? [String: Any],
               (payload["type"] as? String) == "user_message"
            {
                result = utf16Prefix((payload["message"] as? String) ?? "", 100)
                return false
            }
            return true
        }
        return result
    }

    // MARK: 输出面（四类型）

    /// 项目列表（getProjects:284-326）：按 cwd 分组，count/totalSize 累加、lastActivity 取 max，
    /// lastActivity 降序。displayName = displayPath 末段（`/` 切去空），空 cwd → 'Unknown'。
    public func getProjects() -> [ChatProjectInfo] {
        getProjects(from: buildIndex())
    }

    /// 从预建 index 派生（prime 单遍化共享同一份 index 用；与公开签名逐行同构，行为恒等）。
    func getProjects(from entries: [IndexEntry]) -> [ChatProjectInfo] {
        struct Group { var cwd: String; var count: Int; var totalSize: Int; var lastActivity: Double }
        var order: [String] = []
        var map: [String: Group] = [:]
        for e in entries {
            let key = e.cwd.isEmpty ? "unknown" : e.cwd
            if var g = map[key] {
                g.count += 1
                g.totalSize += e.size
                g.lastActivity = max(g.lastActivity, e.mtime)
                map[key] = g
            } else {
                map[key] = Group(cwd: e.cwd, count: 1, totalSize: e.size, lastActivity: e.mtime)
                order.append(key)
            }
        }
        var projects: [ChatProjectInfo] = []
        for key in order {
            let g = map[key]!
            let displayPath = g.cwd.isEmpty ? "Unknown" : g.cwd
            let displayName = displayPath.split(separator: "/").last.map(String.init) ?? "Unknown"
            projects.append(ChatProjectInfo(
                projectHash: CodexProjectHash.encode(g.cwd),
                displayPath: displayPath,
                displayName: displayName,
                sessionCount: g.count,
                totalSize: g.totalSize,
                lastActivity: g.lastActivity,
                source: .codex
            ))
        }
        return projects.sorted { $0.lastActivity > $1.lastActivity }
    }

    /// 单项目会话（getSessionsForProject:348-361）：encode(cwd)==projectHash，mtime 降序 slice limit。
    public func getSessionsForProject(_ projectHash: String, limit: Int = 50) -> [ChatSessionSummary] {
        let titles = getThreadTitles()
        let entries = buildIndex()
        return getSessionsForProject(
            projectHash, limit: limit, from: entries, titles: titles,
            firstUserMessage: { extractFirstUserMessage($0) })
    }

    /// 从预建 index 派生（prime 单遍化用；与公开签名逐行同构）。firstUserMessage 参数化 =
    /// memo 侧可换 per-file memo 版（正确性同 extractFirstUserMessage，只省重复 I/O）。
    func getSessionsForProject(
        _ projectHash: String, limit: Int, from entries: [IndexEntry],
        titles: [String: String], firstUserMessage: (URL) -> String
    ) -> [ChatSessionSummary] {
        let matching = entries
            .filter { CodexProjectHash.encode($0.cwd) == projectHash }
            .sorted { $0.mtime > $1.mtime }
            .prefix(limit)
        return matching.map { buildSummary($0, titles: titles, firstUserMessage: firstUserMessage) }
    }

    /// 全局最近会话（getAllRecentSessions:363-369）：mtime 降序 slice limit。
    public func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] {
        let titles = getThreadTitles()
        let entries = buildIndex()
        return getAllRecentSessions(
            limit: limit, from: entries, titles: titles,
            firstUserMessage: { extractFirstUserMessage($0) })
    }

    /// 从预建 index 派生（prime 单遍化用；与公开签名逐行同构）。
    func getAllRecentSessions(
        limit: Int, from entries: [IndexEntry], titles: [String: String],
        firstUserMessage: (URL) -> String
    ) -> [ChatSessionSummary] {
        let sorted = entries.sorted { $0.mtime > $1.mtime }.prefix(limit)
        return sorted.map { buildSummary($0, titles: titles, firstUserMessage: firstUserMessage) }
    }

    /// 单会话详情（readSession:371-405）：按 sessionId 命中 → 逐行投影。命中走 `buildIndex().first(where:)`
    /// （全量扫，冷路径）；投影体抽到 `readSession(entry:limit:)` 供 memo 缓存命中后单文件直读复用（行为恒等）。
    public func readSession(sessionId: String, limit: Int? = nil) -> [ChatSessionMessage] {
        guard let entry = buildIndex().first(where: { $0.sessionId == sessionId }) else { return [] }
        return readSession(entry: entry, limit: limit)
    }

    /// 单会话逐行投影（从已知 IndexEntry 出发，**不再 buildIndex**——供 `MemoizingCodexSource` 缓存命中后
    /// 单文件直读，避开全量扫〔真机 ~/.codex 594MB → buildIndex 12s+，是缺陷2 根因〕；与上面 sessionId 版
    /// 行为恒等）。lineIndex 每非空行 +1（含坏行/被跳过行，与 legacy 一致，保 uuid 序号确定）。limit>0 取尾 limit。
    func readSession(entry: IndexEntry, limit: Int?) -> [ChatSessionMessage] {
        var messages: [ChatSessionMessage] = []
        var lineIndex = 0
        CodexFile.forEachLine(url: entry.filePath) { line in
            if let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
               let msg = CodexLineParser.parseMessage(
                   obj, sessionId: entry.sessionId, cwd: entry.cwd, lineIndex: lineIndex)
            {
                messages.append(msg)
            }
            lineIndex += 1
            return true
        }
        if let limit, limit > 0 { return Array(messages.suffix(limit)) }
        return messages
    }

    /// 搜索（search:407-455）：每 session 首条 user_message 命中即停，snippet 后 30，结果 ≥50 截断。
    public func search(_ query: String) -> [ChatSearchResult] {
        var results: [ChatSearchResult] = []
        for entry in buildIndex() {
            var hit: ChatSearchResult?
            CodexFile.forEachLine(url: entry.filePath) { line in
                guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                      (obj["type"] as? String) == "event_msg",
                      let payload = obj["payload"] as? [String: Any],
                      (payload["type"] as? String) == "user_message"
                else { return true }
                let message = (payload["message"] as? String) ?? ""
                guard let snippet = CodexSnippet.make(message: message, query: query) else { return true }
                hit = ChatSearchResult(
                    projectHash: CodexProjectHash.encode(entry.cwd),
                    sessionId: entry.sessionId,
                    snippet: snippet,
                    timestamp: (obj["timestamp"] as? String) ?? ""
                )
                return false  // 一文件最多一条
            }
            if let hit { results.append(hit) }
            if results.count >= 50 { break }
        }
        return results
    }

    // MARK: 私有：summary 组装（_buildSummary:329-346）

    private func buildSummary(
        _ entry: IndexEntry, titles: [String: String], firstUserMessage: (URL) -> String
    ) -> ChatSessionSummary {
        // title = entry.title || titles[entry.sessionId] || firstUserMessage || entry.sessionId
        var title = nonEmpty(entry.title) ?? nonEmpty(titles[entry.sessionId]) ?? ""
        if title.isEmpty { title = firstUserMessage(entry.filePath) }
        let finalTitle = nonEmpty(title) ?? entry.sessionId  // Codex title 永不空（§5.3）
        return ChatSessionSummary(
            sessionId: entry.sessionId,
            projectHash: CodexProjectHash.encode(entry.cwd),
            title: finalTitle,
            startedAt: CodexTime.isoString(fromMillis: entry.mtime),  // §5.3：mtime 的 ISO（非首条 ts）
            lastModified: entry.mtime,
            fileSize: entry.size,
            // cwd 刻意不设（legacy Codex _buildSummary 不含 cwd，双跑红线，见文件头登记）
            source: .codex
        )
    }
}

// MARK: - 工具

/// mtime 毫秒 → JS `new Date(ms).toISOString()` 同格式（`YYYY-MM-DDTHH:MM:SS.mmmZ`，UTC，3 位毫秒）。
enum CodexTime {
    static func isoString(fromMillis ms: Double) -> String {
        let msInt = Int64(ms.rounded(.towardZero))  // JS new Date(x) = ToInteger（向零截断）
        let seconds = Int64((Double(msInt) / 1000).rounded(.down))
        let millis = Int(msInt - seconds * 1000)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: Date(timeIntervalSince1970: TimeInterval(seconds)))
        return String(
            format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
            c.year!, c.month!, c.day!, c.hour!, c.minute!, c.second!, millis)
    }
}

/// 逐行读文件：去空行、trim 首尾空白；body 返回 false 即停（支持 meta/搜索早停）。
/// P0 风暴修复（批4）：字节级按 0x0A 切行（= legacy Node split('\n') 码元语义；修前整 String
/// grapheme 急切 split 是采样 CPU 主体，且 readSessionMeta 只要首行也付 40MB 全文件物化代价）
/// + 逐行 UTF-8 解码（0x0A 不出现在多字节序列内部，坏字节 U+FFFD 归一与整串解码等价）+ 真早停。
/// `.mappedIfSafe`：40MB 级 rollout 不整读进内存，早停路径只触碰头部页；rollout 为追加型写，
/// 已映射区间不缩短（缩短改写理论 SIGBUS，真实写型无此路径——批末报告登记）。
/// 行语义钉子见 CodexFileLineTests（CRLF/尾换行/空行/trim/早停/非 UTF-8/孤立 \r）。
enum CodexFile {
    static func forEachLine(url: URL, _ body: (String) -> Bool) {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return }
        var start = data.startIndex
        while start < data.endIndex {
            let nl = data[start...].firstIndex(of: 0x0A) ?? data.endIndex
            let line = String(decoding: data[start..<nl], as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            start = nl == data.endIndex ? data.endIndex : data.index(after: nl)
            if line.isEmpty { continue }
            if !body(line) { return }
        }
    }
}

/// JS `x || fallback` 的字符串真值语义：空串/nil 视为假。
private func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}

/// JS `x || fallback` 的通用真值语义（Any? 版，供 tool_result output 保真用）：
/// nil / NSNull / 空串 / 0 / false / NaN 为假；非空串 / 非零数 / true / 数组 / 对象为真。
/// NSNumber 的 bool 经 CFBoolean 类型辨识与数值分开（与 JSONValue.from 同惯例）。
private func jsTruthy(_ v: Any?) -> Bool {
    switch v {
    case nil, is NSNull:
        return false
    case let s as String:
        return !s.isEmpty
    case let n as NSNumber:
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue }
        let d = n.doubleValue
        return d != 0 && !d.isNaN
    default:
        return true  // 数组 / 对象等容器恒 truthy
    }
}

/// UTF-16 码元前 N（对齐 JS slice(0,N)）；边界切断代理对由 U+FFFD 归一（§8.2 规则3）。
private func utf16Prefix(_ s: String, _ n: Int) -> String {
    let units = Array(s.utf16)
    if units.count <= n { return s }
    return String(decoding: units.prefix(n), as: UTF16.self)
}
