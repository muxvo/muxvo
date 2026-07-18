// 文件右键菜单 anchor 坐标换算翻牌（dogfood-r4 问题2：右键菜单弹出位置错位）。
//   探针 P0：定谳 macOS WKWebView `isFlipped`（预期 true = 左上原点，与 CSS 同向）——popUpFileMenu
//     的坐标策略据此选路，探针把该前提固化成断言（若 WebKit 未来翻转语义变，此测先红报警）。
//   P1 纯函数两态：CompositeRootViewController.menuAnchorPoint —— flipped→(x,y) 直传；
//     非 flipped→(x, H−y)。此前 bug 是对 flipped 的 webView 仍做 H−y（双翻镜像，误差 |H−2y|）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import WebKit
@testable import MuxvoAppCore

@Suite("文件菜单 anchor 坐标（dogfood-r4 问题2）", .serialized)
@MainActor
struct FileMenuAnchorTests {

    // MARK: - 探针 P0：WKWebView.isFlipped 定谳

    @Test("探针：macOS WKWebView isFlipped==true（左上原点，与 CSS 坐标同向）")
    func wkWebViewIsFlipped() {
        let web = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        // 预期 true。若为 false，menuAnchorPoint 的条件式仍两态兼容，但需复核 popUpFileMenu 前提。
        #expect(web.isFlipped == true)
    }

    // MARK: - P1：menuAnchorPoint 纯函数两态

    @Test("flipped（WKWebView 常态）→ CSS (x,y) 直传，纵轴不翻")
    func anchorFlippedPassesThrough() {
        // 靠上的点（cssY 小）：双翻 bug 会把它翻到底部（H−y=380），正确应保持 y=20。
        let top = CompositeRootViewController.menuAnchorPoint(
            cssX: 30, cssY: 20, boundsHeight: 400, isFlipped: true)
        #expect(top == NSPoint(x: 30, y: 20))
        // 靠下的点（cssY 大）同理保持。
        let bottom = CompositeRootViewController.menuAnchorPoint(
            cssX: 30, cssY: 360, boundsHeight: 400, isFlipped: true)
        #expect(bottom == NSPoint(x: 30, y: 360))
    }

    @Test("非 flipped（防御 WebKit 语义变化）→ 纵轴翻 boundsHeight−cssY")
    func anchorNonFlippedInvertsY() {
        let p = CompositeRootViewController.menuAnchorPoint(
            cssX: 30, cssY: 20, boundsHeight: 400, isFlipped: false)
        #expect(p == NSPoint(x: 30, y: 380))
    }

    @Test("垂直中部两态相等（旧 bug 在此恰好隐身，故 M6 验收未察觉）")
    func anchorMidpointBothStatesAgree() {
        let flipped = CompositeRootViewController.menuAnchorPoint(
            cssX: 30, cssY: 200, boundsHeight: 400, isFlipped: true)
        let nonFlipped = CompositeRootViewController.menuAnchorPoint(
            cssX: 30, cssY: 200, boundsHeight: 400, isFlipped: false)
        #expect(flipped == nonFlipped) // cssY==H/2 → y 与 H−y 相等
    }
}
