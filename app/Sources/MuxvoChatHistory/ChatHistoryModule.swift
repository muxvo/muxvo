// M5 聊天数据面（发现/投影/搜索纯函数层 + chat.db）——纯函数投影与搜索，零 UI / 零编排依赖。
//
// 行为权威：specs/behavior/chat-data.md（v1-frozen，双跑红线）§1~§8。
// 分层：MuxvoTranscript 供 SessionRecord/SessionJSONLDecoder（磁盘会话 JSONL 信封解码），
// 本模块在其上补聊天域语义投影（ProjectInfo / SessionSummary / SessionMessage / SearchResult）。
// 镜像/归档落 chat.db 与 <dataRoot>/chat-history/（§6，数据根隔离严格遵守 CLAUDE.md）。
//
// 骨架占位（批1 A1-1）：让 target 可编译，A1-2/A1-3 在其上填投影/搜索。

public enum ChatHistoryModule {
    /// 本模块对齐的数据面行为规格版本（chat-data.md v1-frozen）。
    public static let specVersion = "chat-data v1"
}
