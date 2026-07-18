import Testing

@testable import MuxvoTermCore

@Suite("EnvContract（PTY env 合同纯函数，terminal-session.md §1.2）")
struct EnvContractTests {
    @Test("darwin 全规则：删 CLAUDECODE / 兜底 TERM_PROGRAM / 兜底 LANG / 恒设 COLORTERM+TERM+ID / 保留其余")
    func darwinFullContract() {
        let base = [
            "CLAUDECODE": "1",
            "SHELL": "/bin/zsh",
            "PATH": "/usr/bin:/bin",
            "LANG": "C",
        ]
        let env = EnvContract.build(base: base, terminalID: "T-abc", isDarwin: true)

        #expect(env["CLAUDECODE"] == nil) // 删
        #expect(env["TERM_PROGRAM"] == "Apple_Terminal") // darwin 未设 → 注入
        #expect(env["LANG"] == "en_US.UTF-8") // C → 兜底
        #expect(env["COLORTERM"] == "truecolor") // 新增恒设
        #expect(env["TERM"] == "xterm-256color") // 已裁决⑨恒设
        #expect(env["MUXVO_TERM_ID"] == "T-abc") // 注入会话 UUID
        #expect(env["SHELL"] == "/bin/zsh") // 保留
        #expect(env["PATH"] == "/usr/bin:/bin") // 保留
    }

    @Test("TERM_PROGRAM 已设时保留（仅未设才兜底注入）")
    func termProgramNotOverwritten() {
        let env = EnvContract.build(
            base: ["TERM_PROGRAM": "iTerm.app"], terminalID: "X", isDarwin: true)
        #expect(env["TERM_PROGRAM"] == "iTerm.app")
    }

    @Test("LANG 语义：缺失/C/POSIX 兜底，有效 UTF-8 保留")
    func langFallbackRules() {
        // 缺失 → 兜底
        #expect(EnvContract.build(base: [:], terminalID: "X", isDarwin: true)["LANG"] == "en_US.UTF-8")
        // C → 兜底
        #expect(EnvContract.build(base: ["LANG": "C"], terminalID: "X", isDarwin: true)["LANG"] == "en_US.UTF-8")
        // POSIX → 兜底
        #expect(EnvContract.build(base: ["LANG": "POSIX"], terminalID: "X", isDarwin: true)["LANG"] == "en_US.UTF-8")
        // 有效 UTF-8 → 保留
        #expect(EnvContract.build(base: ["LANG": "zh_CN.UTF-8"], terminalID: "X", isDarwin: true)["LANG"] == "zh_CN.UTF-8")
    }

    @Test("非 darwin：TERM_PROGRAM/LANG 两条兜底不生效；CLAUDECODE 删、COLORTERM/TERM/ID 恒设不变")
    func nonDarwinSkipsFallbacks() {
        let env = EnvContract.build(
            base: ["CLAUDECODE": "1", "LANG": "C"], terminalID: "L", isDarwin: false)
        #expect(env["CLAUDECODE"] == nil) // 删（不分平台）
        #expect(env["TERM_PROGRAM"] == nil) // 非 darwin 不注入
        #expect(env["LANG"] == "C") // 非 darwin 不兜底
        #expect(env["COLORTERM"] == "truecolor")
        #expect(env["TERM"] == "xterm-256color")
        #expect(env["MUXVO_TERM_ID"] == "L")
    }

    @Test("常量与合同值对齐")
    func contractConstants() {
        #expect(EnvContract.deletedKeys == ["CLAUDECODE", "MUXVO_HOOK_SOCK"])
        #expect(EnvContract.defaultTermProgram == "Apple_Terminal")
        #expect(EnvContract.fallbackLang == "en_US.UTF-8")
        #expect(EnvContract.term == "xterm-256color")
        #expect(EnvContract.colorterm == "truecolor")
        #expect(EnvContract.terminalIDKey == "MUXVO_TERM_ID")
        #expect(EnvContract.hookSocketKey == "MUXVO_HOOK_SOCK")
    }

    @Test("MUXVO_HOOK_SOCK 恒删继承值（嵌套 muxvo 防串线，title-sync 批对抗 MINOR-3）")
    func hookSockInheritanceStripped() {
        // 嵌套场景：本 app 从 A 分身 muxvo 终端启动，environ 带 A 注入的路由值 → 必须剥离
        // （grid 终端由 configTemplate extraEnv 显式重注本 app 路径；worker/takeover 不注 →
        // 脚本 ${MUXVO_HOOK_SOCK:-…} 回落各自 app 烘焙默认）。
        let env = EnvContract.build(
            base: ["MUXVO_HOOK_SOCK": "/A分身/run/hook.sock"], terminalID: "N", isDarwin: true)
        #expect(env["MUXVO_HOOK_SOCK"] == nil, "继承的路由值被剥离")
    }
}
