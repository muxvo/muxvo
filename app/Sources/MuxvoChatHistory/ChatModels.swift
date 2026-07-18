// M5 聊天数据面——四输出类型（specs/behavior/chat-data.md §8.1 legacy 字段名逐字）。
//
// 定位：`MuxvoChatHistory` CC/Codex 纯函数层的输出契约。字段名/类型对齐 legacy
// `src/shared/types/chat.types.ts`（ProjectInfo / SessionSummary / SessionMessage /
// SearchResult），是批2 双跑 harness 逐字段 diff 的红线（§8）。A1-3（Codex 源）也消费这些类型。
//
// 批1 只需 Sendable/Equatable（CD_* 断言走值相等）；dump/桥序列化（Codable/JSON）归批2/批3，
// 内容块任意 JSON 字段以 JSONValue（= MuxvoTranscript.JSONValue，见 JSONValueSupport.swift）保真。
//
// 归一化口径（§8.2，批2 序列化层实现）：可选键 nil 省略、source 必填、mtime floor 到整数毫秒。

import Foundation
import MuxvoTranscript

// MARK: - 数据来源（§0：M5 收敛为 CC + Codex 双源，砍 Gemini）

/// 聊天数据来源工具。M5 只出 `claude-code` / `codex`——`gemini` 永不出现在 live 或双跑输出（§0）。
public enum ChatSource: String, Sendable, Equatable {
    case claudeCode = "claude-code"
    case codex
}

// MARK: - ProjectInfo（§8.1）

/// 从 `~/.claude/projects/`（或镜像根）扫描得到的项目信息（§1）。
/// 字段为 var：Merger（§1.2/§1.4）在归并期原地累加/重写（对齐 legacy getProjects 就地 mutate）。
public struct ChatProjectInfo: Sendable, Equatable {
    public var projectHash: String
    public var displayPath: String
    public var displayName: String
    public var sessionCount: Int
    /// 该项目所有 .jsonl 总字节；nil 时序列化省略（§8.2 规则4）。
    public var totalSize: Int?
    /// 最近活跃时间 = 目录 mtime 毫秒（§1.1：取目录 mtime，不逐文件求最新）。
    public var lastActivity: Double
    public var source: ChatSource

    public init(
        projectHash: String,
        displayPath: String,
        displayName: String,
        sessionCount: Int,
        totalSize: Int?,
        lastActivity: Double,
        source: ChatSource
    ) {
        self.projectHash = projectHash
        self.displayPath = displayPath
        self.displayName = displayName
        self.sessionCount = sessionCount
        self.totalSize = totalSize
        self.lastActivity = lastActivity
        self.source = source
    }
}

// MARK: - SessionSummary（§8.1）

/// 单会话摘要（从 .jsonl 头部提取，§2）。
/// 注：`customTitle` 由上层（终端命名）注入，reader 从不写它（§8.1 注）——批1 不含该字段。
public struct ChatSessionSummary: Sendable, Equatable {
    public var sessionId: String
    public var projectHash: String
    public var title: String
    /// ISO 时间戳字符串（§2.3：前 20 行首条 user 记录的 timestamp）。
    public var startedAt: String
    /// 文件 mtime 毫秒（§2.3：始终反映当次扫描 mtime）。
    public var lastModified: Double
    /// 文件字节数（§2.3：stat.size）。
    public var fileSize: Int
    /// 会话级工作目录；nil 时省略（§8.2 规则4）。
    public var cwd: String?
    /// worktree 来源标签（`--worktrees-` 之后整段，如 `wt-1`）；nil 时省略。
    public var worktreeLabel: String?
    /// true = 仅存在于 archive（CC 已删原文件，仅归档——native 可经 ChatRestore 回填后照常 resume，
    /// M5-R1 批2 语义修订，chat-history.md §7.7）；nil 时省略。
    public var archiveOnly: Bool?
    public var source: ChatSource

    public init(
        sessionId: String,
        projectHash: String,
        title: String,
        startedAt: String,
        lastModified: Double,
        fileSize: Int,
        cwd: String? = nil,
        worktreeLabel: String? = nil,
        archiveOnly: Bool? = nil,
        source: ChatSource
    ) {
        self.sessionId = sessionId
        self.projectHash = projectHash
        self.title = title
        self.startedAt = startedAt
        self.lastModified = lastModified
        self.fileSize = fileSize
        self.cwd = cwd
        self.worktreeLabel = worktreeLabel
        self.archiveOnly = archiveOnly
        self.source = source
    }
}

// MARK: - SessionMessage（§8.1）

/// 消息类型（投影后：queue-operation 已归入 user/system）。
public enum ChatMessageType: String, Sendable, Equatable {
    case user
    case assistant
    case system
}

/// 消息内容：`string ∣ AssistantContentBlock[]`（legacy `content: string | Block[]`）。
public enum ChatMessageContent: Sendable, Equatable {
    case text(String)
    case blocks([ChatContentBlock])
}

