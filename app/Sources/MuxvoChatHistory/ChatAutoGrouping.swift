// 生产自动归组策略（chat-data.md §10，2026-07-16 用户拍板）——后台工具项目用 `claude -p` 在用完
// 即删的临时目录起自动会话（RelPad hub：~/.relpadhq-assistant/triage-N、$TMPDIR/relpad-*；Penraft
// 渲染器：$TMPDIR/penraft-render/job-*），目录删了但会话记录残留（实测共享池 897 目录中 521 个
// relpad 系 + 4 个 penraft job），每个 cwd 编码目录被当成独立「项目」撑爆列表。临时目录已删无法
// git 反查 → 只能按 hash 路径模式归属。
//
// 分叉边界（§8 dump/双跑面零动）：本策略经 ChatStore init 注入（默认 nil = 全关，一切输出与
// 引入前逐字节相同——CD_autogroup_disabled_by_default_zero_change 锚死）；生产装配
// （ChatAssembly.make）传 `.standard`，dump 的 ChatStoreReader 不传。ChatProjectMerger（§1 冻结
// legacy 对齐面）零动，本文件独立成层。
import Foundation

/// 自动会话归组策略：多分组（每组=规则表+目标项目），目标解析 + 项目列表折叠（纯函数）。
public struct ChatAutoGroupingPolicy: Sendable {
    /// hash 匹配规则（cwd 编码目录名 = 非 [a-zA-Z0-9-] 全替换 `-`，见 CodexPrimitives 注释）。
    public enum Rule: Sendable {
        case contains(String)
        case prefix(String)

        func matches(_ hash: String) -> Bool {
            switch self {
            case .contains(let t): return hash.contains(t)
            case .prefix(let t): return hash.hasPrefix(t)
            }
        }

        /// 命中时的来源标签 = 命中 token 之后整段（如 `assistant-triage-6229`/`render-job-20260514-…`）。
        func label(_ hash: String) -> String? {
            switch self {
            case .contains(let t):
                guard let r = hash.range(of: t) else { return nil }
                return String(hash[r.upperBound...])
            case .prefix(let t):
                guard hash.hasPrefix(t) else { return nil }
                return String(hash.dropFirst(t.count))
            }
        }
    }

    /// 一个归组：规则表 + 目标项目名 + 目标缺席时的合成桶。hash 命中多组时首组胜（组序即优先级）。
    public struct Group: Sendable {
        public let rules: [Rule]
        /// 目标项目 displayName（小写比较；如 "relpad"——`old_RelPad` → "old_relpad" 天然不吸）。
        public let targetDisplayNameLower: String
        /// 目标项目不存在时的合成桶（无前导 `-`，与 cwd 编码目录名空间天然不撞）。
        public let syntheticHash: String
        public let syntheticDisplayName: String

        public init(
            rules: [Rule], targetDisplayNameLower: String,
            syntheticHash: String, syntheticDisplayName: String
        ) {
            self.rules = rules
            self.targetDisplayNameLower = targetDisplayNameLower
            self.syntheticHash = syntheticHash
            self.syntheticDisplayName = syntheticDisplayName
        }

        func matches(_ hash: String) -> Bool {
            rules.contains { $0.matches(hash) }
        }

        func label(_ hash: String) -> String? {
            for rule in rules {
                if let l = rule.label(hash) { return l }
            }
            return nil
        }

        /// RelPad hub 规则表（实测池分布全覆盖：169×assistant-triage-N、67×assistant-N、15×test-*、
        /// 5×chat-assistant-N、2×assistant-deskbatch-*、~250×TMPDIR relpad-<purpose>-<rand>）。
        public static let relpad = Group(
            rules: [
                .contains("--relpadhq-"),        // ~/.relpadhq-*（assistant/test/chat-assistant/deskbatch）
                .contains("-T-relpad-"),         // 系统 TMPDIR /var/folders/…/T/relpad-*
                .prefix("-private-tmp-relpad-"), // /private/tmp/relpad-*
                .prefix("-tmp-relpad-"),         // /tmp/relpad-*
            ],
            targetDisplayNameLower: "relpad",
            syntheticHash: "muxvo-autogroup-relpad",
            syntheticDisplayName: "RelPad")

