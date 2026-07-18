// StatusLineSettingsMerge：CC settings.json 顶层 `statusLine` 单键合并（纯函数，usage-limit-alert.md §3）。
//
// 定位：把 muxvo 的 statusline 传感器命令幂等写入/移除 `~/.claude/settings.json`（路径可注入，测试用
// 内存 Data——绝不碰真文件）。**纯函数式**（Data→Data），备份 + AtomicFile 原子写由 MuxvoAppCore 的
// StatusLineInstaller 完成；本模块只做「保用户既有条目 + 幂等增删 muxvo statusLine」的 JSON 变换。
//
// CC 实际 schema（§1 亲验 2026-07-11，CC 2.1.206）：顶层 `statusLine` 为单对象
// `{ "type": "command", "command": "…" }`——与 hooks 的嵌套 matcher-group 数组不同，是**独占单键**，
// 故三态语义（§3）：absent=可写入；muxvo（command 含 `muxvo-statusline.sh` 子串）=替换升级/可删；
// foreign（键存在且非 muxvo，含非对象形状）= enable **拒绝**、disable 不动——绝不覆盖用户自己的 statusline。
//
// vendor-free：JSONSerialization 保留任意未知顶层键（round-trip 只重排序、不丢键）。
import Foundation

public enum StatusLineSettingsMerge {
    public enum Action: Equatable, Sendable {
        case enable(command: String)
        case disable
    }

    /// 现有 statusLine 键的三态（§3）。
    public enum Presence: Equatable, Sendable {
        case absent   // 无 statusLine 键
        case muxvo    // command 含识别子串（muxvo 的，可替换/可删）
        case foreign  // 键存在且非 muxvo（含非对象等异常形状）——绝不触碰
    }

    public enum MergeError: Error, Equatable {
        case corruptSettings    // 现有内容非 JSON 对象（拒绝覆盖，防丢用户数据）
        case foreignStatusLine  // 已有外来 statusLine（enable 拒绝覆盖，v1 不做包裹链）
    }

    /// 合并后的 settings JSON 数据（prettyPrinted+sortedKeys，同 HookSettingsMerge 口径）。
    /// - settings：现有 settings.json 数据；nil（文件缺失）→ 从空对象起。**损坏 JSON → 抛错不覆盖**。
    /// - identifierSubstring：muxvo 识别子串（`muxvo-statusline.sh`）。
    public static func merged(
        settings: Data?, action: Action, identifierSubstring: String
    ) throws -> Data {
        var root = try parseRoot(settings)
        let presence = presence(root: root, identifierSubstring: identifierSubstring)

        switch action {
        case let .enable(command):
            guard presence != .foreign else { throw MergeError.foreignStatusLine }
            root["statusLine"] = ["type": "command", "command": command]
        case .disable:
            // 只删 muxvo 的；absent 无可删、foreign 绝不动（幂等无害）。
            if presence == .muxvo {
                root.removeValue(forKey: "statusLine")
            }
        }
        return try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
    }

    /// 自检：现有 settings 中 statusLine 键三态（§3；StatusLineInstaller selfCheck 的一半——另一半是
    /// 脚本在位/指纹）。损坏/缺失 → absent（自检语义：无可识别的已装项）。
    public static func inspect(settings: Data?, identifierSubstring: String) -> Presence {
        guard let root = try? parseRoot(settings) else { return .absent }
        return presence(root: root, identifierSubstring: identifierSubstring)
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

    private static func presence(root: [String: Any], identifierSubstring: String) -> Presence {
        guard let raw = root["statusLine"] else { return .absent }
        guard let dict = raw as? [String: Any],
              let command = dict["command"] as? String else { return .foreign } // 非对象/无 command = 外来异形
        return command.contains(identifierSubstring) ? .muxvo : .foreign
    }
}
