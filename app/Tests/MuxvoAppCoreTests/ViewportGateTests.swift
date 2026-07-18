// 视口一致性守卫纯函数（DOGFOOD_M3_13 F5b）：web 报文携带测量时刻 innerWidth/Height，
// native 与 webView.bounds 比对——失配报文（H-window 类错误视口测量）整体拒收。
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import AppKit
import Testing
@testable import MuxvoAppCore

@Suite("layoutReport 视口一致性判定（DOGFOOD_M3_13 F5b）")
struct ViewportGateTests {
    @Test("一致放行：精确匹配 + 容差内（滚动条/取整抖动 ≤max(4pt,1%)）")
    func matchesWithinTolerance() {
        let b = CGSize(width: 1440, height: 900)
        #expect(CompositeRootViewController.viewportMatches(reportW: 1440, reportH: 900, bounds: b))
        #expect(CompositeRootViewController.viewportMatches(reportW: 1426, reportH: 892, bounds: b)) // 1% 内
        #expect(CompositeRootViewController.viewportMatches(reportW: 1454, reportH: 908, bounds: b))
    }

    @Test("失配拒收：H-window 实录形态（webView 1440×900 vs 报文 1024×611）")
    func staleViewportRejected() {
        let b = CGSize(width: 1440, height: 900)
        #expect(CompositeRootViewController.viewportMatches(reportW: 1024, reportH: 611, bounds: b) == false)
        #expect(CompositeRootViewController.viewportMatches(reportW: 1440, reportH: 611, bounds: b) == false)
    }

    @Test("字段缺席放行（旧 web/fixture 向后兼容）；小窗口容差取 4pt 下限")
    func absentFieldsAdmitAndSmallBoundsFloor() {
        let b = CGSize(width: 1440, height: 900)
        #expect(CompositeRootViewController.viewportMatches(reportW: nil, reportH: nil, bounds: b))
        #expect(CompositeRootViewController.viewportMatches(reportW: 1024, reportH: nil, bounds: b))
        let small = CGSize(width: 300, height: 200)
        #expect(CompositeRootViewController.viewportMatches(reportW: 304, reportH: 196, bounds: small)) // ±4pt
        #expect(CompositeRootViewController.viewportMatches(reportW: 306, reportH: 200, bounds: small) == false)
    }
}
