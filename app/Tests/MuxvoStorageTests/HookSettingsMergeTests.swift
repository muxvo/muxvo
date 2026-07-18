// HookSettingsMerge 幂等合并单测（批5①，wait-detector.md §7 / §10 WD_install_shape / WD_install_idempotent）。
//
// 纯函数式（Data→Data）：验「保用户既有条目 + 幂等增删 muxvo 组 + 嵌套 matcher-group 确切形状」。
// 绝不碰真 ~/.claude/settings.json（本测全在内存 Data 上跑）。
import Foundation
import Testing
@testable import MuxvoStorage

@Suite("HookSettingsMerge 幂等合并与形状（批5①）")
struct HookSettingsMergeTests {
    private let idSub = "muxvo-hook.sh"

    /// 四事件与 HookScript.installedEvents 同形（本层不 import MuxvoTerm，列表就地镜像）。
    private static let allEvents = ["Notification", "Stop", "UserPromptSubmit", "SessionStart"]

    private func muxvoEntries(events: [String] = HookSettingsMergeTests.allEvents) -> [HookSettingsMerge.Entry] {
        events.map {
            HookSettingsMerge.Entry(
                event: $0, command: "\"/Users/x/hooks/muxvo-hook.sh\" \($0)", timeout: 5)
        }
    }

