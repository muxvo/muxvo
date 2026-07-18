// 滚轮行累积 + scrollbar 拇指几何（terminal-rendering.md §5）。
//
// 纯逻辑（无 AppKit 事件、无 GPU），供视图 scrollWheel/overlay 消费、供测试直接断言换算与几何。
import CoreGraphics

/// 滚轮 → viewport 滚动行数累积（§5）。
///
/// - trackpad（hasPreciseScrollingDeltas）：deltaY 是点数，按 cell 高（点）换算行数并累积残差；
/// - 鼠标滚轮（非 precise）：deltaY 已是行数，直接累积。
///
/// 输出为 ghostty `GHOSTTY_SCROLL_VIEWPORT_DELTA` 的行数，符号遵 §5「上负下正」：
/// macOS `scrollingDeltaY > 0` = 内容下移（手指上滑 / 滚轮上滚）= 查看更早历史 = 视口**上**滚 = 负 delta。
/// 该符号约定在真 app（检查点⑩ S3 滚动巡检）复核；此处以单一注释常量收口，便于一处翻转。
struct ScrollLineAccumulator {
    private var residual: Double = 0

    /// 累积一次滚轮事件，返回本次应下发的整数行 delta（0 = 不足一行，攒着）。
    mutating func accumulate(deltaY: Double, precise: Bool, cellHeightPoints: Double) -> Int {
        guard cellHeightPoints > 0 else { return 0 }
        let lines = precise ? deltaY / cellHeightPoints : deltaY
        residual += lines
        let whole = residual.rounded(.towardZero)
        residual -= whole
        guard whole != 0 else { return 0 }
        return -Int(whole)   // 内容下移(正) → 向历史上滚 → ghostty 负 delta
    }

    /// 焦点/attach 切换时清残差（避免跨会话串扰）。
    mutating func reset() { residual = 0 }
}

/// 选区拖出视口边缘 → 自动滚动方向（尾批 item 5，纯逻辑供视图 tick timer + 单测）。
///
/// `yTop` = 鼠标距视口顶的距离（未 clamp，可为负 / 超高）：
///   - `< 0`（拖出**上**边）→ 视口上滚回看更旧内容 → 负 delta（-1/tick）；
///   - `> viewHeight`（拖出**下**边）→ 视口下滚回到更新内容 → 正 delta（+1/tick）；
///   - 边缘内 → nil（停 tick）。
/// 符号与 `ScrollLineAccumulator` 一致（`GHOSTTY_SCROLL_VIEWPORT_DELTA`「上负下正」）。
enum SelectionAutoscroll {
    static func direction(yTop: Double, viewHeight: Double) -> Int? {
        if yTop < 0 { return -1 }
        if yTop > viewHeight { return 1 }
        return nil
    }
}

/// scrollbar 拇指几何（§5）：vt 的 total/offset/len → 视图坐标窄条 frame。
///
/// vt 语义（TerminalFrameSnapshot.ScrollbarSnapshot）：total=可滚区总行数，len=可见行数，
/// offset=viewport 距顶偏移（0=顶/最早，total-len=底/最新）。返回 AppKit 坐标（原点左下，y 向上）。
enum ScrollbarGeometry {
    static let minThumbLengthPx: CGFloat = 24
    static let widthPx: CGFloat = 6
    static let insetPx: CGFloat = 2
    /// 拖拽命中带宽（视图右缘起，DOGFOOD_M3_11）：> widthPx，含右缘 Fitts 收拢。
    static let hitWidthPx: CGFloat = 12
    /// 拖拽命中纵向 Fitts 容差（拇指上下各扩，DOGFOOD_M3_11）。
    static let hitSlopPx: CGFloat = 4

    /// 拇指 frame；无可滚（total<=len）或尺寸非法时返回 nil。
    static func thumbFrame(viewSize: CGSize, total: Int, offset: Int, len: Int) -> CGRect? {
        guard total > len, len > 0, viewSize.height > insetPx * 2, viewSize.width > widthPx else {
            return nil
        }
        let trackH = viewSize.height - insetPx * 2
        let ratio = CGFloat(len) / CGFloat(total)
        let thumbH = min(trackH, max(minThumbLengthPx, trackH * ratio))
        let maxOffset = CGFloat(max(1, total - len))
        let progress = min(1, max(0, CGFloat(offset) / maxOffset))
        let travel = trackH - thumbH
        // offset=0（顶）→ 拇指在顶部；AppKit y 向上，顶部 y 大。
        let y = insetPx + travel * (1 - progress)
        let x = viewSize.width - widthPx - insetPx
        return CGRect(x: x, y: y, width: widthPx, height: thumbH)
    }

    /// 拇指命中矩形（DOGFOOD_M3_11 §5 ☆）：以视图右缘为界的 `hitWidthPx` 宽命中带 + 纵向 `±hitSlopPx`
    /// Fitts 容差。`thumb` 为 mouseDown 现场用最新快照重算的 `thumbFrame`（非 GPU 路径滞后的 layer.frame）。
    static func dragHitRect(thumb: CGRect, viewSize: CGSize) -> CGRect {
        let x = viewSize.width - hitWidthPx
        let y = thumb.minY - hitSlopPx
        return CGRect(x: x, y: y, width: hitWidthPx, height: thumb.height + hitSlopPx * 2)
    }

    /// 拇指拖拽反算（DOGFOOD_M3_11 §5 ☆）：指针 y（AppKit 视图坐标，自底向上）+ `grabOffsetY`（mouseDown 时
    /// 指针相对拇指顶的偏移）→ 目标 offset。与 `thumbFrame` 逐字同式的 trackH/thumbH/travel/maxOffset；
    /// 无可滚（total<=len）或 travel≤0 → nil。往返误差 ≤0.5 行。
    static func offsetForThumbDrag(viewSize: CGSize, total: Int, len: Int,
                                   pointerY: CGFloat, grabOffsetY: CGFloat) -> Int? {
        guard total > len, len > 0, viewSize.height > insetPx * 2, viewSize.width > widthPx else {
            return nil
        }
        let trackH = viewSize.height - insetPx * 2
        let ratio = CGFloat(len) / CGFloat(total)
        let thumbH = min(trackH, max(minThumbLengthPx, trackH * ratio))
        let travel = trackH - thumbH
        guard travel > 0 else { return nil }   // 拇指撑满轨道：无处可拖
        let maxOffset = CGFloat(max(1, total - len))
        // 拇指顶 = 指针 y + grabOffsetY（grabOffsetY = 指针相对拇指顶偏移）；拇指底 = 顶 − thumbH。
        let thumbBottomY = pointerY + grabOffsetY - thumbH
        // 正向 thumbFrame：y(底) = insetPx + travel*(1-progress)（offset=0 贴顶）→ 反解 progress。
        let progress = min(1, max(0, 1 - (thumbBottomY - insetPx) / travel))
        let offset = (progress * maxOffset).rounded()
        return min(Int(maxOffset), max(0, Int(offset)))
    }
}
