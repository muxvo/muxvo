// Metrics：phys_footprint 读取（task_info TASK_VM_INFO，与 Xcode/footprint(1) 同口径）
// 与边际内存计算 helper。
import Darwin
import Foundation

public enum Metrics {
    /// 当前进程 phys_footprint，单位字节；失败返回 0
    public static func physFootprintBytes() -> UInt64 {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(
            MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        // Swift 6 下 mach_task_self_（全局 var）不并发安全，改用等价的 task_self_trap()
        let selfTask = task_self_trap()
        let kr: kern_return_t = withUnsafeMutablePointer(to: &info) { ptr in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
                task_info(selfTask, task_flavor_t(TASK_VM_INFO), intPtr, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return 0 }
        return UInt64(info.phys_footprint)
    }

    public static func physFootprintMB() -> Double {
        Double(physFootprintBytes()) / 1_048_576.0
    }

    /// 每会话边际内存（MB）：(稳态 - 基线) / 会话数
    public static func marginalMBPerSession(baselineMB: Double, steadyMB: Double, sessions: Int) -> Double {
        guard sessions > 0 else { return 0 }
        return (steadyMB - baselineMB) / Double(sessions)
    }

    /// 稳态估计：取末尾 1/4 采样（至少 2 个）的均值
    public static func steadyStateMB(samples: [Double]) -> Double {
        guard !samples.isEmpty else { return 0 }
        let tailCount = max(2, samples.count / 4)
        let tail = samples.suffix(tailCount)
        return tail.reduce(0, +) / Double(tail.count)
    }
}