/// 内容块（user/assistant 共用）。§8.1 列 7 个 typed 字段
/// `type,text?,name?,input?,content?,tool_use_id?,source?`，但 legacy parseMessageLine 对 assistant
/// **透传原始块**——实测真实块含 §8.1 外字段：thinking.{signature,thinking}、tool_use.{id,caller}、
/// tool_result.is_error。为过 §8「逐字段 diff」红线（强于 §8.1 字段枚举），本类型以 **完整原始块
/// （raw JSONValue）** 存储、保全字段，7 字段以 typed 访问器暴露。assistant 用 `init(raw:)` 原样保全；
/// user-image 重建块与 Codex 构造块用字段构造器（只含显式键，对齐 legacy 重建的最小键集）。
public struct ChatContentBlock: Sendable, Equatable {
    /// 完整原始块（保 §8.1 外字段，双跑 diff 红线）。
    public var raw: JSONValue

    public init(raw: JSONValue) { self.raw = raw }

    /// 字段构造（user-image 重建 / Codex 构造）——只写显式提供的键（nil 键省略，对齐 legacy）。
    public init(
        type: String,
        text: String? = nil,
        name: String? = nil,
        input: JSONValue? = nil,
        content: JSONValue? = nil,
        toolUseId: String? = nil,
        source: JSONValue? = nil
    ) {
        var o: [String: JSONValue] = ["type": .string(type)]
        if let text { o["text"] = .string(text) }
        if let name { o["name"] = .string(name) }
        if let input { o["input"] = input }
        if let content { o["content"] = content }
        if let toolUseId { o["tool_use_id"] = .string(toolUseId) }
        if let source { o["source"] = source }
        self.raw = .object(o)
    }

    // 7 字段 typed 访问器（§8.1）。
    public var type: String? { field("type")?.stringValue }
    public var text: String? { field("text")?.stringValue }
    public var name: String? { field("name")?.stringValue }
    public var input: JSONValue? { field("input") }
    public var content: JSONValue? { field("content") }
    public var toolUseId: String? { field("tool_use_id")?.stringValue }
    public var source: JSONValue? { field("source") }

    private func field(_ key: String) -> JSONValue? {
        raw.objectValue?[key]
    }
}

/// 规范化后的会话消息（§3 详情投影输出）。
public struct ChatSessionMessage: Sendable, Equatable {
    public var uuid: String
    public var type: ChatMessageType
    public var sessionId: String
    /// 工作目录，缺失为 ""（legacy `entry.cwd || ''`，非 nil）。
    public var cwd: String
    public var gitBranch: String?
    public var timestamp: String
    public var content: ChatMessageContent

    public init(
        uuid: String,
        type: ChatMessageType,
        sessionId: String,
        cwd: String,
        gitBranch: String? = nil,
        timestamp: String,
        content: ChatMessageContent
    ) {
        self.uuid = uuid
        self.type = type
        self.sessionId = sessionId
        self.cwd = cwd
        self.gitBranch = gitBranch
        self.timestamp = timestamp
        self.content = content
    }
}

// MARK: - SearchResult（§8.1）

/// 搜索命中结果（§4）。
public struct ChatSearchResult: Sendable, Equatable {
    public var projectHash: String
    public var sessionId: String
    public var snippet: String
    /// 命中那一行的 timestamp（§4.2，非会话级）。
    public var timestamp: String

    public init(projectHash: String, sessionId: String, snippet: String, timestamp: String) {
        self.projectHash = projectHash
        self.sessionId = sessionId
        self.snippet = snippet
        self.timestamp = timestamp
    }
}

// MARK: - 输入契约：ChatRecordReading（信封读取协议）

/// CC 纯函数层的**输入访问面**——一行会话 JSONL 解析后的信封读取契约。
///
/// A1-1 的 `SessionRecord`（MuxvoTranscript）逐字段满足本协议——集成期 `extension SessionRecord:
/// ChatRecordReading {}` 零代码绑定（见 SessionRecordBinding.swift）。纯函数（Extractor/Projector/
/// SearchPredicate）只吃这个协议：测试可用真 SessionRecord 或轻量 mock，完全解耦具体信封类型。
///
/// `messageContent` / `topLevelContent` 是 JSONSerialization 原始解析值（String / [Any] /
/// [String:Any] / NSNumber / NSNull），纯函数内部做 §2/§3/§4 的块归一化——把内容语义留在本层
/// （双跑 diff 红线），信封只做透传。
///
/// 红线（§3.5）：本协议**不暴露 isSidechain**——投影层不得引入 sidechain 过滤。
public protocol ChatRecordReading {
    var type: String { get }
    var uuid: String? { get }
    var sessionId: String? { get }
    var cwd: String? { get }
    var gitBranch: String? { get }
    var timestamp: String? { get }
    var isMeta: Bool? { get }
    var isCompactSummary: Bool? { get }
    /// legacy `entry.message?.content` 的原始 JSON 值，无则 nil。
    var messageContent: Any? { get }
    /// legacy 顶层 `entry.content` 的原始值，无则 nil。
    var topLevelContent: Any? { get }
    /// 顶层 `summary` 键（`type=="summary"` 记录）——空 title fallback 链取（dogfood-r4 问题5）。
    /// **协议扩展默认 nil**：mock 记录零破坏（不实现即 nil）；真 SessionRecord 经 binding 暴露实值。
    var summaryText: String? { get }
}

extension ChatRecordReading {
    /// 默认实现：mock/轻量记录不携 summary → nil（真 SessionRecord 覆盖此默认，见 SessionRecordBinding）。
    public var summaryText: String? { nil }
}
