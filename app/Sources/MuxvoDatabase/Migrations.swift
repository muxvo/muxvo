// migration v1_m1_orchestration_base + v2_m4a_control_plane + v3_m4a_takeover_session。
// v1 DDL 逐字取自 specs/orchestration/task-state-machine.md §5（v1-frozen）——文档是权威，
// 此处不得改写；MuxvoTaskEngineTests 的矩阵比对测试同样以该文档为 oracle。
// v2 审计台账取自 policy-audit.md §5（audit_log append-only + 全长 sha256 digest）；不预建索引（地基 §8 q5）。
// v3 tasks.session_id 取自 scheduler-worker.md §4.7⑤ r2（批4.6 D2 接管：sessionId 持久化，
// SessionRegistry accepted 即回写；SEC-17 口径零改——resume 只允许本任务已记录 id，含跨重启）。
import GRDB

enum Migrations {
    static func migrator() -> DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1_m1_orchestration_base") { db in
            try db.execute(
                sql: """
                CREATE TABLE tasks (
                  id              TEXT PRIMARY KEY,                  -- UUID 小写（不自实现 ULID；排序权威=task_events.seq）
                  title           TEXT NOT NULL,
                  state           TEXT NOT NULL CHECK (state IN (
                                    'created','queued','running','awaiting_approval',
                                    'waiting','paused_human','completed','failed','cancelled')),
                  parent_task_id  TEXT REFERENCES tasks(id) ON DELETE RESTRICT,  -- 子任务/派生（M4a）
                  pipeline_id     TEXT,                              -- 跨 harness 流水线实例分组（CC 执行→Codex 审查）
                  pipeline_seq    INTEGER,                           -- 流水线内序号
                  repo_path       TEXT,
                  worktree_path   TEXT,                              -- worktree-per-task 不变量载体：spawn 时强制填
                  autonomy_level  INTEGER NOT NULL DEFAULT 0 CHECK (autonomy_level BETWEEN 0 AND 3),
                  retries         INTEGER NOT NULL DEFAULT 0,
                  max_retries     INTEGER NOT NULL DEFAULT 3,        -- 有界重试（编排五原则 #3）
                  interruptions   INTEGER NOT NULL DEFAULT 0,        -- 崩溃和解计数（防风暴 §6；独立于 retries）
                  budget_tokens   INTEGER,                           -- NULL=不限（M4a 护栏）
                  budget_turns    INTEGER,
                  harness         TEXT,                              -- 'claude-code' | 'codex' | ...（M4a 填）
                  spec            TEXT NOT NULL DEFAULT '{}',        -- 结构化任务描述 JSON（任务录入不进 PTY）
                  last_error      TEXT,
                  created_at      INTEGER NOT NULL,                  -- unix epoch ms（全表统一）
                  updated_at      INTEGER NOT NULL,
                  started_at      INTEGER,
                  finished_at     INTEGER
                );
                CREATE INDEX idx_tasks_state ON tasks(state);
                CREATE INDEX idx_tasks_repo_active ON tasks(repo_path)
                  WHERE state NOT IN ('completed','failed','cancelled');   -- 同仓库并发不变量的查询面

                CREATE TABLE task_events (
                  seq         INTEGER PRIMARY KEY AUTOINCREMENT,     -- 全局单调；订阅游标 + 审计排序唯一权威
                  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
                  kind        TEXT NOT NULL,
                  payload     TEXT NOT NULL DEFAULT '{}',
                  actor       TEXT NOT NULL CHECK (actor IN ('user','policy','supervisor','system')),
                  from_state  TEXT,
                  to_state    TEXT,
                  created_at  INTEGER NOT NULL
                );
                CREATE INDEX idx_task_events_task ON task_events(task_id, seq);
                -- append-only 是触发器硬强制，不是纪律约定：
                CREATE TRIGGER task_events_no_update BEFORE UPDATE ON task_events
                  BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;
                CREATE TRIGGER task_events_no_delete BEFORE DELETE ON task_events
                  BEGIN SELECT RAISE(ABORT, 'task_events is append-only'); END;
                """
            )
        }
        migrator.registerMigration("v2_m4a_control_plane") { db in
            try db.execute(
                sql: """
                CREATE TABLE audit_log (
                  seq          INTEGER PRIMARY KEY AUTOINCREMENT,   -- 全局单调，审计排序权威
                  ts           INTEGER NOT NULL,                    -- unix epoch ms（全表统一）
                  task_id      TEXT,            -- 可空、不设 FK（未认证请求只有 claimed id；审计写入永不因约束失败）
                  category     TEXT NOT NULL,
                  decision     TEXT NOT NULL,   -- allow|deny|escalate 等（§5 记录面）
                  basis        TEXT NOT NULL DEFAULT '{}',          -- 依据 JSON（ruleId/清单条目/ladder 级/newBudgetTurns 等）
                  input_digest TEXT,            -- 全长 sha256 hex 64（SEC-18：弱位宽可生日碰撞）
                  event_seq    INTEGER,         -- 可空回指 task_events.seq，不设 FK（跨表非原子，§5）
                  detail_ref   TEXT             -- 原始大 payload 落 logs/tasks/<taskId>/ 的引用
                );
                -- append-only 是触发器硬强制（同 task_events 工艺）：
                CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
                  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
                CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
                  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
                -- 任务级 M4a 护栏字段（policy-audit §4 B-C1 verificationCommand 锁定 / §6 切账号）：
                ALTER TABLE tasks ADD COLUMN verification_command TEXT;
                ALTER TABLE tasks ADD COLUMN account_id TEXT;
                """
            )
        }
        migrator.registerMigration("v3_m4a_takeover_session") { db in
            // scheduler-worker.md §4.7⑤（r2）：nullable TEXT，append migration（_INDEX §3 既定通道）。
            // 冻结 DDL/迁移矩阵/15 kind 零改动——纯加列。
            try db.execute(sql: "ALTER TABLE tasks ADD COLUMN session_id TEXT;")
        }
        migrator.registerMigration("v4_m4a_task_archive") { db in
            // task-center-panel.md §3 r13 deleteTask（软删归档）：行不删、task_events/audit_log
            // append-only 不碰；投影快照过滤 archived_at 非空行。纯加列（_INDEX §3 既定通道）。
            try db.execute(sql: "ALTER TABLE tasks ADD COLUMN archived_at INTEGER;")
        }
        migrator.registerMigration("v5_m4b_brain_idempotency") { db in
            // command-console.md §3 / control-plane-mcp.md §3.4：brain create_task 服务端内容派生幂等键
            // sha256(规范化 repoPath ‖ 归一化 spec)。**部分唯一索引只覆盖非终态键**——任务进终态由
            // TaskService 在同事务原子置 idempotency_key=NULL 释放（MAJOR-3），同内容允许重建。
            // 同 v3〔ADD COLUMN session_id〕加列先例、低风险；9 态/15 kind/迁移矩阵/task_events·audit_log
            // 结构全零改（纯 tasks 加列 + 部分唯一索引）。人/面板录入 = NULL（不占索引）。
            try db.execute(sql: """
            ALTER TABLE tasks ADD COLUMN idempotency_key TEXT;
            CREATE UNIQUE INDEX idx_tasks_idempotency_key ON tasks(idempotency_key)
              WHERE idempotency_key IS NOT NULL;
            """)
        }
        migrator.registerMigration("v6_m4c_pipeline_templates") { db in
            // pipeline-supervisor.md §2 r3（裁决 a）：新 pipelines 表（快照 + 软预算派生列）+ tasks.stage_role
            // 角色列。**存量字节等价回填**（奇偶→stage_role）+ **每 distinct pipeline_id 合成 pipelines 行**
            // （统一「全生命周期只读 template_snapshot」路径，存量在飞 pipeline 有快照可读、行为不变闭合）。
            // 零新状态 / 零新 event kind（角色/预算/快照全落新列新表，不经状态机）。
            try db.execute(sql: """
            CREATE TABLE pipelines (
              pipeline_id        TEXT PRIMARY KEY,       -- UUID，= tasks.pipeline_id
              template_id        TEXT NOT NULL,
              template_snapshot  TEXT NOT NULL,          -- 建 pipeline 时模板 JSON 全文快照（只读）
              deadline_ms        INTEGER,                -- 软预算绝对 epoch ms（NULL=不限，§6）
              started_at         INTEGER,                -- stage1 首 running 落（§6）
              created_at         INTEGER NOT NULL
            );
            ALTER TABLE tasks ADD COLUMN stage_role TEXT;  -- plan|execute|review|final_review（NULL=非 pipeline）
            """)
            // 存量回填字节等价（M4a execute→review 严格交替，奇=execute/偶=review；奇偶函数退役为迁移专用）：
            // 回填后与运行期 DB 派生口径一致（PS_legacy_role_backfill_stable）。无 pipeline 单任务 stage_role=NULL。
            try db.execute(sql: """
            UPDATE tasks
               SET stage_role = CASE WHEN pipeline_seq % 2 = 1 THEN 'execute' ELSE 'review' END
             WHERE pipeline_id IS NOT NULL AND pipeline_seq IS NOT NULL;
            """)
            // 为每个 distinct 存量 pipeline_id 合成 pipelines 行（裁决 a「为存量 pipeline 补行」，PS_legacy_
            // pipeline_row_synthesized）：template=cc-exec-codex-review（M4a 唯一模板即此兼容模板）、snapshot=
            // 其出厂定义 JSON 全文、deadline/started=NULL（M4a 无软预算）、created_at=该 pipeline 最早任务
            // created_at。completed/failed 存量 pipeline 亦合成（纯加性只读、幂等、无状态分支）。INSERT OR
            // IGNORE：pipeline_id PK 天然幂等。
            try db.execute(
                sql: """
                INSERT OR IGNORE INTO pipelines
                    (pipeline_id, template_id, template_snapshot, deadline_ms, started_at, created_at)
                SELECT pipeline_id, 'cc-exec-codex-review', ?, NULL, NULL, MIN(created_at)
                  FROM tasks
                 WHERE pipeline_id IS NOT NULL
                 GROUP BY pipeline_id;
                """,
                arguments: [PipelineSnapshotSeed.compatJSON])
        }
        return migrator
    }
}

/// 出厂兼容模板 `cc-exec-codex-review` 的**快照 JSON 字面量单源**（v6 迁移为存量 pipeline 合成行用）。
///
/// MuxvoDatabase 不可 import MuxvoTaskEngine（依赖方向 TaskEngine→Database）故不能调
/// `PipelineTemplate.canonicalJSON()`——字面量在此、由 MuxvoTaskEngineTests 双闸锚定不漂移：
///   ① encode(PipelineCatalog.factoryTemplates[cc-exec-codex-review]).canonicalJSON == 本串（字节等价）；
///   ② decode(本串) == 该出厂模板结构（语义等价）。
/// 任一漂移测试即红，杜绝存量快照与出厂定义分叉。
public enum PipelineSnapshotSeed {
    public static let compatJSON =
        #"{"budget":{},"displayName":"CC exec then Codex review","loop":{"maxRounds":3},"stages":[{"harness":"claude-code","optional":false,"promptTemplate":"","role":"execute"},{"accountSlot":"C","harness":"codex","optional":false,"promptTemplate":"","role":"review"}],"templateId":"cc-exec-codex-review"}"#
}
