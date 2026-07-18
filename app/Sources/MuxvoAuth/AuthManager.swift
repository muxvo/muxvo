// 账号管理器（右上角批 B5；legacy auth-manager.ts + AuthContext 行为对齐）：
//   - 启动 tryRestoreSession：存量 token → /user/me；失败 → refresh 再试；再败 → 清 token（legacy 三段）。
//   - OAuth：/auth/{provider}/init → 系统浏览器（openURL 注入缝）→ **轮询 /auth/poll 每 2s×60**
//     （legacy 服务器实践：回调页是纯 HTML，token 经 Redis 轮询交付；深链不做——bridge-v1.md §8）。
//   - 12 分钟定时预刷新（access 15min 前置量，legacy TOKEN_REFRESH_INTERVAL_MS）；刷新失败 →
//     清 token + sessionExpired 推送。
//   - logout：尽力 POST /auth/logout（服务端吊销），本地**必**登出（legacy 同语义）。
// @MainActor 单例（app 级）；时钟/sleep 注入缝供测试快进。
import Foundation
import os

/// 模块内日志（Log 枚举属 MuxvoAppCore internal，此处直用 os.Logger 同子系统惯例）。
private let authLog = Logger(subsystem: "com.muxvo.app", category: "auth")

/// 登录态快照（桥 AuthView 的源；名字避开 MuxvoBridge.AuthView 防跨模块混淆）。
public struct AuthSnapshot: Equatable, Sendable {
    public var loggedIn: Bool
    public var user: AuthUser?
    public init(loggedIn: Bool, user: AuthUser? = nil) {
        self.loggedIn = loggedIn
        self.user = user
    }
}

@MainActor
public final class AuthManager {
    public nonisolated static let refreshIntervalMs: UInt64 = 12 * 60 * 1000 // legacy 12min
    public nonisolated static let pollIntervalMs: UInt64 = 2_000 // legacy 2s
    public nonisolated static let pollMaxAttempts = 60 // legacy 60 次 = 2 分钟

    private let client: AuthBackendClient
    private let store: AuthTokenStore
    private let openURL: @MainActor (URL) -> Void
    private let sleepMs: @Sendable (UInt64) async -> Void

    private var current: StoredAuth?
    private var refreshTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?

    /// 登录态变更推送（装配层 fan-out data.event authStatusChanged 至全窗）。
    public var onStatusChanged: (@MainActor (AuthSnapshot) -> Void)?
    /// 会话过期推送（刷新失败/恢复失败——data.event authSessionExpired）。
    public var onSessionExpired: (@MainActor () -> Void)?

