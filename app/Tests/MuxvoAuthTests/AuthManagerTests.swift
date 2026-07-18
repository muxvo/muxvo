// AuthManager/BackendClient/TokenStore 直测（右上角批 B5；login-modal.md §5 / bridge-v1.md §8）。
// 假 transport 按路径路由剧本响应——永不打真网；sleep 注入缝即时返回（轮询/刷新快进）。
// 案例池：login-modal.md §6.1 AUTH_*（spec-coverage 强制 1:1）。只碰 $TMPDIR。
import Foundation
import Testing
@testable import MuxvoAuth

/// 剧本假 transport：按 (method, path) 出队响应；越界 → 抛网络错。@unchecked Sendable：测试内
/// 单线程消费（manager @MainActor），锁保护防御并发轮询。
final class FakeTransport: AuthTransport, @unchecked Sendable {
    struct Stub {
        let path: String
        let status: Int
        let body: [String: Any]
    }

    private let lock = NSLock()
    private var queue: [Stub]
    private(set) var seenPaths: [String] = []

    init(_ stubs: [Stub]) {
        queue = stubs
    }

    /// 同步临界区（async 上下文禁直调 lock/unlock → withLock 包裹）。
    private func dequeue(path: String) -> Stub? {
        lock.withLock {
            seenPaths.append(path)
            guard let idx = queue.firstIndex(where: { $0.path == path }) else { return nil }
            return queue.remove(at: idx)
        }
    }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        let path = request.url?.path ?? ""
        guard let stub = dequeue(path: path) else {
            throw AuthError(.network, "no stub for \(path)")
        }
        let data = try JSONSerialization.data(withJSONObject: stub.body)
        return (data, stub.status)
    }
}

@Suite("AuthManager 全流（假 transport，B5）", .serialized)
@MainActor
struct AuthManagerTests {

