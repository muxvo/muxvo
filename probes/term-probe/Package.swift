// swift-tools-version: 6.0
// M0 探针 headless 部分：libghostty-vt + PTY 的会话/视图分离验证。
//
// 链接方式记录（以能编过为准的最终选型）：
// - CGhosttyVT 走普通 C target，SwiftPM 自动生成 umbrella modulemap；
//   头文件搜索路径用 Context.packageDirectory 拼出 vendor/artifacts/include
//   的绝对路径（vendor/artifacts 是指向 ~/Library/Caches/muxvo-build/artifacts
//   的符号链接，SwiftPM/clang 解析无碍）。
// - Swift 端 import CGhosttyVT 时 clang module 编译同样需要 -I，故 ProbeCore
//   与 probe-cli 都带 -Xcc -I<include>。
// - 静态链接优先（免 rpath）：lib 目录里同时存在 .a 与 .dylib，-lghostty-vt
//   会优先选 dylib，所以用 -Xlinker 直接喂 libghostty-vt.a 的绝对路径；
//   库内含 C++（highway），需补 -lc++。
import PackageDescription

let pkgDir = Context.packageDirectory
let vendorInclude = "\(pkgDir)/vendor/artifacts/include"
let vendorLib = "\(pkgDir)/vendor/artifacts/lib"
// Track A 对照实验用：GhosttyKit.xcframework（自带 module.modulemap，模块名 GhosttyKit）
let ghosttyKitDir = "\(pkgDir)/vendor/artifacts/GhosttyKit.xcframework/macos-arm64"

let package = Package(
    name: "term-probe",
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
            name: "ProbeAppA",
            swiftSettings: [
                .unsafeFlags(["-Xcc", "-I\(ghosttyKitDir)/Headers"])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "\(ghosttyKitDir)/libghostty-fat.a",
                    "-lc++",
                ]),
                .linkedFramework("AppKit"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("CoreText"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("Carbon"), // TIS* 键盘布局符号
            ]
        ),
        .executableTarget(
            name: "ProbeAppB",
            dependencies: ["ProbeCore", "ProbeRendererMetal"],
            swiftSettings: [
                .unsafeFlags(["-Xcc", "-I\(vendorInclude)"])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "\(vendorLib)/libghostty-vt.a",
                    "-lc++",
                ])
            ]
        ),
        .executableTarget(
            name: "probe-cli",
            dependencies: ["ProbeCore"],
            swiftSettings: [
                .unsafeFlags(["-Xcc", "-I\(vendorInclude)"])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "\(vendorLib)/libghostty-vt.a",
                    "-lc++",
                ])
            ]
        ),
    ]
)
