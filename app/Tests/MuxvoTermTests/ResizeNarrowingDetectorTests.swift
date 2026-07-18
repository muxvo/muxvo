// 可疑窄化判定纯函数边界（DOGFOOD_M3_13 F1 取证日志的判定锚）。
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import Testing

@testable import MuxvoTerm

@Suite("resize 可疑窄化判定（DOGFOOD_M3_13 F1）")
struct ResizeNarrowingDetectorTests {
    @Test("old<20 豁免（初建 80×24 前的小网格不报）")
    func smallOldGridExempt() {
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 19, newCols: 10) == false)
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 10, newCols: 2) == false)
    }

    @Test("恰缩 30% 不报（136→96 边界内），>30% 报（136→95）")
    func thirtyPercentBoundary() {
        // 136×0.7 = 95.2：new=96 → 960 >= 952 不报；new=95 → 950 < 952 报。
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 136, newCols: 96) == false)
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 136, newCols: 95) == true)
    }

    @Test("典型形态：136→31（错误视口烧写）报；168→83（平铺减半）也报——刻意宽进严出")
    func typicalCases() {
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 136, newCols: 31) == true)
        // 168→83 = 缩 50.6%——超过 30% 也报。刻意如此：平铺 1→2 终端的减半同样值得留痕
        //（.error 只是取证级别不拦截行为；误报成本 = 一条日志，漏报成本 = 丢时间线）。
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 168, newCols: 83) == true)
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 83, newCols: 83) == false)
        #expect(TerminalSession.isSuspiciousNarrowing(oldCols: 83, newCols: 126) == false)
    }
}
