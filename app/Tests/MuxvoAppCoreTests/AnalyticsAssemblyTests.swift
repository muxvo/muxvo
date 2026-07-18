// AnalyticsAssembly 嗅探逻辑直测（analytics.md §5 AN_orch_finished_once / AN_auth_restore_not_login）。
// env 门 MUXVO_ANALYTICS=1 显式开 + MUXVO_API_URL 指本地不可达端口（永不打真网；buffer 只入不发，
// 断言面 = tracker.pendingEvents）。只碰 $TMPDIR。
import Foundation
import Testing
import MuxvoBridge
@testable import MuxvoAnalytics
@testable import MuxvoAppCore

@Suite("AnalyticsAssembly 嗅探（埋点批2）", .serialized)
@MainActor
struct AnalyticsAssemblyTests {

    private func makeAssembly() throws -> AnalyticsAssembly {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-aa-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: dir.appendingPathComponent("state", isDirectory: true), withIntermediateDirectories: true)
        return AnalyticsAssembly(
            dataRoot: dir,
            env: ["MUXVO_ANALYTICS": "1", "MUXVO_API_URL": "http://127.0.0.1:9"])
    }

    private func metrics(_ assembly: AnalyticsAssembly) -> [String] {
        assembly.tracker.pendingEvents.map(\.metric)
    }


    @Test("AN_auth_restore_not_login: 恢复期变更不计；启用观测后未登录→登录恰发 auth.login、登出发 auth.logout")
    func authRestoreNotLogin() async throws {
        let assembly = try makeAssembly()
        // 恢复期（beginAuthObservation 前）：tryRestoreSession 恢复登录态 → 不计。
        assembly.noteAuthStatus(loggedIn: true, provider: "github")
        #expect(!metrics(assembly).contains("auth.login"))
        // 恢复完成（此刻已登录）→ 之后登出/再登录才计。
        assembly.beginAuthObservation(initialLoggedIn: true)
        assembly.noteAuthStatus(loggedIn: false, provider: nil)
        #expect(metrics(assembly).filter { $0 == "auth.logout" }.count == 1)
        assembly.noteAuthStatus(loggedIn: true, provider: "google")
        let logins = assembly.tracker.pendingEvents.filter { $0.metric == "auth.login" }
        #expect(logins.count == 1)
        #expect(logins.first?.metadata["provider"] == "google")
        // 同态重复推送（login→login）不重报。
        assembly.noteAuthStatus(loggedIn: true, provider: "google")
        #expect(assembly.tracker.pendingEvents.filter { $0.metric == "auth.login" }.count == 1)
    }
}
