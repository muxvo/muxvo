// swift-tools-version: 6.0
// M3 批0① 复合 UI spike 探针：C 案（原生 Metal 终端在下 + 透明 WKWebView 全窗在上
// + hitTest 穿透）做实/否决 S1-S6。
//
// 链接方式抄 term-probe Package.swift 的最终选型（见 term-probe 头注释）：
// - CGhosttyVT 普通 C target，头文件搜索路径用 packageDirectory 拼 vendor/artifacts/include
//   的绝对路径（vendor/artifacts 是指向 ~/Library/Caches/muxvo-build/artifacts 的符号链接）；
// - Swift 端 import CGhosttyVT 需 -Xcc -I<include>；
// - 静态链接优先：-Xlinker 直接喂 libghostty-vt.a 绝对路径（避免 -lghostty-vt 选到 dylib），
//   库内含 C++（highway）故补 -lc++。
//
// ProbeCore / ProbeRendererMetal / CGhosttyVT 三 target 的源码逐字节复制自 term-probe
// （term-probe 未导出 products，无法 path 依赖；见 COPIED_FROM.md）。模块名与 term-probe
// 一致，使复制源无需改动即可编译。spike 专属代码在 executable target composite-probe。
import PackageDescription

let pkgDir = Context.packageDirectory
let vendorInclude = "\(pkgDir)/vendor/artifacts/include"
let vendorLib = "\(pkgDir)/vendor/artifacts/lib"

let package = Package(
    name: "composite-probe",
    platforms: [.macOS(.v14)],
    targets: [
        .target(
            name: "CGhosttyVT",
            cSettings: [
                .unsafeFlags(["-I", vendorInclude])
            ]
        ),
        .target(
            name: "ProbeCore",
            dependencies: ["CGhosttyVT"],
            swiftSettings: [
                .unsafeFlags(["-Xcc", "-I\(vendorInclude)"])
            ]
        ),
        .target(
            name: "ProbeRendererMetal",
            dependencies: ["ProbeCore", "CGhosttyVT"],
            swiftSettings: [
                .unsafeFlags(["-Xcc", "-I\(vendorInclude)"])
            ],
            linkerSettings: [
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("AppKit"),
                .linkedFramework("CoreText"),
                .linkedFramework("QuartzCore"),
            ]
        ),
        .executableTarget(
            name: "composite-probe",
            dependencies: ["ProbeCore", "ProbeRendererMetal"],
            swiftSettings: [
                .unsafeFlags(["-Xcc", "-I\(vendorInclude)"])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "\(vendorLib)/libghostty-vt.a",
                    "-lc++",
                ]),
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("CoreText"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("QuartzCore"),
            ]
        ),
    ]
)
