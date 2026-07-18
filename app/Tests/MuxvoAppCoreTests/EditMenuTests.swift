// 编辑菜单（M4a 收官验收现场缺陷，2026-07-06）：主菜单原只有 App+显示两菜单，无「编辑」菜单——
// WKWebView 文本框的 Cmd+V/C/X/A/Z 无菜单路由可走（macOS 经典坑：无编辑菜单则 WKWebView 编辑
// 快捷键失效），任务中心表单「能打字不能粘贴」。修复 = 标准「编辑」菜单六项，**target=nil 走响应链**
// （firstResponder=WKWebView 时由其消费；终端 surface 为 firstResponder 时 Cmd+V/C 已在视图层
// performKeyEquivalent 先于菜单被截留——terminal-input.md §8 F2 守卫，菜单只是 web 侧兜底通道，
// 终端路径零改动。Terminal.app/iTerm/Ghostty 同形态先例）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
@testable import MuxvoAppCore

@Suite("编辑菜单（web 表单剪贴板通道）", .serialized)
@MainActor
struct EditMenuTests {

    @Test("主菜单含「编辑」子菜单：粘贴/拷贝/剪切/全选/撤销/重做 标准 selector + 键位，target=nil 走响应链")
    func editMenuHasStandardItemsNilTargeted() {
        let commands = AppMenuCommands(onZoom: { _ in })
        let menu = commands.buildMainMenu()

        guard let editMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "编辑" }) else {
            Issue.record("主菜单缺「编辑」子菜单"); return
        }
        let expected: [(Selector, String, NSEvent.ModifierFlags)] = [
            (#selector(UndoActionRespondable.undo(_:)), "z", [.command]),
            (#selector(UndoActionRespondable.redo(_:)), "z", [.command, .shift]),
            (#selector(NSText.cut(_:)), "x", [.command]),
            (#selector(NSText.copy(_:)), "c", [.command]),
            (#selector(NSText.paste(_:)), "v", [.command]),
            (#selector(NSText.selectAll(_:)), "a", [.command]),
        ]
        for (sel, key, mods) in expected {
            guard let item = editMenu.items.first(where: { $0.action == sel && $0.keyEquivalent == key }) else {
                Issue.record("「编辑」菜单缺 \(sel) 项（键位 \(key)）"); continue
            }
            #expect(item.keyEquivalentModifierMask == mods, "\(sel) 键位修饰符")
            #expect(item.target == nil, "\(sel) 必须 nil target 走响应链（不得绑死实例）")
        }
    }

    @Test("菜单顺序：编辑在 App 之后、显示之前（平台惯例）；显示菜单结构不受扰")
    func editMenuOrderAndViewMenuIntact() {
        let commands = AppMenuCommands(onZoom: { _ in })
        let menu = commands.buildMainMenu()
        let titles = menu.items.compactMap { $0.submenu?.title }
        guard let editIdx = titles.firstIndex(of: "编辑"), let viewIdx = titles.firstIndex(of: "显示") else {
            Issue.record("缺「编辑」或「显示」菜单（titles=\(titles)）"); return
        }
        #expect(editIdx < viewIdx)
        // 显示菜单既有项零改动：任务中心项仍在（TaskCenterMenuTests 全量断言，此处冒烟）。
        let viewMenu = menu.items.compactMap { $0.submenu }.first { $0.title == "显示" }
        #expect(viewMenu?.items.contains { $0.title == "任务中心" } == true)
    }
}

/// undo:/redo: 无公开 AppKit 类可取 selector（NSResponder 无此方法、undoManager 动态派发），
/// 借协议声明取纯 selector 引用（不实例化、不参与派发）。
@objc private protocol UndoActionRespondable {
    func undo(_ sender: Any?)
    func redo(_ sender: Any?)
}
