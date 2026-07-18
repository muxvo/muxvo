// swift-tools-version: 6.0
// dock 角标替代渲染通道探针（settings-dogfood 批，2026-07-17）。
// 背景：macOS 26 对「历史上被通知系统登记过、badge 授权 disabled」的 bundle id 压制
// dockTile.badgeLabel 渲染（wait-detector.md §8 记档）。本探针单因子三臂实证替代通道：
//   label   — badgeLabel 直写（对照臂：复验抑制仍在）
//   content — dockTile.contentView 自绘（主验证臂：拟用通道）
//   icon    — applicationIconImage 合成图（备胎通道）
// 零外部依赖（纯 AppKit）。跑法见 scripts/run-probe.sh，结论落 reports/。
import PackageDescription

let package = Package(
    name: "dock-badge-probe",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "dock-badge-probe",
            path: "Sources/dock-badge-probe",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
