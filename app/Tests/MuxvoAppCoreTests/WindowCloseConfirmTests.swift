// DOGFOOD_M3_21 红锚：红叉关窗必须「先问后关」。
// _19 只拦了 applicationShouldTerminate——红叉路径窗口**先关**、last-window-closed 才进漏斗，确认卡
// 无处渲染，app 卡 .terminateLater 成僵尸（持 instance.lock 再启不能；用户 2026-07-07 Muxvo2.2 真机
// 实锤，强杀才恢复）。legacy 在 mainWindow.on('close') preventDefault **先拦**（index.ts:202-218），
// 窗口在场才弹卡。修复两层：①窗口级拦截（windowShouldClose 拒关 + 转发 ⌘Q 同漏斗）②防僵尸兜底
// （窗口不可见时退出请求直接放行，不等永远到不来的确认）。
import AppKit
import Testing

@testable import MuxvoAppCore

@MainActor
@Suite("红叉关窗确认（DOGFOOD_M3_21）")
struct WindowCloseConfirmTests {
    @Test("拦截器：windowShouldClose 拒关且转发关窗请求恰一次")
    func interceptorRefusesAndForwards() {
        var requested = 0
        let interceptor = WindowCloseInterceptor(onCloseRequested: { requested += 1 })
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
            styleMask: [.titled, .closable], backing: .buffered, defer: true)
        // 程序化 NSWindow 默认 releasedWhenClosed=true——close() 后 ARC 强引用二次释放必崩
        // （autoreleasePoolPop objc_release SIGSEGV，本测首跑实锤）；测试持有场景必须关掉。
        window.isReleasedWhenClosed = false
        defer { window.close() }
        window.delegate = interceptor
        #expect(interceptor.windowShouldClose(window) == false, "红叉必须被拒关（窗口在场才有确认卡）")
        #expect(requested == 1, "关窗请求转发恰一次（→ NSApp.terminate 同 ⌘Q 漏斗）")
        #expect(interceptor.windowShouldClose(window) == false)
        #expect(requested == 2, "重复红叉照常转发（待决幂等由 requestQuitConfirm guard 兜）")
    }

    @Test("防僵尸兜底：窗口不可见 → 不拦截直退（确认卡无处渲染）")
    func windowGoneSkipsConfirm() {
        // 窗口在场 + 启动完好 → 拦截等确认（_19 既有语义）
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: false, hasService: true, windowVisible: true) == true)
        // 窗口不可见（程序化 close/极端路径）→ 直退——卡 .terminateLater 等 web 确认 = 僵尸
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: false, hasService: true, windowVisible: false) == false)
        // 白名单既有两轴不受新参数影响
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: true, hasService: true, windowVisible: true) == false)
        #expect(AppDelegate.shouldDeferQuitForConfirm(
            coordinatorIsNoop: false, hasService: false, windowVisible: true) == false)
    }
}