        /// Penraft 本地 HTML 渲染器规则表（2026-05 存量：$TMPDIR/penraft-render/job-<时间戳> 每渲染
        /// 一篇起一次 claude；实测池 4 条）。
        public static let penraft = Group(
            rules: [
                .contains("-T-penraft-"),         // 系统 TMPDIR /var/folders/…/T/penraft-*
                .prefix("-private-tmp-penraft-"), // /private/tmp/penraft-*
                .prefix("-tmp-penraft-"),         // /tmp/penraft-*
            ],
            targetDisplayNameLower: "penraft",
            syntheticHash: "muxvo-autogroup-penraft",
            syntheticDisplayName: "Penraft")
    }

    public let groups: [Group]

    public init(groups: [Group]) {
        self.groups = groups
    }

    /// 生产装配用全量策略（新增后台工具项目在此追加一组）。
    public static let standard = ChatAutoGroupingPolicy(groups: [.relpad, .penraft])
    /// 单组便捷（测试/聚焦场景用）。
    public static let relpad = ChatAutoGroupingPolicy(groups: [.relpad])

    /// hash 命中的组下标（首组胜）；不命中 → nil。
    func groupIndex(for projectHash: String) -> Int? {
        groups.firstIndex { $0.matches(projectHash) }
    }

    public func matches(_ projectHash: String) -> Bool {
        groupIndex(for: projectHash) != nil
    }

    /// 会话卡来源标签（命中组内首条命中规则的 token 后整段）；不命中 → nil。
    public func label(_ projectHash: String) -> String? {
        guard let gi = groupIndex(for: projectHash) else { return nil }
        return groups[gi].label(projectHash)
    }

    /// 逐组目标解析（index 对齐 groups）：候选中「自身不命中任何组 且 displayName 小写 == 组目标」者
    /// 取 lastActivity 最大（tie → projectHash 升序首个，确定性）；无 → 该组合成桶 hash。
    public func resolveTargetHashes(in candidates: [ChatProjectInfo]) -> [String] {
        let eligible = candidates.filter { !matches($0.projectHash) }
        return groups.map { g in
            eligible
                .filter { $0.displayName.lowercased() == g.targetDisplayNameLower }
                .sorted { a, b in
                    if a.lastActivity != b.lastActivity { return a.lastActivity > b.lastActivity }
                    return a.projectHash < b.projectHash
                }
                .first?.projectHash ?? g.syntheticHash
        }
    }

    /// 项目列表折叠：各组命中条目并入该组目标条目（sessionCount/totalSize 累加、lastActivity
    /// max——同 ChatProjectMerger §1.2 累加语义）；目标不在列表（合成桶场景）则补一条。无命中 =
    /// 原列表原样返回。输出按 lastActivity 降序（与 projects() 输出序一致）。
    public func group(_ projects: [ChatProjectInfo], targetHashes: [String]) -> [ChatProjectInfo] {
        var out = projects
        var anyMatched = false
        for (gi, g) in groups.enumerated() {
            var matchedIdx: [Int] = []
            for (i, p) in out.enumerated() where groupIndex(for: p.projectHash) == gi {
                matchedIdx.append(i)
            }
            guard !matchedIdx.isEmpty else { continue }
            anyMatched = true
            let targetHash = targetHashes[gi]
            var targetIdx = out.firstIndex { $0.projectHash == targetHash }
            if targetIdx == nil {
                out.append(ChatProjectInfo(
                    projectHash: targetHash, displayPath: "", displayName: g.syntheticDisplayName,
                    sessionCount: 0, totalSize: nil, lastActivity: 0, source: .claudeCode))
                targetIdx = out.count - 1
            }
            let t = targetIdx!
            for i in matchedIdx {
                out[t].sessionCount += out[i].sessionCount
                out[t].totalSize = (out[t].totalSize ?? 0) + (out[i].totalSize ?? 0)
                out[t].lastActivity = max(out[t].lastActivity, out[i].lastActivity)
            }
            for i in matchedIdx.reversed() { out.remove(at: i) }
        }
        guard anyMatched else { return projects }
        out.sort { $0.lastActivity > $1.lastActivity }
        return out
    }
}
