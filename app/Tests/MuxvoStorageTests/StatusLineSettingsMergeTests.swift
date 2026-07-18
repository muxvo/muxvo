// StatusLineSettingsMerge 单测（usage-limit-alert.md §3 / §8 UL_merge_* / UL_inspect_tristate）。
//
// 纯函数式（Data→Data）：验「保用户既有条目 + 幂等增删 muxvo statusLine + foreign 拒绝覆盖」。
// 绝不碰真 ~/.claude/settings.json（本测全在内存 Data 上跑）。
import Foundation
import Testing
@testable import MuxvoStorage

@Suite("StatusLineSettingsMerge 三态合并（usage-limit-alert.md §3）")
struct StatusLineSettingsMergeTests {
    private let idSub = "muxvo-statusline.sh"
    // 假路径含空格（验引号裹路径防线）；不得用真数据根名字面（preflight 步骤6 字面量纪律）。
    private let cmd = "\"/Users/x/Library/Application Support/Fake Root/hooks/muxvo-statusline.sh\""

    private func root(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    // MARK: UL_merge_install_shape

    @Test("UL_merge_install_shape: enable 于空场写出 {type:command,command:…}，未知顶层键全保留")
    func installShape() throws {
        let existing = Data(#"{"model":"opus","theme":"dark"}"#.utf8)
        let merged = try StatusLineSettingsMerge.merged(
            settings: existing, action: .enable(command: cmd), identifierSubstring: idSub)
        let r = root(merged)
        let sl = r["statusLine"] as? [String: Any]
        #expect(sl?["type"] as? String == "command")
        #expect(sl?["command"] as? String == cmd)
        #expect(r["model"] as? String == "opus") // 用户既有键原样
        #expect(r["theme"] as? String == "dark")
    }

    @Test("UL_merge_install_shape: settings 缺失（nil）→ 从空对象起写入")
    func installFromNil() throws {
        let merged = try StatusLineSettingsMerge.merged(
            settings: nil, action: .enable(command: cmd), identifierSubstring: idSub)
        let sl = root(merged)["statusLine"] as? [String: Any]
        #expect((sl?["command"] as? String)?.contains(idSub) == true)
    }

    // MARK: UL_merge_idempotent

    @Test("UL_merge_idempotent: 二次 enable 替换升级（新 command 生效、不残留旧值）")
    func idempotentReplace() throws {
        let first = try StatusLineSettingsMerge.merged(
            settings: nil, action: .enable(command: cmd), identifierSubstring: idSub)
        let newCmd = "\"/elsewhere/hooks/muxvo-statusline.sh\""
        let second = try StatusLineSettingsMerge.merged(
            settings: first, action: .enable(command: newCmd), identifierSubstring: idSub)
        let sl = root(second)["statusLine"] as? [String: Any]
        #expect(sl?["command"] as? String == newCmd)
    }

    // MARK: UL_merge_foreign_refuse

    @Test("UL_merge_foreign_refuse: 已有外来 statusLine → enable 抛 foreignStatusLine")
    func foreignRefuse() {
        let existing = Data(#"{"statusLine":{"type":"command","command":"~/my-own-line.sh"}}"#.utf8)
        #expect(throws: StatusLineSettingsMerge.MergeError.foreignStatusLine) {
            try StatusLineSettingsMerge.merged(
                settings: existing, action: .enable(command: cmd), identifierSubstring: idSub)
        }
    }

    @Test("UL_merge_foreign_refuse: 非对象形状（statusLine 是串）同为 foreign → enable 拒绝")
    func foreignRefuseNonObject() {
        let existing = Data(#"{"statusLine":"weird"}"#.utf8)
        #expect(throws: StatusLineSettingsMerge.MergeError.foreignStatusLine) {
            try StatusLineSettingsMerge.merged(
                settings: existing, action: .enable(command: cmd), identifierSubstring: idSub)
        }
    }

    // MARK: UL_merge_disable_only_muxvo

    @Test("UL_merge_disable_only_muxvo: disable 只删 muxvo 键；其余键原样")
    func disableRemovesMuxvo() throws {
        let installed = try StatusLineSettingsMerge.merged(
            settings: Data(#"{"model":"opus"}"#.utf8),
            action: .enable(command: cmd), identifierSubstring: idSub)
        let disabled = try StatusLineSettingsMerge.merged(
            settings: installed, action: .disable, identifierSubstring: idSub)
        let r = root(disabled)
        #expect(r["statusLine"] == nil)
        #expect(r["model"] as? String == "opus")
    }

    @Test("UL_merge_disable_only_muxvo: 外来 statusLine → disable 不动；缺失 → 幂等无害")
    func disableLeavesForeignAndAbsent() throws {
        let foreign = Data(#"{"statusLine":{"type":"command","command":"~/my-own-line.sh"}}"#.utf8)
        let afterForeign = try StatusLineSettingsMerge.merged(
            settings: foreign, action: .disable, identifierSubstring: idSub)
        let sl = root(afterForeign)["statusLine"] as? [String: Any]
        #expect(sl?["command"] as? String == "~/my-own-line.sh") // 外来原样

        let afterAbsent = try StatusLineSettingsMerge.merged(
            settings: Data(#"{"model":"opus"}"#.utf8), action: .disable, identifierSubstring: idSub)
        #expect(root(afterAbsent)["statusLine"] == nil)
        #expect(root(afterAbsent)["model"] as? String == "opus")
    }

    // MARK: UL_merge_corrupt_refuse

    @Test("UL_merge_corrupt_refuse: 损坏 JSON → 抛 corruptSettings 拒绝覆盖")
    func corruptRefuse() {
        let corrupt = Data("not json {{{".utf8)
        #expect(throws: StatusLineSettingsMerge.MergeError.corruptSettings) {
            try StatusLineSettingsMerge.merged(
                settings: corrupt, action: .enable(command: cmd), identifierSubstring: idSub)
        }
    }

    // MARK: UL_inspect_tristate

    @Test("UL_inspect_tristate: absent / muxvo / foreign（含非对象形状=foreign；损坏=absent）")
    func inspectTristate() throws {
        #expect(StatusLineSettingsMerge.inspect(settings: nil, identifierSubstring: idSub) == .absent)
        #expect(StatusLineSettingsMerge.inspect(
            settings: Data(#"{"model":"opus"}"#.utf8), identifierSubstring: idSub) == .absent)
        let installed = try StatusLineSettingsMerge.merged(
            settings: nil, action: .enable(command: cmd), identifierSubstring: idSub)
        #expect(StatusLineSettingsMerge.inspect(settings: installed, identifierSubstring: idSub) == .muxvo)
        #expect(StatusLineSettingsMerge.inspect(
            settings: Data(#"{"statusLine":{"type":"command","command":"~/mine.sh"}}"#.utf8),
            identifierSubstring: idSub) == .foreign)
        #expect(StatusLineSettingsMerge.inspect(
            settings: Data(#"{"statusLine":"weird"}"#.utf8), identifierSubstring: idSub) == .foreign)
        #expect(StatusLineSettingsMerge.inspect(
            settings: Data("broken{".utf8), identifierSubstring: idSub) == .absent)
    }
}
