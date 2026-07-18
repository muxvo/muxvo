// CI 超时缩放（timing 敏感异步观察测试共用）。
//
// 背景（2026-07-03 CI 红灯裁决）：macos-15 GitHub runner 是低核虚拟机，swift-testing 默认
// 全并行下整机 CPU/调度饱和，令 kqueue 驱动的 DispatchSource 回调（unix socket accept 读源、
// 子进程退出 NOTE_EXIT 进程源）延迟被抬高到数秒——同一 CI run 里事件确实会触发（等待窗口够长
// 的用例照过），只是短轮询窗口（3s/6s）在饱和清退波（实测 ~7s）之前就到期了。本机 M 系高核不
// 饱和，回调亚毫秒返回，故本地恒绿。
//
// 修复取向：不削弱任何断言（被轮询的条件不变），只在 CI 下把「耐心」放大。本地（无 CI env）
// 系数=1 → 行为与跑速逐字不变；CI 下 ×8 给足余量吸收饱和延迟。可用 MUXVO_TEST_TIMEOUT_SCALE
// 显式覆写（ci.yml/调试用）。
import Foundation

/// timing 敏感异步观察测试的轮询超时缩放系数。
/// 优先读 `MUXVO_TEST_TIMEOUT_SCALE`（显式覆写，>0 有效）；否则 CI 环境 ×8、本地 ×1。
func muxvoCITimeoutScale() -> Double {
    let env = ProcessInfo.processInfo.environment
    if let raw = env["MUXVO_TEST_TIMEOUT_SCALE"], let v = Double(raw), v > 0 { return v }
    return env["CI"] != nil ? 8 : 1
}
