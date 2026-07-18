// 内存监控装配层用例（M7 批4）：MemoryWarning → data.event memoryWarning 译码（APP_L1_05 推送格式）。
// 纯核 MemoryMonitor 行为（间隔/阈值/文案/指标格式）在 MuxvoPerfTests；此处只钉桥 wire 形状。

import Foundation
import Testing
import MuxvoBridge
import MuxvoPerf
@testable import MuxvoAppCore

@Suite("内存监控装配（M7 批4）")
@MainActor
struct MemoryAssemblyTests {

    @Test("APP_L1_05: app:memory-warning 推送格式——MemoryWarning → data.event memoryWarning{currentMemoryMB, threshold, message}")
    func memoryWarningDataEvent() {
        let warning = MemoryWarning(currentMemoryMB: 2560, threshold: 2048, message: "内存占用较高，建议关闭部分终端")
        let event = MemoryAssembly.dataEvent(for: warning)
        #expect(event == .memoryWarning(currentMemoryMB: 2560, threshold: 2048, message: "内存占用较高，建议关闭部分终端"))
    }
}
