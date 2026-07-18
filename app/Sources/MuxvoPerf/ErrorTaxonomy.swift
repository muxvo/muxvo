// 错误口径（M7 批4）：错误码枚举（ERROR_L1_02）+ 三级分类（ERROR_L1_03）。
// 纯常量合同——从行为规格实现，旧 src/shared/errors/{error-codes,error-categories}.ts 只作说明书。
//
// J3 reserved 处置（ERROR_L1_02）：冻结 spec 列全 7 码，但后四码 INSTALL_FAILED/SCORE_FAILED/
// AUTH_FAILED/PUBLISH_BLOCKED 属 Skill 市场（D5 终裁关死）/登录（移出 V1 降级 fast-follow）功能，
// V1 无 live 生产者。处置 = 保留为 reserved（枚举含全 7 码，不破 spec 字节冻结），active/reserved
// 显式二分标注，overlay 注记说明后四码保留缘由。

import Foundation

// MARK: - 错误码枚举（ERROR_L1_02）

/// 全 7 错误码（rawValue = 冻结 spec 大写串）。
public enum MuxvoErrorCode: String, CaseIterable, Sendable {
    case spawnFailed = "SPAWN_FAILED"
    case fileReadError = "FILE_READ_ERROR"
    case networkError = "NETWORK_ERROR"
    case installFailed = "INSTALL_FAILED"       // reserved：Skill 市场安装（D5 关死）
    case scoreFailed = "SCORE_FAILED"           // reserved：Skill 市场评分（D5 关死）
    case authFailed = "AUTH_FAILED"             // reserved：登录（移出 V1）
    case publishBlocked = "PUBLISH_BLOCKED"     // reserved：Skill 市场发布（D5 关死）

    /// V1 有 live 语义的活跃码（终端 spawn / 文件读 / 网络）。
    public static let active: [MuxvoErrorCode] = [.spawnFailed, .fileReadError, .networkError]
    /// 市场/登录保留码（V1 无 live 生产者；功能复活时重走台账）。
    public static let reserved: [MuxvoErrorCode] = [.installFailed, .scoreFailed, .authFailed, .publishBlocked]
}

// MARK: - 三级分类（ERROR_L1_03）

/// 错误严重度三级（自动可恢复 / 需用户操作 / 阻断）。
public enum ErrorSeverity: String, CaseIterable, Sendable {
    case autoRecoverable
    case userActionRequired
    case blocking
}

/// 三级分类的成员清单（冻结 spec error.categories 逐字）。
public enum ErrorTaxonomy {
    /// 自动可恢复：下载重试 / JSONL 跳过 / 文件锁跳过 / 部分源回退。
    public static let autoRecoverable: [String] = [
        "download retry",
        "JSONL skip",
        "file locked skip",
        "partial source fallback",
    ]
    /// 需用户操作：进程崩溃 / 文件读失败 / 网络离线 / 权限错误。
    public static let userActionRequired: [String] = [
        "process crash",
        "file read fail",
        "network offline",
        "permission error",
    ]
    /// 阻断：检出 API key / 检出敏感文件 / 完整性校验失败。
    public static let blocking: [String] = [
        "API key detected",
        "sensitive file detected",
        "integrity check failed",
    ]

    /// 按严重度取成员清单。
    public static func members(of severity: ErrorSeverity) -> [String] {
        switch severity {
        case .autoRecoverable: return autoRecoverable
        case .userActionRequired: return userActionRequired
        case .blocking: return blocking
        }
    }
}
