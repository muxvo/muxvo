// Dock tile 合成渲染器（settings-dogfood 批角标收口）。为何存在：macOS 26 对「历史上被通知系统
// 登记过、badge 授权 disabled」的 bundle id 压制 dockTile.badgeLabel 渲染——系统登记正确
// （lsappinfo StatusLabel 可见）但 Dock 拒画；实证三臂矩阵见 probes/dock-badge-probe/reports/。
// contentView 自绘通道不受通知系统管辖，被压 id 亦正常渲染，故 Dock 徽标与更新进度条两路图标
// 覆盖共走本合成器（各自 setter 存值 → 统一 apply）：
//   icon 底 → 可选进度条（legacy setProgressBar 对等，几何沿袭原 UpdateAssembly.ProgressView）
//   → 可选角标胶囊（模拟系统角标观感：systemRed 平涂、白粗体数字、右上角内贴）。
// 双输入皆空 → contentView=nil 还原系统默认图标。badgeLabel 不再写：健康机器（未被压 id）上
// 系统叠画会与自绘并存成双角标；代价（lsappinfo 真值、VoiceOver 徽标读数丧失）wait-detector.md §8 记档。
import AppKit

/// Dock tile 操作接缝（生产 NSApp.dockTile；测试注入假 tile 断言挂/摘序列与 display 次数）。
@MainActor
public protocol DockTilePort: AnyObject {
    var contentView: NSView? { get set }
    func display()
}

/// 生产落点：NSApp.dockTile 直包（NSApplication.shared 按需创建恒安全，同 RealDockBadge 口径）。
@MainActor
public final class RealDockTilePort: DockTilePort {
    public init() {}
    public var contentView: NSView? {
        get { NSApplication.shared.dockTile.contentView }
        set { NSApplication.shared.dockTile.contentView = newValue }
    }
    public func display() { NSApplication.shared.dockTile.display() }
}

@MainActor
public final class DockTileRenderer {
    public static let shared = DockTileRenderer(tile: RealDockTilePort())

    private let tile: DockTilePort
    private let view = CompositeView()

    public init(tile: DockTilePort) {
        self.tile = tile
    }

    /// 徽标文案（DockBadgeController 经 RealDockBadge.setBadge 喂；nil=清）。
    public func setBadgeText(_ text: String?) {
        view.badgeText = text
        apply()
    }

    /// 更新下载进度（UpdateController 经 DockProgressController 喂；nil=清，对等 legacy setProgressBar(-1)）。
    public func setProgressFraction(_ fraction: Double?) {
        view.fraction = fraction
        apply()
    }

    /// 测试只读缝。
    public var badgeTextForTest: String? { view.badgeText }
    public var progressFractionForTest: Double? { view.fraction }

    private func apply() {
        if view.badgeText == nil && view.fraction == nil {
            if tile.contentView != nil { tile.contentView = nil }
        } else if tile.contentView !== view {
            tile.contentView = view
        }
        tile.display()
    }

    // MARK: - 合成绘制（bounds=系统给的 tile 尺寸，随用户 Dock 大小变化，全比例绘制）

    private final class CompositeView: NSView {
        var badgeText: String?
        var fraction: Double?

        override func draw(_ dirtyRect: NSRect) {
            NSApp.applicationIconImage?.draw(in: bounds)
            if let fraction { drawProgress(fraction) }
            if let badgeText { drawBadge(badgeText) }
        }

        /// 进度条：几何逐字沿袭原 UpdateAssembly.ProgressView（灰底 systemBlue 填充，底部横条）。
        private func drawProgress(_ fraction: Double) {
            let bar = NSRect(
                x: bounds.width * 0.10, y: bounds.height * 0.08,
                width: bounds.width * 0.80, height: bounds.height * 0.09
            )
            let radius = bar.height / 2
            NSColor(calibratedWhite: 0.15, alpha: 0.85).setFill()
            NSBezierPath(roundedRect: bar, xRadius: radius, yRadius: radius).fill()
            var fill = bar.insetBy(dx: 1.5, dy: 1.5)
            fill.size.width = max(fill.width * min(max(fraction, 0), 1), fill.height)
            NSColor.systemBlue.setFill()
            NSBezierPath(roundedRect: fill, xRadius: fill.height / 2, yRadius: fill.height / 2).fill()
        }

        /// 角标胶囊：右上角内贴（contentView 画不出系统式外溢）。不做 99+ 截断——macOS 系统
        /// 角标惯例显全数（Mail 可上千），胶囊按文本自动加宽。
        private func drawBadge(_ text: String) {
            let d = min(bounds.width, bounds.height) * 0.42
            let str = text as NSString
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.boldSystemFont(ofSize: d * 0.58),
                .foregroundColor: NSColor.white,
            ]
            let textSize = str.size(withAttributes: attrs)
            let w = max(d, textSize.width + d * 0.5)
            let rect = NSRect(x: bounds.maxX - w - 1, y: bounds.maxY - d - 1, width: w, height: d)
            NSColor.systemRed.setFill()
            NSBezierPath(roundedRect: rect, xRadius: d / 2, yRadius: d / 2).fill()
            str.draw(
                at: NSPoint(x: rect.midX - textSize.width / 2, y: rect.midY - textSize.height / 2),
                withAttributes: attrs)
        }
    }
}
