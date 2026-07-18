// 错误口径 + 数据保留 spec 归属（M7 批4）。
// 规格：specs/legacy/l1/cross.spec.json（ERROR_L1_02 error.codes / ERROR_L1_03 error.categories）+
// l2/boundaries.spec.json（APP_L2_01 data-retention）。冻结 spec 值逐字硬编码断言。

import Foundation
import Testing
@testable import MuxvoPerf

@Suite("错误口径与数据保留（M7 批4）")
struct ErrorRetentionTests {

    @Test("ERROR_L1_02: error.codes 枚举含全 7 码；active/reserved 二分（后四 = 市场/登录保留码，J3）")
    func errorCodesEnum() {
        // 冻结 spec 全 7 码逐字（顺序即声明序）。
        #expect(MuxvoErrorCode.allCases.map(\.rawValue) == [
            "SPAWN_FAILED",
            "FILE_READ_ERROR",
            "NETWORK_ERROR",
            "INSTALL_FAILED",
            "SCORE_FAILED",
            "AUTH_FAILED",
            "PUBLISH_BLOCKED",
        ])
        // J3 reserved 处置：前三活跃、后四保留（市场 D5 关死 / 登录移出 V1）。
        #expect(MuxvoErrorCode.active == [.spawnFailed, .fileReadError, .networkError])
        #expect(MuxvoErrorCode.reserved == [.installFailed, .scoreFailed, .authFailed, .publishBlocked])
        // active ∪ reserved = 全集，无遗漏无重叠。
        #expect(Set(MuxvoErrorCode.active + MuxvoErrorCode.reserved) == Set(MuxvoErrorCode.allCases))
    }

    @Test("ERROR_L1_03: 错误三级分类 autoRecoverable / userActionRequired / blocking 成员逐字")
    func errorCategories() {
        #expect(ErrorTaxonomy.autoRecoverable == [
            "download retry", "JSONL skip", "file locked skip", "partial source fallback",
        ])
        #expect(ErrorTaxonomy.userActionRequired == [
            "process crash", "file read fail", "network offline", "permission error",
        ])
        #expect(ErrorTaxonomy.blocking == [
            "API key detected", "sensitive file detected", "integrity check failed",
        ])
        // 三级枚举齐备 + members(of:) 一致。
        #expect(ErrorSeverity.allCases == [.autoRecoverable, .userActionRequired, .blocking])
        #expect(ErrorTaxonomy.members(of: .blocking) == ErrorTaxonomy.blocking)
    }

    @Test("APP_L2_01: 数据保留策略 events 90 天 / daily_summary 365 天")
    func retentionPolicyBoundaries() {
        let policy = RetentionPolicy.default
        #expect(policy.eventsRetentionDays == 90)
        #expect(policy.dailySummaryRetentionDays == 365)
    }
}
