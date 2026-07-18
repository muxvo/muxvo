import Testing

@testable import MuxvoTermCore

@Suite("RegistryPolicy（两级上限：每窗 20 冻结文案 + 全局 40，terminal-session.md §6.1 / multi-window.md §3）")
struct RegistryPolicyTests {
    @Test("上限常量：全局 40（registry 口径）+ 每窗 20（projection 口径，multi-window.md §3 裁决⑧）")
    func maxCountConstant() {
        #expect(RegistryPolicy.maxTerminalCount == 40)     // 全局池（含 worker/接管）
        #expect(RegistryPolicy.maxPerWindowCount == 20)    // 每窗人用终端（沿用 M3 冻结值）
    }

    @Test("拒绝文案：每窗满冻结文案逐字（TERM_L2_83 oracle，禁改）+ 全局满文案（裁决⑧）")
    func maxReachedMessageFrozen() {
        #expect(RegistryPolicy.maxReachedMessage == "已达最大终端数，请关闭不用的终端")
        #expect(RegistryPolicy.globalMaxReachedMessage == "已达全局最大终端数（40），请关闭不用的终端或窗口")
    }

    @Test("全局 canCreate：第 40 个可建、第 41 个拒绝")
    func createBoundary() {
        #expect(RegistryPolicy.canCreate(currentCount: 0) == true)
        #expect(RegistryPolicy.canCreate(currentCount: 39) == true) // 建第 40 个
        #expect(RegistryPolicy.canCreate(currentCount: 40) == false) // 第 41 个拒绝
        #expect(RegistryPolicy.canCreate(currentCount: 41) == false)
    }

    @Test("每窗 canCreatePerWindow：第 20 个可建、第 21 个拒绝（每窗口径）")
    func perWindowCreateBoundary() {
        #expect(RegistryPolicy.canCreatePerWindow(currentCount: 0) == true)
        #expect(RegistryPolicy.canCreatePerWindow(currentCount: 19) == true) // 建第 20 个
        #expect(RegistryPolicy.canCreatePerWindow(currentCount: 20) == false) // 第 21 个拒绝
        #expect(RegistryPolicy.canCreatePerWindow(currentCount: 21) == false)
    }

    @Test("maxReached：全局满 40 为真、未满为假；每窗满 20 为真、未满为假")
    func maxReachedBoundary() {
        #expect(RegistryPolicy.maxReached(currentCount: 39) == false)
        #expect(RegistryPolicy.maxReached(currentCount: 40) == true)
        #expect(RegistryPolicy.maxReached(currentCount: 41) == true)
        #expect(RegistryPolicy.perWindowMaxReached(currentCount: 19) == false)
        #expect(RegistryPolicy.perWindowMaxReached(currentCount: 20) == true)
        #expect(RegistryPolicy.perWindowMaxReached(currentCount: 21) == true)
    }
}
