# 复制来源说明（spike 复用 term-probe 资产）

本包为 M3 批0① 复合 UI spike 探针。检查点⑨裁决用完即可整包删除，非生产资产。

term-probe `Package.swift` 未导出 library products（无 `products:` 段），故 SwiftPM
无法用 `.package(path:)` 依赖其 target。按批0①任务书授权「spike 允许复制，注明来源」，
下列文件**逐字节复制**自 `probes/term-probe/`，模块名保持一致（ProbeCore /
ProbeRendererMetal / CGhosttyVT），使复制的 Swift 源无需任何改动即可编译：

| 本包路径 | 来源 |
|---|---|
| `Sources/CGhosttyVT/include/CGhosttyVT.h` | `term-probe/Sources/CGhosttyVT/include/CGhosttyVT.h`（逐字节） |
| `Sources/CGhosttyVT/shim.c` | `term-probe/Sources/CGhosttyVT/shim.c`（逐字节） |
| `Sources/ProbeCore/TerminalSession.swift` | 同名（逐字节） |
| `Sources/ProbeCore/PTYHost.swift` | 同名（逐字节） |
| `Sources/ProbeCore/CastReplayer.swift` | 同名（逐字节） |
| `Sources/ProbeCore/LoadDriver.swift` | 同名（逐字节） |
| `Sources/ProbeCore/Metrics.swift` | 同名（逐字节） |
| `Sources/ProbeRendererMetal/GlyphAtlas.swift` | 同名（逐字节） |
| `Sources/ProbeRendererMetal/FrameMetrics.swift` | 同名（逐字节） |
| `Sources/ProbeRendererMetal/TerminalMetalView.swift` | 同名 + **spike 追加 input→pixel 打点段**（文件内以 `// spike(composite-probe):` 注释标出，term-probe 原文无此段） |

`vendor/artifacts` 是指向 `~/Library/Caches/muxvo-build/artifacts` 的符号链接（与
term-probe 同款），vendor 产物不进 git。

spike 专属新代码全部在 `Sources/composite-probe/`（可运行的复合窗口 app + S1-S6 自动化）。
`.cast` 压测素材直接引用 `term-probe/loads/cast/`（不复制大文件）。
