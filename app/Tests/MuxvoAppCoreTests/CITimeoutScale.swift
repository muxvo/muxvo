// CI 超时缩放（timing 敏感异步观察测试共用）——MuxvoTermTests/CITimeoutScale.swift 的
// target 内拷贝（swift-testing helper 是 target-scoped internal，跨 test target 无法共享；
// 语义/系数与同名文件保持逐字一致，改动须两处同步）。背景见原文件头注释（2026-07-03 CI 红灯裁决）。
import Foundation

/// timing 敏感异步观察测试的轮询超时缩放系数。
/// 优先读 `MUXVO_TEST_TIMEOUT_SCALE`（显式覆写，>0 有效）；否则 CI 环境 ×8、本地 ×1。
func muxvoCITimeoutScale() -> Double {
    let env = ProcessInfo.processInfo.environment
    if let raw = env["MUXVO_TEST_TIMEOUT_SCALE"], let v = Double(raw), v > 0 { return v }
    return env["CI"] != nil ? 8 : 1
}
