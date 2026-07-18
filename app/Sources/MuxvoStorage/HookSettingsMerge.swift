// HookSettingsMerge：CC settings.json 的 hooks 合并（纯函数，wait-detector.md §7）。
//
// 定位：把 muxvo 的三 hook 组幂等合并进 `~/.claude/settings.json`（路径可注入，测试用 $TMPDIR
// 假文件——绝不碰真文件）。**纯函数式**（Data→Data），备份 + AtomicFile 原子写由 MuxvoApp 的
// HookInstaller 完成；本模块只做「保用户既有条目 + 幂等增删 muxvo 组」的 JSON 变换，可单测。
//
// CC 实际 schema（§7 亲验 2026-07-02）：`hooks.<Event>` 是**嵌套 matcher-group 数组**——元素为
// `{ "matcher"?: string, "hooks": [ {"type":"command","command":"…","timeout"?:N} ] }`；muxvo 组
// **无 matcher**（`{ "hooks": [...] }`）。裸叶子命令对象 append CC 不识别，故按 group 形。
//
// 识别策略（§7 B1）：按 group 的 `hooks[].command` 含子串（`muxvo-hook.sh`）识别 muxvo 组——
// 可验证、不依赖 CC 是否保留自定义键。启用=移除旧 muxvo 组后 append（替换升级）；停用=移除全部
// 含子串的 group。**绝不触碰用户既有条目**（仅动被识别为 muxvo 的 group）。
//
// vendor-free：用 JSONSerialization 保留任意未知顶层键/未知 hook 组（round-trip 只重排序、不丢键）。
import Foundation

public enum HookSettingsMerge {
    /// 单条待装 hook：事件名 + 组内 command 串（由调用方按脚本路径组好）+ timeout。
    public struct Entry: Equatable, Sendable {
        public let event: String
        public let command: String
        public let timeout: Int
        public init(event: String, command: String, timeout: Int) {
            self.event = event
            self.command = command
            self.timeout = timeout
        }
    }

    public enum Action: Equatable, Sendable {
        case enable([Entry])
        case disable
    }

    public enum MergeError: Error, Equatable {
        case corruptSettings          // 现有内容非 JSON 对象（拒绝覆盖，防丢用户数据）
        case unexpectedHooksShape     // hooks / 某事件数组结构非预期（拒绝覆盖）
    }

    /// 合并后的 settings JSON 数据（prettyPrinted+sortedKeys）。
    /// - settings：现有 settings.json 数据；nil（文件缺失）→ 从空对象起。**损坏 JSON → 抛错不覆盖**。
    /// - identifierSubstring：muxvo 组识别子串（`muxvo-hook.sh`）。
    public static func merged(
        settings: Data?, action: Action, identifierSubstring: String
    ) throws -> Data {
        var root = try parseRoot(settings)
        var hooks = try hooksDict(from: root)

        switch action {
        case let .enable(entries):
            // 先按事件分组（同事件可多条，理论上一事件一条）。
            var byEvent: [String: [Entry]] = [:]
            for e in entries { byEvent[e.event, default: []].append(e) }
            for (event, evEntries) in byEvent {
                var groups = try eventGroups(hooks[event], event: event)
                // 幂等：移除旧 muxvo 组（替换升级）。
                groups.removeAll { groupHasIdentifier($0, identifierSubstring) }
                // append 新 muxvo 组（无 matcher，§7 确切形状）。
                for e in evEntries { groups.append(muxvoGroup(command: e.command, timeout: e.timeout)) }
                hooks[event] = groups
            }
        case .disable:
            // 移除所有事件里含子串的 muxvo 组；事件数组清空则删键（干净）。
            for (event, value) in hooks {
                var groups = try eventGroups(value, event: event)
                let before = groups.count
                groups.removeAll { groupHasIdentifier($0, identifierSubstring) }
                guard groups.count != before else { continue } // 无 muxvo 组，不动
                if groups.isEmpty {
                    hooks.removeValue(forKey: event)
                } else {
                    hooks[event] = groups
                }
            }
        }

        if hooks.isEmpty {
            root.removeValue(forKey: "hooks")
        } else {
            root["hooks"] = hooks
        }
        return try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
    }

    /// 自检：现有 settings 中已装 muxvo 组的事件集合（§7 每次启动自检的一半——另一半是脚本在位/指纹）。
    /// 损坏/缺失 → 空集。
    public static func installedEvents(settings: Data?, identifierSubstring: String) -> Set<String> {
        guard let root = try? parseRoot(settings),
              let hooks = try? hooksDict(from: root) else { return [] }
        var result: Set<String> = []
        for (event, value) in hooks {
            guard let groups = try? eventGroups(value, event: event) else { continue }
            if groups.contains(where: { groupHasIdentifier($0, identifierSubstring) }) {
                result.insert(event)
            }
        }
        return result
    }

    // MARK: 私有

    private static func parseRoot(_ settings: Data?) throws -> [String: Any] {
        guard let settings, !settings.isEmpty else { return [:] }
        guard let obj = try? JSONSerialization.jsonObject(with: settings) else {
            throw MergeError.corruptSettings
        }
        guard let dict = obj as? [String: Any] else { throw MergeError.corruptSettings }
        return dict
    }

    private static func hooksDict(from root: [String: Any]) throws -> [String: Any] {
        guard let raw = root["hooks"] else { return [:] }
        guard let dict = raw as? [String: Any] else { throw MergeError.unexpectedHooksShape }
        return dict
    }

    /// 某事件的 group 数组（缺失 → 空数组新建；非数组 → 抛）。
    private static func eventGroups(_ value: Any?, event: String) throws -> [[String: Any]] {
        guard let value else { return [] }
        guard let arr = value as? [Any] else { throw MergeError.unexpectedHooksShape }
        // 每元素应为对象；非对象（异常）→ 抛，不静默丢用户数据。
        var groups: [[String: Any]] = []
        for el in arr {
            guard let g = el as? [String: Any] else { throw MergeError.unexpectedHooksShape }
            groups.append(g)
        }
        return groups
    }

    /// group 的任一 `hooks[].command` 含识别子串。
    private static func groupHasIdentifier(_ group: [String: Any], _ substring: String) -> Bool {
        guard let inner = group["hooks"] as? [Any] else { return false }
        for h in inner {
            if let cmd = (h as? [String: Any])?["command"] as? String, cmd.contains(substring) {
                return true
            }
        }
        return false
    }

    /// muxvo 组（无 matcher，§7 确切形状）：`{ "hooks": [ {type:command, command, timeout} ] }`。
    private static func muxvoGroup(command: String, timeout: Int) -> [String: Any] {
        ["hooks": [["type": "command", "command": command, "timeout": timeout]]]
    }
}
