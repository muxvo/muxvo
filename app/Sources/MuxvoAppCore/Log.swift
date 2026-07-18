// 统一日志（os.Logger）：线上 dogfood 可诊断性地基。NSLog 不入统一日志系统
// （`log show` 抓不到），关键路径改走 os.Logger，`subsystem == "com.muxvo"` 一网打尽。
//
// 取证：log show --last 5m --predicate 'subsystem == "com.muxvo"'
// 实时：log stream --predicate 'subsystem == "com.muxvo"'
//
// 级别口径：穿透/命中等高频判定用 .debug（默认不落盘、需 --debug 才显）；attach/detach、
// layoutReport 消费、状态源就位等低频关键节点用 .info；启动/关停/错误用 .notice/.error。
import os

enum Log {
    private static let subsystem = "com.muxvo"
    /// 桥入向动作消费（layoutReport 洞/岛几何等）。
    static let bridge = Logger(subsystem: subsystem, category: "bridge")
    /// 终端渲染面 attach/detach。
    static let surface = Logger(subsystem: subsystem, category: "surface")
    /// 上层 web 穿透 hitTest 判定（高频，.debug 级）。
    static let hittest = Logger(subsystem: subsystem, category: "hittest")
    /// 应用生命周期（启动/关停/崩溃和解/真状态源）。
    static let app = Logger(subsystem: subsystem, category: "app")
}
