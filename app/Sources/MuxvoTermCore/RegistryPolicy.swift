// SessionRegistry 上限策略（纯常量 + 判定，vendor-free）。
//
// 权威：terminal-session.md §6.1（TERM_L2_83 / PERF_L2_07）+ multi-window.md §3（V1.1 上限重裁）。
//
// **overlay note（multi-window.md §3，2026-07-11 用户裁决⑧，批C C3 起）**：单窗上限 20 沿用 M3 冻结值，
// 但**语义从「registry 全局」下沉到「每窗 projection 层」**（`maxPerWindowCount`）；registry 层改为**全局池
// 上限 40**（`maxTerminalCount`，含 worker/接管会话）。因此：
//   - TERM_L2_83 的「20 + 冻结文案 `maxReachedMessage`」现由**每窗 projection**兑现（UIStateProjection
//     入维序前先拦；文案 `maxReachedMessage` 逐字不变=TERM_L2_83 oracle，禁改）。
//   - PERF_L2_07 的「≥20 禁用新建」现为**每窗**判据（snapshot.maxReached=本窗满∨全局满）。
//   - 全局 40 满是**新增** registry 层拦截，文案 `globalMaxReachedMessage`（裁决⑧）。
// 拦截顺序 = 先窗（20，projection）后全局（40，registry）。boundaries.spec.json TERM_L2_83「20」/
// PERF_L2_07「20」= 每窗口径，仍逐字成立，故 spec JSON 不改。

public enum RegistryPolicy {
    /// **全局**会话上限（multi-window.md §3 裁决⑧，20→40 全局池语义；含 worker/接管会话）。SessionRegistry
    /// 层拦截口径。
    public static let maxTerminalCount = 40

    /// **每窗**会话上限（multi-window.md §3；沿用 M3 冻结值 20）。UIStateProjection 层拦截口径（本窗可见+收起
    /// 的人用终端数）。
    public static let maxPerWindowCount = 20

    /// 每窗满员拒绝文案——冻结 spec 文案，逐字，是 TERM_L2_83 的测试 oracle。禁改（改须动 overlay note）。
    public static let maxReachedMessage = "已达最大终端数，请关闭不用的终端"

    /// 全局池满员拒绝文案（multi-window.md §3 裁决⑧）：本窗未满但全局已满 40 时 registry 层报此。
    public static let globalMaxReachedMessage = "已达全局最大终端数（40），请关闭不用的终端或窗口"

    /// 当前已有 count 个会话时，还能否再创建（count < 全局上限）。
    public static func canCreate(currentCount: Int) -> Bool {
        currentCount < maxTerminalCount
    }

    /// 全局池是否已满员（count >= 全局上限）。
    public static func maxReached(currentCount: Int) -> Bool {
        currentCount >= maxTerminalCount
    }

    /// 本窗是否已满员（order.count >= 每窗上限）；满员时该窗 ui.state 快照 maxReached==true（PERF_L2_07 每窗口径）。
    public static func perWindowMaxReached(currentCount: Int) -> Bool {
        currentCount >= maxPerWindowCount
    }

    /// 本窗还能否再建（count < 每窗上限）。
    public static func canCreatePerWindow(currentCount: Int) -> Bool {
        currentCount < maxPerWindowCount
    }
}
