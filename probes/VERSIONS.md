# M0 探针依赖 Pin 记录

| 依赖 | 版本 | 备注 |
|---|---|---|
| ghostty（Track A 嵌入 API + xcframework） | `v1.3.1`（commit `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`） | 源码克隆于 `~/Library/Caches/muxvo-build/ghostty/`，不进本仓库 |
| ghostty main（Track B libghostty-vt） | main commit `69095e298ab88bb0eb5ba541f4c505f2c22d07f5`（2026-06-10 fetch） | worktree `~/Library/Caches/muxvo-build/ghostty-main/`；**双 pin 原因见下** |
| zig | `0.15.2`（aarch64-macos，sha256 `3cc2bab3…ce5fa6b` 已校验） | v1.3.1 与所 pin main commit 的 `minimum_zig_version` 一致；装在 `~/Library/Caches/muxvo-build/zig-0.15.2/` |
| Xcode | 16.2 (16C5032a)，Metal toolchain 已确认 | |

## ⚠️ 为什么 Track B 必须 pin main（2026-06-10 实测）

`v1.3.1` tag 的 vt C API 只有解析器（OSC/SGR/key encoder/paste，dylib 导出符号实测确认），
**没有终端状态对象**。探针 2 所需的全部接口只在 main：
`ghostty_terminal_new/vt_write/resize/grid_ref`（terminal.h）、`ghostty_render_state_*`（render.h）、
`ghostty_formatter_*`（formatter.h，乱码校验用 plain-text dump）、screen.h/style.h 等。
这正是调研所说「vt C API 为 WIP、无 tagged release」的实体化——红绿灯结论里必须计入此风险。

## 构建步骤实测记录（2026-06-10，以 `zig build --help`/`--list-steps` 实测为准）

- Track A（GhosttyKit.xcframework，@v1.3.1）：`zig build -Demit-xcframework=true -Dxcframework-target=native -Di18n=false -Doptimize=ReleaseFast`
  - `-Dxcframework-target=native`：只出 arm64，避免 universal 双倍构建
  - `-Di18n=false`：本机无 Homebrew/gettext；探针不需要本地化资源，显式关闭绕开 msgfmt 依赖
  - 产物：`macos/GhosttyKit.xcframework`（~135MB）
- Track B（libghostty-vt，@main）：`zig build -Demit-lib-vt=true -Doptimize=ReleaseFast`
  - 注意：v1.3.1 上是 `zig build lib-vt` step，main 上改为 `-Demit-lib-vt=true` 选项，两边不同
- 产物拷贝至 `probes/term-probe/vendor/artifacts/`（gitignored），由 `scripts/build-ghostty.sh` 自动完成

## 上游风险备忘

- libghostty 嵌入 API（ghostty.h）官方声明未对第三方稳定化，版本间可能大改——升级 pin 前先跑探针回归
- libghostty-vt C API 为 WIP（无独立 tag）；API 缺口清单见 M0-report.md
