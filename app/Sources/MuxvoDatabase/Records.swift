// 持久化形状（列类型贴 DB：state/kind/actor 用 String）。
// 领域语义（TaskState/TaskEventKind enum 与转换）在 MuxvoTaskEngine 层——依赖方向 TaskEngine→Database。
import Foundation
import GRDB

public struct TaskRecord: Codable, FetchableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "tasks"

    public var id: String
    public var title: String
    public var state: String
    public var parentTaskId: String?
    public var pipelineId: String?
    public var pipelineSeq: Int?
    public var repoPath: String?
    public var worktreePath: String?
    public var autonomyLevel: Int
    public var retries: Int
    public var maxRetries: Int
    public var interruptions: Int
    public var budgetTokens: Int64?
    public var budgetTurns: Int?
    public var harness: String?
    public var spec: String
    public var lastError: String?
    public var createdAt: Int64
    public var updatedAt: Int64
    public var startedAt: Int64?
    public var finishedAt: Int64?
    // M4a v2 护栏列（默认 nil，既有调用零改动）：
    public var verificationCommand: String? // 锁定的验收命令（auto-allow + 完成 gate，policy-audit §4 B-C1）
    public var accountId: String? // 撞 limit 切账号用（policy-audit §6 ①）
    // M4a v3 接管列（默认 nil，既有调用零改动）：
    public var sessionId: String? // SessionRegistry accepted 即回写（scheduler-worker §4.7⑤，SEC-17 含跨重启）
    // M4a v4 归档列（默认 nil，既有调用零改动）：
    public var archivedAt: Int64? // 软删归档时刻（task-center-panel §3 r13 deleteTask；投影快照过滤非空行）
    // M4b v5 brain 幂等列（默认 nil=人/面板录入不占索引；仅 brain create_task 盖内容派生键）：
    public var idempotencyKey: String? // sha256(规范化 repoPath ‖ 归一化 spec)；终态转移原子置 NULL 释放
    // M4c v6 pipeline 角色列（默认 nil=非 pipeline 单任务）：plan|execute|review|final_review
    // （= StageRole.rawValue）——运行期角色权威（非 seq 奇偶派生，pipeline-supervisor §2 r3）。
    public var stageRole: String?

    enum CodingKeys: String, CodingKey {
        case id, title, state, retries, harness, spec
        case parentTaskId = "parent_task_id"
        case pipelineId = "pipeline_id"
        case pipelineSeq = "pipeline_seq"
        case repoPath = "repo_path"
        case worktreePath = "worktree_path"
        case autonomyLevel = "autonomy_level"
        case maxRetries = "max_retries"
        case interruptions
        case budgetTokens = "budget_tokens"
        case budgetTurns = "budget_turns"
        case lastError = "last_error"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case startedAt = "started_at"
        case finishedAt = "finished_at"
        case verificationCommand = "verification_command"
        case accountId = "account_id"
        case sessionId = "session_id"
        case archivedAt = "archived_at"
        case idempotencyKey = "idempotency_key"
        case stageRole = "stage_role"
    }

    public init(
        id: String,
        title: String,
        state: String,
        parentTaskId: String? = nil,
        pipelineId: String? = nil,
        pipelineSeq: Int? = nil,
        repoPath: String? = nil,
        worktreePath: String? = nil,
        autonomyLevel: Int = 0,
        retries: Int = 0,
        maxRetries: Int = 3,
        interruptions: Int = 0,
        budgetTokens: Int64? = nil,
        budgetTurns: Int? = nil,
        harness: String? = nil,
        spec: String = "{}",
        lastError: String? = nil,
        createdAt: Int64,
        updatedAt: Int64,
        startedAt: Int64? = nil,
        finishedAt: Int64? = nil,
        verificationCommand: String? = nil,
        accountId: String? = nil,
        sessionId: String? = nil,
        archivedAt: Int64? = nil,
        idempotencyKey: String? = nil,
        stageRole: String? = nil
    ) {
        self.id = id
        self.title = title
        self.state = state
        self.parentTaskId = parentTaskId
        self.pipelineId = pipelineId
        self.pipelineSeq = pipelineSeq
        self.repoPath = repoPath
        self.worktreePath = worktreePath
        self.autonomyLevel = autonomyLevel
        self.retries = retries
        self.maxRetries = maxRetries
        self.interruptions = interruptions
        self.budgetTokens = budgetTokens
        self.budgetTurns = budgetTurns
        self.harness = harness
        self.spec = spec
        self.lastError = lastError
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.verificationCommand = verificationCommand
        self.accountId = accountId
        self.sessionId = sessionId
        self.archivedAt = archivedAt
        self.idempotencyKey = idempotencyKey
        self.stageRole = stageRole
    }
}

