// 上层透明 WKWebView + hitTest 穿透（C 案两处非常规用法之一）。
//  - 透明化：KVC setValue(false, forKey:"drawsBackground") + 页面 html/body transparent
//    + 关闭 layer 不透明。
//  - hitTest override：命中点落在洞清单内 → 返回 nil（穿透到下层 sibling）；否则交回
//    super（web 自己处理，含 chrome/modal）。洞清单空（modal）→ 恒不穿透。
//  - WKScriptMessageHandler：`layout`（洞 rect 上报）+ `probe`（web 侧鼠标/焦点佐证）。
import AppKit
import WebKit

final class PassthroughWebView: WKWebView {
    let holeStore: HoleStore
    /// hitTest 决策审计（S2 用）：记录每次判定「穿透/命中web」，供断言读取。
    private(set) var lastHitWasPassthrough = false

    init(frame: CGRect, configuration: WKWebViewConfiguration, holeStore: HoleStore) {
        self.holeStore = holeStore
        super.init(frame: frame, configuration: configuration)
        // 透明化：KVC（无公开 API）+ layer
        setValue(false, forKey: "drawsBackground")
        wantsLayer = true
        layer?.isOpaque = false
        layer?.backgroundColor = NSColor.clear.cgColor
        setValue(NSColor.clear, forKey: "backgroundColor") // best-effort，失败无碍
        autoresizingMask = [.width, .height]
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// KVC 回读，供 S1 断言。
    func drawsBackgroundReadback() -> Bool? { value(forKey: "drawsBackground") as? Bool }

    override func hitTest(_ point: NSPoint) -> NSView? {
        // point 在 superview（contentView）坐标系。webview.frame 原点 (0,0) 且铺满，
        // 故 point 即 contentView/AppKit 坐标（左下原点）。翻转为 CSS（左上原点）比对。
        let h = bounds.height
        let cssX = Double(point.x)
        let cssY = Double(h - point.y)
        if holeStore.containsCSS(x: cssX, y: cssY) {
            lastHitWasPassthrough = true
            return nil // 穿透
        }
        lastHitWasPassthrough = false
        return super.hitTest(point)
    }

    /// 直接查询某窗口坐标点的 hitTest 归属（S2 核心断言用，绕开事件合成路由歧义）。
    /// 返回 true = 该点会穿透到下层。
    func wouldPassthrough(windowPoint: NSPoint) -> Bool {
        let p = convert(windowPoint, from: nil) // window → self
        let h = bounds.height
        return holeStore.containsCSS(x: Double(p.x), y: Double(h - p.y))
    }
}
