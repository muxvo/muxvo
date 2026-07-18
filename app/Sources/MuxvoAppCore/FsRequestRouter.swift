// FsRequestRouter：fs.request 文件能力分发（plan-native §5.2；M6 批B 增 readFile/writeFile）。
//
// @MainActor async：readDir / readFile / writeFile / worktree 三态 await 后台服务；showFileMenu 经**注入的 anchor 闭包**弹
// NSMenu（同步跑嵌套 event-tracking runloop，收起后回；anchor 注入 → Router 可单测，CompositeRoot 不长胖）。
// worktreeCreate/Remove 成功后回调 onWorktreeMutation（装配层接 GitStatusCache 失效+重探）。
import MuxvoBridge

@MainActor
public final class FsRequestRouter {
    private let fsService: FsService
    private let worktreeService: InteractiveWorktreeService
    /// showFileMenu anchor（cssX, cssY, isDirectory）→ 用户选中的动作（或 dismissed）。生产 = CompositeRoot.popUpFileMenu。
    private let showFileMenu: (Double, Double, Bool) -> FileMenuAction

    /// worktree 变更成功回调（装配层接 cache.invalidate(prefix:)）。create → repoPath；remove → worktreePath。
    public var onWorktreeMutation: ((String) -> Void)?

    public init(
        fsService: FsService,
        worktreeService: InteractiveWorktreeService,
        showFileMenu: @escaping (Double, Double, Bool) -> FileMenuAction
    ) {
        self.fsService = fsService
        self.worktreeService = worktreeService
        self.showFileMenu = showFileMenu
    }

    public func handle(_ request: FsRequest) async -> FsResponse {
        switch request {
        case let .readDir(path):
            return await fsService.readDir(path: path)
        case let .showFileMenu(path, isDirectory, x, y):
            // 弹菜单（阻塞至收起）→ native 自执行副作用 → 回「执行了哪个」（未选 = dismissed）。
            let action = showFileMenu(x, y, isDirectory)
            fsService.performMenuAction(action, path: path)
            return .menuAction(action: action)
        case let .worktreeStatus(cwd):
            return await worktreeService.status(cwd: cwd)
        case let .worktreeCreate(repoPath):
            let resp = await worktreeService.create(repoPath: repoPath)
            if case .worktreeCreated = resp { onWorktreeMutation?(repoPath) }
            return resp
        case let .worktreeRemove(worktreePath):
            let resp = await worktreeService.remove(worktreePath: worktreePath)
            if case .worktreeRemoved = resp { onWorktreeMutation?(worktreePath) }
            return resp
        case let .readFile(path, encoding):
            return await fsService.readFile(path: path, encoding: encoding)
        case let .writeFile(path, content, baseMtimeMs):
            return await fsService.writeFile(path: path, content: content, baseMtimeMs: baseMtimeMs)
        @unknown default:
            // 协议未来新增的 fs 变体（防御；已知变体均在上方显式分流）。
            return .rejected(code: "INTERNAL", message: "FsRequestRouter 不支持的 fs 变体")
        }
    }
}
