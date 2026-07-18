// 原生更新弹窗文案（specs/behavior/auto-update.md §2/§4/§10 逐字表；中文硬编码不随 language，
// legacy dialog.showMessageBox 对等）。测试侧断言一律用字面量硬编码、禁 import 本常量（防互抄回路，
// auto-update.md §12 UPD_dialog_copy_*）。

import Foundation

public enum UpdateCopy {
    /// 发现新版三按钮弹窗（legacy index.ts:772-780）。buttons[0] = default。
    public static func availableRequest(version: String) -> UpdateDialogRequest {
        UpdateDialogRequest(
            title: "Muxvo 有可用更新",
            message: "发现新版本 v\(version)",
            detail: "下载在后台进行，不影响当前工作。下次启动时自动安装更新。",
            buttons: ["立即下载", "暂不更新", "不再提醒此版本"]
        )
    }

    /// 下载完成两按钮弹窗（legacy index.ts:847-855）。buttons[0] = default。
    public static func downloadedRequest(version: String) -> UpdateDialogRequest {
        UpdateDialogRequest(
            title: "下载完成",
            message: "v\(version) 已下载完成",
            detail: "立即重启安装，还是下次启动时自动安装？",
            buttons: ["立即重启", "下次启动时安装"]
        )
    }
}