    public init(
        client: AuthBackendClient,
        store: AuthTokenStore,
        openURL: @escaping @MainActor (URL) -> Void,
        sleepMs: @escaping @Sendable (UInt64) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: ms * 1_000_000)
        }
    ) {
        self.client = client
        self.store = store
        self.openURL = openURL
        self.sleepMs = sleepMs
    }

    // MARK: - 状态

    public var statusView: AuthSnapshot {
        AuthSnapshot(loggedIn: current != nil, user: current?.user)
    }

    private func adopt(_ tokens: AuthTokens, provider: String, fallbackEmail: String? = nil) async {
        // 档案取自 /user/me（displayName/email/avatarUrl）；失败不阻塞登录（用回退名）。
        let profile = try? await client.profile(accessToken: tokens.accessToken)
        let user = AuthUser(
            username: profile?.displayName ?? profile?.email ?? fallbackEmail ?? "user",
            email: profile?.email ?? fallbackEmail,
            avatarUrl: profile?.avatarUrl,
            provider: provider)
        let stored = StoredAuth(tokens: tokens, user: user)
        current = stored
        try? store.save(stored)
        startRefreshLoop()
        onStatusChanged?(statusView)
    }

    private func dropSession(expired: Bool) {
        refreshTask?.cancel()
        refreshTask = nil
        pollTask?.cancel()
        pollTask = nil
        current = nil
        store.clear()
        if expired { onSessionExpired?() }
        onStatusChanged?(statusView)
    }

    // MARK: - 启动恢复（legacy tryRestoreSession 三段）

    public func tryRestoreSession() async {
        guard let stored = store.load() else { return }
        current = stored
        // ① 存量 access → /user/me 直验。
        if let profile = try? await client.profile(accessToken: stored.tokens.accessToken) {
            refreshUserFromProfile(profile, stored: stored)
            startRefreshLoop()
            onStatusChanged?(statusView)
            return
        }
        // ② refresh 换新对再验。
        if let fresh = try? await client.refresh(refreshToken: stored.tokens.refreshToken) {
            let updated = StoredAuth(tokens: fresh, user: stored.user)
            current = updated
            try? store.save(updated)
            if let profile = try? await client.profile(accessToken: fresh.accessToken) {
                refreshUserFromProfile(profile, stored: updated)
            }
            startRefreshLoop()
            onStatusChanged?(statusView)
            return
        }
        // ③ 双败 → 清 token 静默登出（首启形态，不弹过期——legacy restore 失败即 LoggedOut）。
        authLog.notice("auth 恢复失败（access+refresh 双败）→ 清 token 重登")
        dropSession(expired: false)
    }

    private func refreshUserFromProfile(_ profile: BackendProfile, stored: StoredAuth) {
        let provider = stored.user?.provider ?? "email"
        let user = AuthUser(
            username: profile.displayName ?? profile.email ?? stored.user?.username ?? "user",
            email: profile.email ?? stored.user?.email,
            avatarUrl: profile.avatarUrl ?? stored.user?.avatarUrl,
            provider: provider)
        let updated = StoredAuth(tokens: stored.tokens, user: user)
        current = updated
        try? store.save(updated)
    }

    // MARK: - OAuth（init → 浏览器 → 轮询交付）

    /// 返回即表示「已开浏览器 + 已起轮询」（桥 authAck）；成败经 onStatusChanged 推送。
    public func loginOAuth(provider: String) async throws {
        let initResult = try await client.oauthInit(provider: provider)
        guard let url = URL(string: initResult.authUrl) else {
            throw AuthError(.server, "oauth init: bad authUrl")
        }
        openURL(url)
        pollTask?.cancel()
        let state = initResult.state
        pollTask = Task { [weak self] in
            for _ in 0..<Self.pollMaxAttempts {
                guard let self, !Task.isCancelled else { return }
                await self.sleepMs(Self.pollIntervalMs)
                guard !Task.isCancelled else { return }
                if case let .tokens(tokens)? = try? await self.client.oauthPoll(state: state) {
                    guard !Task.isCancelled else { return } // 登出/重入已取消 → 丢弃迟到 tokens（MINOR-7）
                    await self.adopt(tokens, provider: provider)
                    return
                }
            }
            // 60 次未果：轮询侧静默停（web 侧自有 2 分钟超时文案，legacy 同构双侧计时）。
        }
    }

    // MARK: - 邮箱/密码流

    public func loginPassword(email: String, password: String) async throws {
        let tokens = try await client.passwordLogin(email: email, password: password)
        await adopt(tokens, provider: "email", fallbackEmail: email)
    }

    public func register(email: String, code: String, password: String) async throws {
        let tokens = try await client.register(email: email, code: code, password: password)
        await adopt(tokens, provider: "email", fallbackEmail: email)
    }

    public func sendEmailCode(email: String, purpose: String) async throws {
        // purpose：register / reset-password（服务端枚举；桥层 AuthCodePurpose.reset → reset-password）
        try await client.sendEmailCode(email: email, purpose: purpose)
    }

    public func resetPassword(email: String, code: String, newPassword: String) async throws {
        try await client.resetPassword(email: email, code: code, newPassword: newPassword)
        // legacy：重置成功服务端吊销全部 token，不自动登录；本地若在登录态则登出（罕见路径）。
        if current != nil { dropSession(expired: false) }
    }

    public func logout() async {
        let refreshToken = current?.tokens.refreshToken
        // 尽力吊销（失败也本地登出——legacy 同语义）。
        if let refreshToken { try? await client.logout(refreshToken: refreshToken) }
        dropSession(expired: false)
    }

    // MARK: - 定时刷新（12min；失败 → 过期推送）

    private func startRefreshLoop() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.sleepMs(Self.refreshIntervalMs)
                guard !Task.isCancelled else { return }
                guard let stored = self.current else { return }
                if let fresh = try? await self.client.refresh(refreshToken: stored.tokens.refreshToken) {
                    let updated = StoredAuth(tokens: fresh, user: stored.user)
                    self.current = updated
                    try? self.store.save(updated)
                } else {
                    authLog.notice("auth 定时刷新失败 → 会话过期登出")
                    self.dropSession(expired: true)
                    return
                }
            }
        }
    }
}