    private func root(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private func groups(_ root: [String: Any], _ event: String) -> [[String: Any]] {
        let hooks = root["hooks"] as? [String: Any] ?? [:]
        return (hooks[event] as? [[String: Any]]) ?? []
    }

    private func muxvoGroup(_ groups: [[String: Any]]) -> [String: Any]? {
        groups.first { g in
            guard let inner = g["hooks"] as? [[String: Any]] else { return false }
            return inner.contains { ($0["command"] as? String)?.contains(idSub) == true }
        }
    }

    // MARK: WD_install_shape

    @Test("WD_install_shape: enable 四事件各 append 一个无 matcher 的 group{hooks:[{type:command,command,timeout}]}")
    func enableProducesNestedGroupShape() throws {
        let merged = try HookSettingsMerge.merged(
            settings: nil, action: .enable(muxvoEntries()), identifierSubstring: idSub)
        let r = root(merged)
        for event in HookSettingsMergeTests.allEvents {
            let gs = groups(r, event)
            #expect(gs.count == 1)
            guard let g = muxvoGroup(gs) else { Issue.record("\(event) 应有 muxvo group"); return }
            #expect(g["matcher"] == nil) // muxvo 组无 matcher（§7 确切形状）
            let inner = g["hooks"] as? [[String: Any]] ?? []
            #expect(inner.count == 1)
            #expect(inner[0]["type"] as? String == "command")
            #expect((inner[0]["command"] as? String)?.hasSuffix("\(event)") == true) // command 末尾事件名 = $1
            #expect((inner[0]["command"] as? String)?.contains(idSub) == true)
            #expect(inner[0]["timeout"] as? Int == 5)
        }
    }

    // MARK: WD_install_idempotent

    @Test("WD_install_idempotent: 二次 enable 不重复写（替换升级），用户既有条目零改动")
    func enableIsIdempotentAndPreservesUserEntries() throws {
        // 初始 settings：用户自有 Notification hook（带 matcher）+ 顶层自定义键。
        let initial: [String: Any] = [
            "model": "sonnet",
            "hooks": [
                "Notification": [
                    ["matcher": "Foo", "hooks": [["type": "command", "command": "user-own-cmd"]]]
                ]
            ],
        ]
        let initialData = try JSONSerialization.data(withJSONObject: initial)

        let once = try HookSettingsMerge.merged(
            settings: initialData, action: .enable(muxvoEntries()), identifierSubstring: idSub)
        let twice = try HookSettingsMerge.merged(
            settings: once, action: .enable(muxvoEntries()), identifierSubstring: idSub)
        let r = root(twice)

        // Notification：用户组 + muxvo 组 各一（二次 enable 不叠加 → 仍 2 组）。
        let notif = groups(r, "Notification")
        #expect(notif.count == 2)
        #expect(notif.contains { ($0["matcher"] as? String) == "Foo" }) // 用户组零改动
        #expect(muxvoGroup(notif) != nil)
        // 顶层自定义键保留。
        #expect(r["model"] as? String == "sonnet")
    }

    @Test("WD_install_idempotent: disable 移除全部含子串的 muxvo 组，用户条目 + 顶层键保留")
    func disableRemovesOnlyMuxvoGroups() throws {
        let initial: [String: Any] = [
            "model": "opus",
            "hooks": [
                "Notification": [
                    ["matcher": "Foo", "hooks": [["type": "command", "command": "user-own-cmd"]]]
                ],
            ],
        ]
        let enabled = try HookSettingsMerge.merged(
            settings: try JSONSerialization.data(withJSONObject: initial),
            action: .enable(muxvoEntries()), identifierSubstring: idSub)
        let disabled = try HookSettingsMerge.merged(
            settings: enabled, action: .disable, identifierSubstring: idSub)
        let r = root(disabled)

        // muxvo 组全清：Stop/UserPromptSubmit 事件数组空 → 删键。
        #expect(groups(r, "Stop").isEmpty)
        #expect(groups(r, "UserPromptSubmit").isEmpty)
        // Notification 只剩用户组。
        let notif = groups(r, "Notification")
        #expect(notif.count == 1)
        #expect((notif.first?["matcher"] as? String) == "Foo")
        #expect(muxvoGroup(notif) == nil)
        #expect(r["model"] as? String == "opus")
    }

    @Test("installedEvents 自检：enable 后四事件齐全；旧 3-hook 安装缺 SessionStart（升级 drift 判据）；disable 后空集；损坏 → 空集")
    func installedEventsSelfCheck() throws {
        let enabled = try HookSettingsMerge.merged(
            settings: nil, action: .enable(muxvoEntries()), identifierSubstring: idSub)
        #expect(HookSettingsMerge.installedEvents(settings: enabled, identifierSubstring: idSub)
            == Set(HookSettingsMergeTests.allEvents))

        // 升级路径（登记 4 兑现）：老安装只有三事件 → 与新四事件全集差出 SessionStart（HookInstaller
        // selfCheck 据此报 drift「缺 hook：SessionStart」提示重新启用，非静默重写）。
        let legacyThree = try HookSettingsMerge.merged(
            settings: nil,
            action: .enable(muxvoEntries(events: ["Notification", "Stop", "UserPromptSubmit"])),
            identifierSubstring: idSub)
        let legacyInstalled = HookSettingsMerge.installedEvents(settings: legacyThree, identifierSubstring: idSub)
        #expect(Set(HookSettingsMergeTests.allEvents).subtracting(legacyInstalled) == ["SessionStart"])

        let disabled = try HookSettingsMerge.merged(
            settings: enabled, action: .disable, identifierSubstring: idSub)
        #expect(HookSettingsMerge.installedEvents(settings: disabled, identifierSubstring: idSub).isEmpty)

        #expect(HookSettingsMerge.installedEvents(
            settings: Data("not json".utf8), identifierSubstring: idSub).isEmpty)
    }

    @Test("损坏 settings（非 JSON 对象）→ 抛 corruptSettings，不覆盖丢数据")
    func corruptSettingsThrows() {
        #expect(throws: HookSettingsMerge.MergeError.corruptSettings) {
            _ = try HookSettingsMerge.merged(
                settings: Data("[1,2,3]".utf8), action: .disable, identifierSubstring: idSub)
        }
    }

    @Test("缺失文件（settings=nil）从空对象起，enable 得干净四事件")
    func nilSettingsStartsFromEmpty() throws {
        let merged = try HookSettingsMerge.merged(
            settings: nil, action: .enable(muxvoEntries()), identifierSubstring: idSub)
        let r = root(merged)
        #expect((r["hooks"] as? [String: Any])?.count == 4)
    }
}
