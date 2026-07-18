// M4b 会话恢复**生产装配缝**进程内集成测（对抗验收 M-2 回修）：驱真 TerminalService.createStartupTerminals
// 的**有锚点分支**——seed 锚点文件 + config 带稳定 id + 假 transcript → 真 join→闸→注入器→取证→横幅计数
// 全链，断言「resume 命令**真送达** PTY 写入口」+ 取证行落盘 + 恢复统计。补齐「装配缝回归即绿放行」的缺口。
//
// 假 harness = `/bin/sh -c 'sleep;printf READY;cat>>capture'`：printf 给静默门首输出（seen_first），
// cat 把注入器写进 PTY 的 resume 串落到 capture 文件（= PTY 写入口的真证据，不烧真 CC token）。
import Foundation
import Testing
import MuxvoStorage
import MuxvoTerm
import MuxvoTestSupport

@testable import MuxvoAppCore

@Suite("会话恢复生产装配缝集成（M-2 回修）", .serialized, .timeLimit(.minutes(2)))
@MainActor
struct SessionRestoreIntegrationTests {
    private let sid = "11111111-2222-3333-4444-555555555555"

    /// 手建临时根（@MainActor 测试不用 withTempRoot 的 Sendable 闭包，避 actor 隔离冲突；沿 ChatPanelRouting 先例）。
    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-restore-int-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 轮询文件直到含 needle 或超时。
    private func waitForContent(_ url: URL, contains needle: String, timeout: TimeInterval) async -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let s = try? String(contentsOf: url, encoding: .utf8), s.contains(needle) { return s }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    @Test("生产链：seed 锚点 + config 稳定 id + 假 transcript → createStartupTerminals 真注入 resume 送达 PTY + 取证 + 计数")
    func restoreInjectsResumeEndToEnd() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        do {
            // ① 隔离假 ~/.claude 容器 + 假 transcript（预检过）。
            let container = root.appendingPathComponent(".claude", isDirectory: true)
            let projects = container.appendingPathComponent("projects", isDirectory: true)
            try FileManager.default.createDirectory(at: projects, withIntermediateDirectories: true)
            let transcript = projects.appendingPathComponent("s.jsonl")
            try Data("{}\n".utf8).write(to: transcript)
            let cwd = root.path // 合法存在目录（createTerminal 不回退 homePath）

            // ② seed 锚点文件（durable）——键 OLD1，与下面 config openTerminals.id 对齐（join 键）。
            let seedStore = TerminalActiveSessionsStore(root: root)
            seedStore.updateAnchor(
                termId: "OLD1", sessionId: sid, cwd: cwd, transcriptPath: transcript.path, lastActiveTs: 100)
            seedStore.flush()

            // ③ config openTerminals 带稳定 id。
            let configStore = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
            var config = configStore.load()
            config.openTerminals = [MuxvoConfig.OpenTerminal(id: "OLD1", cwd: cwd, customName: nil)]
            try configStore.save(config)

            // ④ 假 harness 捕注入：sleep 保 baseline 在 READY 前捕（seen_first 稳）；cat 把注入串落 capture 文件。
            let capture = root.appendingPathComponent("capture.txt")
            let template: () -> TerminalSession.Config = {
                var c = TerminalSession.Config()
                // spawnShell 保持默认 true（真 PTY；false=隔离模式无 PTY、write no-op）；executablePath/argv
                // 指定假 harness（同 takeover 用法）——printf 给静默门首输出，cat 捕注入器写进 PTY 的 resume 串。
                c.executablePath = "/bin/sh"
                c.argv = ["/bin/sh", "-c", "sleep 0.2; printf 'READY\\n'; cat >> '\(capture.path)'"]
                return c
            }

            // ⑤ 真 TerminalService（container 覆盖指隔离假容器；configTemplate 注入捕获 harness）。
            let service = TerminalService(
                configStore: configStore, ptyChildrenStore: PtyChildrenStore(root: root),
                homePath: root.path, dataRoot: root,
                configTemplate: template, claudeContainer: container.path)
            defer { service.stop() }

            let ids = service.createStartupTerminals(count: 1)
            defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }
            #expect(ids.count == 1)

            // ⑥ 恢复统计：真 join→闸→注入 决策 1 条。
            #expect(service.lastRestoreStats == TerminalService.RestoreStats(injected: 1, cannotRestore: 0, isolated: 0))