    private func makeTempFile() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-auth-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("auth-token.json")
    }

    /// 默认测试 sleep：轮询（2s 档）即时返回；**刷新（12min 档）挂起到取消**——否则登录成功
    /// 后刷新循环在注入即时 sleep 下立刻跑第一轮，无 /auth/refresh stub 即触发意外登出，
    /// 令既有断言与 detached Task 赛跑（对抗验收线索回修）。
    static let defaultTestSleep: @Sendable (UInt64) async -> Void = { ms in
        if ms >= AuthManager.refreshIntervalMs {
            while !Task.isCancelled { try? await Task.sleep(nanoseconds: 50_000_000) }
        }
    }

    private func makeManager(
        _ stubs: [FakeTransport.Stub], tokenFile: URL? = nil,
        openURL: @escaping @MainActor (URL) -> Void = { _ in },
        sleepMs: @escaping @Sendable (UInt64) async -> Void = AuthManagerTests.defaultTestSleep
    ) -> (AuthManager, FakeTransport, AuthTokenStore) {
        let transport = FakeTransport(stubs)
        let store = AuthTokenStore(fileURL: tokenFile ?? makeTempFile())
        let manager = AuthManager(
            client: AuthBackendClient(baseURL: URL(string: "https://fake.test")!, transport: transport, env: [:]),
            store: store,
            openURL: openURL,
            sleepMs: sleepMs)
        return (manager, transport, store)
    }

    private let profileStub = FakeTransport.Stub(
        path: "/user/me", status: 200,
        body: ["displayName": "阿蓝", "email": "a@b.co", "avatarUrl": "https://img/x.png"])

    @Test("AUTH_password_login_flow：密码登录 → /user/me 档案 → 登录态推送 + token 0600 落盘")
    func passwordLoginFlow() async throws {
        let file = makeTempFile()
        let (manager, _, store) = makeManager([
            .init(path: "/auth/password/login", status: 200,
                  body: ["accessToken": "acc-1", "refreshToken": "ref-1"]),
            profileStub,
        ], tokenFile: file)
        var pushes: [AuthSnapshot] = []
        manager.onStatusChanged = { pushes.append($0) }

        try await manager.loginPassword(email: "a@b.co", password: "12345678")

        #expect(manager.statusView.loggedIn == true)
        #expect(manager.statusView.user?.username == "阿蓝")
        #expect(manager.statusView.user?.provider == "email")
        #expect(pushes.last?.loggedIn == true)
        // token 明文 0600 落盘（legacy 语义）
        let attrs = try FileManager.default.attributesOfItem(atPath: file.path)
        #expect((attrs[.posixPermissions] as? Int) == 0o600)
        #expect(store.load()?.tokens.accessToken == "acc-1")
    }

    @Test("AUTH_password_login_rejected：401 → AUTH_INVALID_CREDENTIALS 稳定码（不入登录态）")
    func passwordLoginRejected() async {
        let (manager, _, _) = makeManager([
            .init(path: "/auth/password/login", status: 401, body: ["message": "Invalid email or password"]),
        ])
        do {
            try await manager.loginPassword(email: "a@b.co", password: "bad")
            Issue.record("应抛错")
        } catch let e as AuthError {
            #expect(e.code == .invalidCredentials)
        } catch {
            Issue.record("错误类型应为 AuthError")
        }
        #expect(manager.statusView.loggedIn == false)
    }

    @Test("AUTH_oauth_poll_flow：init 开浏览器 → 轮询 pending→tokens → adopt 推送登录")
    func oauthPollFlow() async throws {
        var opened: [URL] = []
        let (manager, transport, _) = makeManager([
            .init(path: "/auth/github/init", status: 200,
                  body: ["authUrl": "https://github.com/login/oauth/authorize?x=1", "state": "st-1"]),
            .init(path: "/auth/poll", status: 200, body: ["pending": true]),
            .init(path: "/auth/poll", status: 200,
                  body: ["pending": false, "accessToken": "acc-oa", "refreshToken": "ref-oa"]),
            profileStub,
        ], openURL: { opened.append($0) })
        var pushes: [AuthSnapshot] = []
        manager.onStatusChanged = { pushes.append($0) }

        try await manager.loginOAuth(provider: "github")
        #expect(opened.count == 1, "系统浏览器已开（NSWorkspace 注入缝）")
        // 轮询 Task 异步跑（sleep 快进）：等登录态收敛。
        for _ in 0..<200 where !manager.statusView.loggedIn {
            await Task.yield()
        }
        #expect(manager.statusView.loggedIn == true)
        #expect(manager.statusView.user?.provider == "github")
        #expect(transport.seenPaths.filter { $0 == "/auth/poll" }.count == 2)
    }

    @Test("AUTH_restore_three_stage：①存量 access 直验 ②refresh 换对再验 ③双败清 token")
    func restoreThreeStage() async throws {
        // ① access 直验成功
        let f1 = makeTempFile()
        try AuthTokenStore(fileURL: f1).save(StoredAuth(
            tokens: AuthTokens(accessToken: "a1", refreshToken: "r1"),
            user: AuthUser(username: "旧名", provider: "github")))
        let (m1, _, _) = makeManager([profileStub], tokenFile: f1)
        await m1.tryRestoreSession()
        #expect(m1.statusView.loggedIn == true)
        #expect(m1.statusView.user?.username == "阿蓝", "档案从 /user/me 刷新")
        #expect(m1.statusView.user?.provider == "github", "provider 保留登录时值")

        // ② access 失败 → refresh 成功
        let f2 = makeTempFile()
        try AuthTokenStore(fileURL: f2).save(StoredAuth(
            tokens: AuthTokens(accessToken: "stale", refreshToken: "r2"),
            user: AuthUser(username: "u", provider: "email")))
        let (m2, _, s2) = makeManager([
            .init(path: "/user/me", status: 401, body: ["message": "expired"]),
            .init(path: "/auth/refresh", status: 200,
                  body: ["accessToken": "a2new", "refreshToken": "r2new"]),
            profileStub,
        ], tokenFile: f2)
        await m2.tryRestoreSession()
        #expect(m2.statusView.loggedIn == true)
        #expect(s2.load()?.tokens.accessToken == "a2new", "新 token 对已落盘（旋转）")

        // ③ 双败 → 清 token
        let f3 = makeTempFile()
        try AuthTokenStore(fileURL: f3).save(StoredAuth(
            tokens: AuthTokens(accessToken: "dead", refreshToken: "deadr"), user: nil))
        let (m3, _, s3) = makeManager([
            .init(path: "/user/me", status: 401, body: ["message": "expired"]),
            .init(path: "/auth/refresh", status: 401, body: ["message": "reuse detected"]),
        ], tokenFile: f3)
        await m3.tryRestoreSession()
        #expect(m3.statusView.loggedIn == false)
        #expect(s3.load() == nil, "token 文件已清")
    }

    @Test("AUTH_logout_local_always：服务端吊销失败也本地登出（清 token + 推送未登录）")
    func logoutLocalAlways() async throws {
        let file = makeTempFile()
        let (manager, _, store) = makeManager([
            .init(path: "/auth/password/login", status: 200,
                  body: ["accessToken": "acc", "refreshToken": "ref"]),
            profileStub,
            // /auth/logout 无 stub → transport 抛网络错（吊销失败路径）
        ], tokenFile: file)
        try await manager.loginPassword(email: "a@b.co", password: "12345678")
        var pushes: [AuthSnapshot] = []
        manager.onStatusChanged = { pushes.append($0) }

        await manager.logout()

        #expect(manager.statusView.loggedIn == false)
        #expect(store.load() == nil)
        #expect(pushes.last?.loggedIn == false)
    }

    @Test("AUTH_reset_no_autologin：重置密码成功 → authAck 语义（不自动登录）")
    func resetNoAutologin() async throws {
        let (manager, _, _) = makeManager([
            .init(path: "/auth/password/reset", status: 200, body: ["success": true]),
        ])
        try await manager.resetPassword(email: "a@b.co", code: "123456", newPassword: "12345678")
        #expect(manager.statusView.loggedIn == false)
    }

    @Test("AUTH_error_code_map：服务端文案 → 稳定码（凭据/验证码/占用/限频/兜底）")
    func errorCodeMap() {
        #expect(AuthError.fromServer(status: 401, message: "Invalid email or password").code == .invalidCredentials)
        #expect(AuthError.fromServer(status: 400, message: "Invalid verification code").code == .codeInvalid)
        #expect(AuthError.fromServer(status: 409, message: "Email already registered").code == .emailTaken)
        #expect(AuthError.fromServer(status: 429, message: "Too many attempts").code == .rateLimited)
        #expect(AuthError.fromServer(status: 500, message: "boom").code == .server)
    }

    @Test("AUTH_token_store_corrupt：损坏文件 → load nil + 文件被清（强制重登，legacy 语义）")
    func tokenStoreCorrupt() throws {
        let file = makeTempFile()
        try Data("not json".utf8).write(to: file)
        let store = AuthTokenStore(fileURL: file)
        #expect(store.load() == nil)
        #expect(!FileManager.default.fileExists(atPath: file.path))
    }

    /// 刷新档 sleep 放行一次后挂起（后续迭代冻结，循环行为可一步一验）。
    private static func oneShotRefreshSleep() -> @Sendable (UInt64) async -> Void {
        let counter = CounterBox()
        return { ms in
            if ms >= AuthManager.refreshIntervalMs {
                if counter.next() > 1 {
                    while !Task.isCancelled { try? await Task.sleep(nanoseconds: 50_000_000) }
                }
            }
        }
    }

    @Test("AUTH_refresh_rotation：12min 刷新档触发 → 新 token 对落盘（登录态保持）")
    func refreshRotation() async throws {
        let file = makeTempFile()
        let (manager, _, store) = makeManager([
            .init(path: "/auth/password/login", status: 200,
                  body: ["accessToken": "acc-old", "refreshToken": "ref-old"]),
            profileStub,
            .init(path: "/auth/refresh", status: 200,
                  body: ["accessToken": "acc-rot", "refreshToken": "ref-rot"]),
        ], tokenFile: file, sleepMs: Self.oneShotRefreshSleep())
        try await manager.loginPassword(email: "a@b.co", password: "12345678")
        // 刷新循环第一轮（放行档）异步跑 → 等新对落盘。
        for _ in 0..<400 where store.load()?.tokens.accessToken != "acc-rot" {
            await Task.yield()
        }
        #expect(store.load()?.tokens.accessToken == "acc-rot", "刷新旋转新对已落盘")
        #expect(manager.statusView.loggedIn == true, "旋转期间登录态保持")
    }

    @Test("AUTH_refresh_expiry：刷新失败 → 清 token + sessionExpired 推送（legacy REFRESH_FAILED）")
    func refreshExpiry() async throws {
        let file = makeTempFile()
        let (manager, _, store) = makeManager([
            .init(path: "/auth/password/login", status: 200,
                  body: ["accessToken": "acc", "refreshToken": "ref"]),
            profileStub,
            .init(path: "/auth/refresh", status: 401, body: ["message": "reuse detected"]),
        ], tokenFile: file, sleepMs: Self.oneShotRefreshSleep())
        try await manager.loginPassword(email: "a@b.co", password: "12345678")
        var expiredFired = false
        manager.onSessionExpired = { expiredFired = true }
        for _ in 0..<400 where manager.statusView.loggedIn {
            await Task.yield()
        }
        #expect(manager.statusView.loggedIn == false, "刷新失败登出")
        #expect(expiredFired, "sessionExpired 推送")
        #expect(store.load() == nil, "token 已清")
    }
}

/// 跨并发计数盒（sleep 闭包 @Sendable 内计数）。
final class CounterBox: @unchecked Sendable {
    private let lock = NSLock()
    private var n = 0
    func next() -> Int { lock.withLock { n += 1; return n } }
}
