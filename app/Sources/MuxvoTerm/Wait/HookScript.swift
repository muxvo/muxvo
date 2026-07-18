// HookScript：Layer 0 hook 中继脚本内容 + 安装路径派生（wait-detector.md §4/§7）。
//
// 放 MuxvoTerm/Wait（而非 MuxvoApp/Resources）的两个理由：① MuxvoApp 的 Resources 目录在
// Package.swift 被 `exclude`（不入构建），无法作 SwiftPM 资源分发，且 Package.swift 冻结不可改；
// ② 脚本内容须同时被 HookInstaller（MuxvoApp）与 bash 脚本测试（MuxvoTermTests）引用——二者
// 公共可 import 模块是 MuxvoTerm。故脚本以 Swift 常量承载，安装时**生成式写出**到 hooks 目录。
//
// 脚本内容照 §4 全文逐字（快速静默退出是硬约束），仅两处受控增补并记档：
//   (a) 顶部加 `# muxvo-hook-version: N` 指纹注释——§7「指纹版本匹配」drift 自检所需（§4「内容随
//       app 版本化」本就要求版本化）；
//   (b) SOCK 用 `${MUXVO_HOOK_SOCK:-<socketPath>}`——`socketPath` 由调用方（HookInstaller）从
//       DataDirectory 派生的 `<dataRoot>/run/hook.sock` **绝对路径**注入，测试注入 $TMPDIR socket。
//       **本文件不出现数据根字面**（数据目录字面纪律：只许 DataDirectory.swift；preflight
//       第 6 步机器固化），故 socket 路径一律由 dataRoot 派生传入、不在源码硬编码。
import Foundation
import MuxvoTermCore

public enum HookScript {
    /// 脚本指纹版本（内容变更即 +1，触发 drift 自检重装，§7）。
    public static let version = 1

    /// hook 中继脚本文件名（装 `<dataRoot>/hooks/` 下）。
    public static let scriptFileName = "muxvo-hook.sh"

    /// socket 覆盖 env key（脚本 `${MUXVO_HOOK_SOCK:-…}` 消费）。settings.json 全局共享、脚本内默认
    /// socket 是**安装方分身**烘焙路径——多分身并开时其他分身事件会投错 socket；故每个 grid 终端 PTY
    /// 恒注入本 app 的 socket 路径（TerminalService configTemplate），脚本默认仅作兜底。
    /// 转发 EnvContract.hookSocketKey（单一权威；该键同时在 deletedKeys 剥离继承值防嵌套 muxvo 串线）。
    public static let socketEnvKey = EnvContract.hookSocketKey

    /// settings.json 识别子串（§7 B1：按 command 含此子串识别 muxvo 组，幂等/可逆）。
    public static let identifierSubstring = "muxvo-hook.sh"

    /// 装载的四 hook 事件（§5 四装一不装；command 末尾事件名作 $1）。顺序稳定。
    /// SessionStart 为锚点采集专用（terminal-session-restore.md 登记 4 兑现，2026-07-16）：
    /// resume 起来未再对话的会话也能即时锚定；detector 主链对其零消费。
    public static let installedEvents = ["Notification", "Stop", "UserPromptSubmit", "SessionStart"]

    /// 中继脚本全文（§4 逐字 + 受控增补 (a)(b)）。快速静默退出：无 env / 无 socket 秒退 0；
    /// nc 后台化即 exit 0（退出 <100ms）。raw 裸插 $payload（非法由 native 丢弃兜底，§4 注入面）。
    /// - Parameter socketPath: `<dataRoot>/run/hook.sock` 绝对路径（调用方从 DataDirectory 派生；
    ///   MUXVO_HOOK_SOCK 可覆盖用于测试）。**不在本文件硬编码路径**（字面纪律，见文件头 (b)）。
    public static func scriptText(socketPath: String) -> String {
        """
        #!/bin/bash
        # Muxvo WaitDetector Layer 0 relay — 快速静默退出是硬约束
        # muxvo-hook-version: \(version)
        [ -n "$MUXVO_TERM_ID" ] || exit 0
        SOCK="${MUXVO_HOOK_SOCK:-\(socketPath)}"
        [ -S "$SOCK" ] || exit 0
        payload=$(cat)
        printf '{"v":1,"termId":"%s","event":"%s","raw":%s}' \\
          "$MUXVO_TERM_ID" "$1" "$payload" | nc -U -w 1 "$SOCK" &
        exit 0

        """
    }

    /// settings.json 组内 command 串（§7 确切形状）：`"<scriptPath>" <Event>`（引号裹路径含空格）。
    public static func command(scriptPath: String, event: String) -> String {
        "\"\(scriptPath)\" \(event)"
    }

    // MARK: 路径派生（dev 数据根由调用方注入，字面只在 DataDirectory.swift）

    /// hooks 目录 `<dataRoot>/hooks/`。
    public static func hooksDirectory(dataRoot: URL) -> URL {
        dataRoot.appendingPathComponent("hooks", isDirectory: true)
    }

    /// 脚本文件 `<dataRoot>/hooks/muxvo-hook.sh`。
    public static func scriptURL(dataRoot: URL) -> URL {
        hooksDirectory(dataRoot: dataRoot).appendingPathComponent(scriptFileName)
    }

    /// run 目录 `<dataRoot>/run/`（socket 宿主，与 PtyChildrenStore 同）。
    public static func runDirectory(dataRoot: URL) -> URL {
        dataRoot.appendingPathComponent("run", isDirectory: true)
    }

    /// hook socket 绝对路径 `<dataRoot>/run/hook.sock`（HookInstaller 生成脚本 + HookSocketListener
    /// bind 共用此唯一派生，保生产脚本写的路径与 native 监听的路径一致）。
    public static func socketURL(dataRoot: URL) -> URL {
        runDirectory(dataRoot: dataRoot).appendingPathComponent("hook.sock")
    }
}