            // ⑦ resume 命令**真送达 PTY 写入口**（cat 落 capture 文件）。--resume 后不带 --（M5-R1）。
            let content = await waitForContent(capture, contains: "claude --resume \(sid)", timeout: 20)
            #expect(content.contains("cd -- '\(cwd)' && claude --resume \(sid)"),
                    "完整 resume 串（含 cd 前缀 + 转义 + cd -- 断选项，--resume 无 --）真写进 PTY；capture=\(content.debugDescription)")

            // ⑧ 取证行落盘（SEC-m1）+ 0600（m-1）。
            let auditURL = root.appendingPathComponent("logs", isDirectory: true)
                .appendingPathComponent("session-restore-audit.log")
            let audit = await waitForContent(auditURL, contains: "\"sessionId\":\"\(sid)\"", timeout: 5)
            #expect(audit.contains("\"cwd\":\"\(cwd)\"") && audit.contains("\"termId\":"))
            let perms = try FileManager.default.attributesOfItem(atPath: auditURL.path)[.posixPermissions] as? NSNumber
            #expect(perms?.int16Value == 0o600)
        }
    }

    @Test("生产装配缝：console-home cwd 的恢复终端被识别为降级指挥台（提示计数=1；普通终端不计；独立于会话锚点分支）")
    func restoreIdentifiesDegradedConsole() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        do {
            // console-home 目录真存在（命令台 spawn 锚 = <dataRoot>/console-home，command-console.md §1）。
            let consoleHome = ConsoleHomeManager.consoleHomeURL(dataRoot: root)
            try FileManager.default.createDirectory(at: consoleHome, withIntermediateDirectories: true)

            // config：一枚指挥台终端（cwd=console-home）+ 一枚普通终端（cwd=root）。不 seed 任何会话锚点
            // → restoreSessions 早退（lastRestoreStats 恒 nil）→ 验证指挥台识别独立于会话锚点分支。
            let configStore = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
            var config = configStore.load()
            config.openTerminals = [
                MuxvoConfig.OpenTerminal(id: "CON1", cwd: consoleHome.path, customName: nil),
                MuxvoConfig.OpenTerminal(id: "NORM1", cwd: root.path, customName: nil),
            ]
            try configStore.save(config)

            let template: () -> TerminalSession.Config = {
                var c = TerminalSession.Config()
                c.executablePath = "/bin/sh"
                c.argv = ["/bin/sh", "-c", "printf 'READY\\n'; cat"] // 无注入（无锚点），仅占位挂活
                return c
            }
            let service = TerminalService(
                configStore: configStore, ptyChildrenStore: PtyChildrenStore(root: root),
                homePath: root.path, dataRoot: root, configTemplate: template)
            defer { service.stop() }

            let ids = service.createStartupTerminals(count: 1)
            defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }
            #expect(ids.count == 2, "两枚 openTerminals 全部恢复")
            #expect(service.lastRestoreConsoleCount == 1,
                    "console-home cwd 的终端识别为降级指挥台（1）；普通终端不计——真装配路径 dataRoot→consoleHomeURL→cwd 归一匹配")
            #expect(service.lastRestoreStats == nil,
                    "无会话锚点 → restoreSessions 早退；指挥台识别不依赖会话锚点分支")
        }
    }

    @Test("生产链：transcript 缺失 → 装配缝退化 M3（不注入、横幅计数 cannotRestore=1）")
    func restoreDegradesWhenTranscriptMissing() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        do {
            let container = root.appendingPathComponent(".claude", isDirectory: true)
            try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
            let cwd = root.path
            let seedStore = TerminalActiveSessionsStore(root: root)
            // transcriptPath 指向不存在文件 → 预检失败。
            seedStore.updateAnchor(
                termId: "OLD1", sessionId: sid, cwd: cwd,
                transcriptPath: container.appendingPathComponent("projects/nope.jsonl").path, lastActiveTs: 100)
            seedStore.flush()
            let configStore = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
            var config = configStore.load()
            config.openTerminals = [MuxvoConfig.OpenTerminal(id: "OLD1", cwd: cwd, customName: nil)]
            try configStore.save(config)
            let capture = root.appendingPathComponent("capture.txt")
            let template: () -> TerminalSession.Config = {
                var c = TerminalSession.Config()
                // spawnShell 保持默认 true（真 PTY；false=隔离模式无 PTY、write no-op）；executablePath/argv
                // 指定假 harness（同 takeover 用法）——printf 给静默门首输出，cat 捕注入器写进 PTY 的 resume 串。
                c.executablePath = "/bin/sh"
                c.argv = ["/bin/sh", "-c", "printf 'READY\\n'; cat >> '\(capture.path)'"]
                return c
            }
            let service = TerminalService(
                configStore: configStore, ptyChildrenStore: PtyChildrenStore(root: root),
                homePath: root.path, dataRoot: root,
                configTemplate: template, claudeContainer: container.path)
            defer { service.stop() }
            let ids = service.createStartupTerminals(count: 1)
            defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }
            #expect(service.lastRestoreStats == TerminalService.RestoreStats(injected: 0, cannotRestore: 1, isolated: 0),
                    "transcript 缺失 → 不注入、横幅计数 cannotRestore=1")
            // 给注入器最坏窗口后确认 capture 无 resume 串（普通 shell，未注入）。
            try? await Task.sleep(nanoseconds: 300_000_000)
            let content = (try? String(contentsOf: capture, encoding: .utf8)) ?? ""
            #expect(!content.contains("claude --resume"), "退化 M3 → 绝不注入 resume")
        }
    }

    // MARK: - P-2 fast-follow（r3）：Codex 自动恢复装配缝

    @Test("TSR_CX_restore_injects_codex_resume：seed .codex 锚点 + 假 rollout（codexContainer 内）→ 真注入 `codex resume` 送达 PTY")
    func restoreInjectsCodexResumeEndToEnd() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        do {
            let codexSid = "019f5c1a-2c34-7b80-a606-a9c7017a6470"
            // ① 隔离假 ~/.codex/sessions 容器 + 假 rollout（预检过）。
            let sessionsDir = root.appendingPathComponent(".codex/sessions/2026/07/14", isDirectory: true)
            try FileManager.default.createDirectory(at: sessionsDir, withIntermediateDirectories: true)
            let rollout = sessionsDir.appendingPathComponent("rollout-\(codexSid).jsonl")
            try Data("{\"type\":\"session_meta\"}\n".utf8).write(to: rollout)
            let codexContainer = root.appendingPathComponent(".codex/sessions").path
            let cwd = root.path

            // ② seed .codex 锚点（transcriptPath = rollout 绝对路径）。
            let seedStore = TerminalActiveSessionsStore(root: root)
            seedStore.updateAnchor(
                termId: "OLD1", sessionId: codexSid, cwd: cwd, transcriptPath: rollout.path,
                lastActiveTs: 100, harness: .codex)
            seedStore.flush()

            let configStore = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
            var config = configStore.load()
            config.openTerminals = [MuxvoConfig.OpenTerminal(id: "OLD1", cwd: cwd, customName: nil)]
            try configStore.save(config)

            let capture = root.appendingPathComponent("capture.txt")
            let template: () -> TerminalSession.Config = {
                var c = TerminalSession.Config()
                c.executablePath = "/bin/sh"
                c.argv = ["/bin/sh", "-c", "sleep 0.2; printf 'READY\\n'; cat >> '\(capture.path)'"]
                return c
            }
            // codexContainer 覆盖指隔离假容器。
            let service = TerminalService(
                configStore: configStore, ptyChildrenStore: PtyChildrenStore(root: root),
                homePath: root.path, dataRoot: root,
                configTemplate: template, codexContainer: codexContainer)
            defer { service.stop() }

            let ids = service.createStartupTerminals(count: 1)
            defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }
            #expect(service.lastRestoreStats == TerminalService.RestoreStats(injected: 1, cannotRestore: 0, isolated: 0))

            // codex resume 串真送达 PTY（位置参数、无 --）。
            let content = await waitForContent(capture, contains: "codex resume \(codexSid)", timeout: 20)
            #expect(content.contains("cd -- '\(cwd)' && codex resume \(codexSid)"),
                    "完整 codex resume 串真写进 PTY；capture=\(content.debugDescription)")

            // 取证行带 harness=codex。
            let auditURL = root.appendingPathComponent("logs/session-restore-audit.log")
            let audit = await waitForContent(auditURL, contains: "\"sessionId\":\"\(codexSid)\"", timeout: 5)
            #expect(audit.contains("\"harness\":\"codex\""), "取证行记 harness=codex")
        }
    }

    @Test("TSR_CX_restore_missing_rollout_banner：.codex 锚点 rollout 缺失 → 装配缝退化 M3（不注入、cannotRestore=1）")
    func restoreCodexMissingRolloutDegrades() async throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        do {
            let codexSid = "019f5c1a-2c34-7b80-a606-a9c7017a6470"
            let sessionsDir = root.appendingPathComponent(".codex/sessions", isDirectory: true)
            try FileManager.default.createDirectory(at: sessionsDir, withIntermediateDirectories: true)
            let codexContainer = sessionsDir.path
            let cwd = root.path
            let seedStore = TerminalActiveSessionsStore(root: root)
            // rollout 指向不存在文件 → 预检失败。
            seedStore.updateAnchor(
                termId: "OLD1", sessionId: codexSid, cwd: cwd,
                transcriptPath: sessionsDir.appendingPathComponent("2026/07/14/nope.jsonl").path,
                lastActiveTs: 100, harness: .codex)
            seedStore.flush()
            let configStore = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
            var config = configStore.load()
            config.openTerminals = [MuxvoConfig.OpenTerminal(id: "OLD1", cwd: cwd, customName: nil)]
            try configStore.save(config)
            let capture = root.appendingPathComponent("capture.txt")
            let template: () -> TerminalSession.Config = {
                var c = TerminalSession.Config()
                c.executablePath = "/bin/sh"
                c.argv = ["/bin/sh", "-c", "printf 'READY\\n'; cat >> '\(capture.path)'"]
                return c
            }
            let service = TerminalService(
                configStore: configStore, ptyChildrenStore: PtyChildrenStore(root: root),
                homePath: root.path, dataRoot: root,
                configTemplate: template, codexContainer: codexContainer)
            defer { service.stop() }
            let ids = service.createStartupTerminals(count: 1)
            defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }
            #expect(service.lastRestoreStats == TerminalService.RestoreStats(injected: 0, cannotRestore: 1, isolated: 0),
                    "codex rollout 缺失 → 不注入、cannotRestore=1")
            try? await Task.sleep(nanoseconds: 300_000_000)
            let content = (try? String(contentsOf: capture, encoding: .utf8)) ?? ""
            #expect(!content.contains("codex resume"), "退化 M3 → 绝不注入 codex resume")
        }
    }
}