/// pipeline 实例行（pipeline-supervisor.md §2 r3，migration v6）：建 pipeline 时冻模板快照 + 软预算
/// 派生列。**pipeline 全生命周期只读 template_snapshot**（编辑/崩溃双稳，§2）；round/role 走 tasks 列
/// 派生、不入本表。`deadlineMs`/`startedAt` 为软预算派生（§6，默认 NULL=关）。
public struct PipelineRecord: Codable, FetchableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "pipelines"

    public var pipelineId: String
    public var templateId: String
    public var templateSnapshot: String // 建时模板 JSON 全文快照（只读，§2）
    public var deadlineMs: Int64? // 软预算绝对 epoch ms（NULL=不限，§6）
    public var startedAt: Int64? // stage1 首 running 落（§6）
    public var createdAt: Int64

    enum CodingKeys: String, CodingKey {
        case pipelineId = "pipeline_id"
        case templateId = "template_id"
        case templateSnapshot = "template_snapshot"
        case deadlineMs = "deadline_ms"
        case startedAt = "started_at"
        case createdAt = "created_at"
    }

    public init(
        pipelineId: String, templateId: String, templateSnapshot: String,
        deadlineMs: Int64? = nil, startedAt: Int64? = nil, createdAt: Int64
    ) {
        self.pipelineId = pipelineId
        self.templateId = templateId
        self.templateSnapshot = templateSnapshot
        self.deadlineMs = deadlineMs
        self.startedAt = startedAt
        self.createdAt = createdAt
    }
}

/// append-only：只 insert（UPDATE/DELETE 被触发器 ABORT）。seq 由 AUTOINCREMENT 分配，
/// insert 时置 nil，取值用 db.lastInsertedRowID。
public struct TaskEventRecord: Codable, FetchableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "task_events"

    public var seq: Int64?
    public var taskId: String
    public var kind: String
    public var payload: String
    public var actor: String
    public var fromState: String?
    public var toState: String?
    public var createdAt: Int64

    enum CodingKeys: String, CodingKey {
        case seq, kind, payload, actor
        case taskId = "task_id"
        case fromState = "from_state"
        case toState = "to_state"
        case createdAt = "created_at"
    }

    public init(
        seq: Int64? = nil,
        taskId: String,
        kind: String,
        payload: String,
        actor: String,
        fromState: String?,
        toState: String?,
        createdAt: Int64
    ) {
        self.seq = seq
        self.taskId = taskId
        self.kind = kind
        self.payload = payload
        self.actor = actor
        self.fromState = fromState
        self.toState = toState
        self.createdAt = createdAt
    }
}

/// 审计台账（policy-audit.md §5）：独立 append-only 表，多数记录不迁移状态。
/// insert-only（UPDATE/DELETE 被触发器 ABORT）；seq 由 AUTOINCREMENT 分配，insert 时置 nil。
/// `inputDigest` = 全长 sha256 hex 64（SEC-18）；`eventSeq` 可空回指 task_events.seq，跨表非原子（§5）。
public struct AuditLogRecord: Codable, FetchableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "audit_log"

    public var seq: Int64?
    public var ts: Int64 // epoch ms
    public var taskId: String?
    public var category: String
    public var decision: String
    public var basis: String // 依据 JSON，默认 "{}"
    public var inputDigest: String?
    public var eventSeq: Int64?
    public var detailRef: String?

    enum CodingKeys: String, CodingKey {
        case seq, ts, category, decision, basis
        case taskId = "task_id"
        case inputDigest = "input_digest"
        case eventSeq = "event_seq"
        case detailRef = "detail_ref"
    }

    public init(
        seq: Int64? = nil,
        ts: Int64,
        taskId: String? = nil,
        category: String,
        decision: String,
        basis: String = "{}",
        inputDigest: String? = nil,
        eventSeq: Int64? = nil,
        detailRef: String? = nil
    ) {
        self.seq = seq
        self.ts = ts
        self.taskId = taskId
        self.category = category
        self.decision = decision
        self.basis = basis
        self.inputDigest = inputDigest
        self.eventSeq = eventSeq
        self.detailRef = detailRef
    }
}
