// DockTileRenderer 直测（settings-dogfood 批角标收口）。注入假 DockTilePort，验合成器状态机：
// 挂/摘 contentView、display 调用、徽标与更新进度两路互不 clobber。绘制观感本身（红圆/进度条）
// 不在此测——探针矩阵与真机走查取证（probes/dock-badge-probe/reports/）。
import AppKit
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("DockTileRenderer（Dock tile 合成：徽标+更新进度共用 contentView）")
struct DockTileRendererTests {
    @MainActor
    final class FakeTile: DockTilePort {
        var contentView: NSView? {
            didSet { assignments.append(contentView != nil) }
        }
        /// 挂/摘序列（true=挂 view，false=摘还原）——断言幂等（重复设不重挂）。
        var assignments: [Bool] = []
        var displayCount = 0
        func display() { displayCount += 1 }
    }

    @Test("WD_dock_tile_badge_render: 设徽标→挂 contentView+display；重复设只重绘不重挂")
    func badgeRender() {
        let tile = FakeTile()
        let r = DockTileRenderer(tile: tile)
        r.setBadgeText("3")
        #expect(tile.contentView != nil)
        #expect(tile.displayCount == 1)
        #expect(r.badgeTextForTest == "3")
        r.setBadgeText("4") // 已挂只改文本：不重挂，仍触发重绘
        #expect(tile.assignments == [true])
        #expect(tile.displayCount == 2)
        #expect(r.badgeTextForTest == "4")
    }

    @Test("WD_dock_tile_compose: 徽标与更新进度共存互不 clobber，单清一路另一路仍挂")
    func compose() {
        let tile = FakeTile()
        let r = DockTileRenderer(tile: tile)
        r.setBadgeText("2")
        r.setProgressFraction(0.5)
        #expect(r.badgeTextForTest == "2")
        #expect(r.progressFractionForTest == 0.5)
        #expect(tile.contentView != nil)
        r.setProgressFraction(nil) // 清进度，徽标仍在
        #expect(tile.contentView != nil)
        #expect(r.badgeTextForTest == "2")
        r.setBadgeText("9")
        r.setProgressFraction(0.8)
        r.setBadgeText(nil) // 反向：清徽标，进度仍在
        #expect(tile.contentView != nil)
        #expect(r.progressFractionForTest == 0.8)
        #expect(r.badgeTextForTest == nil)
    }

    @Test("WD_dock_tile_clear_restores_icon: 双输入皆空→contentView=nil 还原系统默认图标")
    func clearRestoresIcon() {
        let tile = FakeTile()
        let r = DockTileRenderer(tile: tile)
        r.setBadgeText("1")
        r.setProgressFraction(0.3)
        r.setBadgeText(nil)
        #expect(tile.contentView != nil) // 进度还在，不摘
        r.setProgressFraction(nil)
        #expect(tile.contentView == nil) // 双空才摘
        #expect(tile.assignments == [true, false]) // 全程一挂一摘
        #expect(tile.displayCount == 4) // 每次输入变化都 display
    }
}
