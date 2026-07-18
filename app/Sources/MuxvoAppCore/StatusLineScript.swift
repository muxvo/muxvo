// StatusLineScript：CC 用量传感器脚本内容 + 安装路径派生（usage-limit-alert.md §2）。
//
// 脚本以 Swift 常量承载、安装时**生成式写出**（同 HookScript 两理由：MuxvoApp/Resources 被
// Package.swift exclude 且 Package.swift 冻结；内容须同时被 StatusLineInstaller 与 bash 脚本
// 测试引用）。顶部 `# muxvo-statusline-version: N` 指纹行供 drift 自检（§3）。
//
// 脚本行为（§2 硬约束）：读 stdin JSON → 提取 rate_limits 两窗口 → 同目录 mktemp+rename 原子写
// `<dataRoot>/run/usage-status.json` → stdout 输出模板（v1 空串=静默，用户拍板 2026-07-11）。
// 任何异常一律 exit 0 绝不污染 CC 终端；无 jq 依赖（/usr/bin/python3，缺失 bash 层秒退 0）。
//
// **本文件不出现数据根字面**（数据目录字面纪律：只许 DataDirectory.swift）：usage-status.json
// 绝对路径由调用方（StatusLineInstaller）从 dataRoot 派生注入。
import Foundation

public enum StatusLineScript {
    /// 脚本指纹版本（内容变更即 +1，触发 drift 自检重装，§3）。
    public static let version = 1

    /// 传感器脚本文件名（装 `<dataRoot>/hooks/` 下，与 muxvo-hook.sh 同目录）。
    public static let scriptFileName = "muxvo-statusline.sh"

    /// settings.json 识别子串（§3：statusLine.command 含此子串 = muxvo 的，幂等/可逆）。
    public static let identifierSubstring = "muxvo-statusline.sh"

    /// stdout 输出模板（§2）：**空串 = 终端不显示任何文字（静默，用户拍板）**。要恢复显示改此常量
    /// 为固定文本；带百分比的动态显示需在脚本 python 段自行格式化（届时 version +1 触发重装）。
    static let outputTemplate = ""

    /// 传感器脚本全文（§2）。
    /// - Parameter usageStatusPath: `<dataRoot>/run/usage-status.json` 绝对路径（调用方从
    ///   DataDirectory 派生；不在本文件硬编码，见文件头字面纪律）。
    public static func scriptText(usageStatusPath: String) -> String {
        // python 段嵌在 bash 单引号内——python 源码中**不得出现单引号**（含注释撇号）。
        """
        #!/bin/bash
        # Muxvo usage-limit sensor — CC statusline 传感器（usage-limit-alert.md §2）
        # muxvo-statusline-version: \(version)
        # 静默硬约束：任何异常一律 exit 0，绝不污染 CC 终端。
        [ -x /usr/bin/python3 ] || exit 0
        exec /usr/bin/python3 -c '
        import json,os,sys,tempfile,time
        try:
            data=json.load(sys.stdin)
            rl=data.get("rate_limits") or {}
            out={"writtenAtMs":int(time.time()*1000)}
            for src,dst in (("five_hour","fiveHour"),("seven_day","sevenDay")):
                w=rl.get(src) or {}
                pct=w.get("used_percentage")
                resets=w.get("resets_at")
                if isinstance(pct,(int,float)) and isinstance(resets,(int,float)):
                    out[dst]={"usedPct":float(pct),"resetsAt":int(resets)}
            path=sys.argv[1]
            d=os.path.dirname(path)
            os.makedirs(d,exist_ok=True)
            fd,tmp=tempfile.mkstemp(dir=d,prefix=".usage-status-")
            with os.fdopen(fd,"w") as f:
                json.dump(out,f)
            os.replace(tmp,path)
        except Exception:
            pass
        sys.stdout.write("\(outputTemplate)")
        ' "\(usageStatusPath)"

        """
    }

    /// settings.json 的 statusLine.command 串（§3 确切形状）：`"<scriptPath>"`（引号裹路径含空格）。
    public static func command(scriptPath: String) -> String {
        "\"\(scriptPath)\""
    }

    // MARK: 路径派生（dev 数据根由调用方注入，字面只在 DataDirectory.swift）

    /// 脚本文件 `<dataRoot>/hooks/muxvo-statusline.sh`（与 HookScript 同 hooks 目录）。
    public static func scriptURL(dataRoot: URL) -> URL {
        dataRoot.appendingPathComponent("hooks", isDirectory: true)
            .appendingPathComponent(scriptFileName)
    }

    /// 传感器产出文件 `<dataRoot>/run/usage-status.json`（脚本写 + UsageLimitWatcher 读共用此唯一派生）。
    public static func usageStatusURL(dataRoot: URL) -> URL {
        dataRoot.appendingPathComponent("run", isDirectory: true)
            .appendingPathComponent("usage-status.json")
    }
}
