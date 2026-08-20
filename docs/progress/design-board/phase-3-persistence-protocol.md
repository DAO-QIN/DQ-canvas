# Phase 3：Design 持久化协议

日期：2026-08-11
状态：已冻结，按本协议实现；Phase 3 Gate 通过后停在 Phase 4 门前

## 1. 阶段边界

Phase 3 只交付独立 Design Project 持久化闭环：PostgreSQL、JSON 文件 Provider、Service、Route API、版本快照、revision 乐观并发和 Design Ops 幂等回执。它不新增正式导航、不实现编辑器 Shell、不接真实 AI，也不读取或写入 `canvas_projects` / `canvas-projects.json`。

Design Document 是唯一业务文档真源。Fabric 对象、选择状态、Undo/Redo 内存栈、签名 URL、`blob:` / `data:` URL 和异步任务运行态均不得进入项目快照。

## 2. PostgreSQL 数据模型

生产对象由现有 `POSTGRESQL_SCHEMA_SQL` 以加法方式创建，并经现有前缀器落为 `dq_` 对象。逻辑 SQL 如下：

```sql
CREATE TABLE IF NOT EXISTS design_projects (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    revision bigint NOT NULL DEFAULT 0,
    document_json jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (user_id, id),
    CHECK (status IN ('active', 'archived')),
    CHECK (revision >= 0)
);

CREATE INDEX IF NOT EXISTS design_projects_user_status_updated_idx
    ON design_projects (user_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS design_project_versions (
    id text PRIMARY KEY,
    project_id text NOT NULL,
    user_id text NOT NULL,
    version bigint NOT NULL,
    snapshot_revision bigint NOT NULL,
    reason text NOT NULL DEFAULT '',
    snapshot_json jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (user_id, project_id)
        REFERENCES design_projects(user_id, id) ON DELETE CASCADE,
    UNIQUE (project_id, version),
    CHECK (version > 0),
    CHECK (snapshot_revision >= 0)
);

CREATE INDEX IF NOT EXISTS design_project_versions_user_project_version_idx
    ON design_project_versions (user_id, project_id, version DESC);

CREATE TABLE IF NOT EXISTS design_operation_receipts (
    project_id text NOT NULL,
    user_id text NOT NULL,
    batch_id text NOT NULL,
    fingerprint text NOT NULL,
    base_revision bigint NOT NULL,
    result_revision bigint NOT NULL,
    receipt_json jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (project_id, batch_id),
    FOREIGN KEY (user_id, project_id)
        REFERENCES design_projects(user_id, id) ON DELETE CASCADE,
    CHECK (base_revision >= 0),
    CHECK (result_revision >= base_revision),
    CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS design_operation_receipts_user_project_created_idx
    ON design_operation_receipts (user_id, project_id, created_at DESC);
```

`revision` 与 `document_json.revision` 必须相等。普通快照更新使用：

```sql
UPDATE design_projects
SET title = $3, status = $4, revision = $5,
    document_json = $6::jsonb, updated_at = $7
WHERE id = $1 AND user_id = $2 AND revision = $8
RETURNING ...;
```

零行更新时再按 `id + user_id` 查询：项目不存在返回 404，存在但 revision 不同返回 409；绝不自动覆盖。

## 3. JSON Provider

只使用独立的 `design-projects.json`：

```ts
type DesignProjectFileDatabase = {
  version: 1;
  projects: Array<{ userId: string; project: DesignProject }>;
  versions: Array<{ userId: string; projectId: string; snapshot: DesignDocument; ...versionMeta }>;
  receipts: Array<{ userId: string; projectId: string; createdAt: string; replay: DesignOperationReplay }>;
};
```

三个集合放在同一文件，使“恢复前快照 + 恢复写入”和“Ops 文档写入 + receipt”可通过一次原子文件替换提交。所有 mutation 在模块级队列中串行执行；队列内读取最新文件、检查 owner/revision、生成新状态后调用现有 `writeJsonDataFile`。语义必须与 PostgreSQL 一致。

## 4. 写入不变量

1. 每次读取和写入 Design Document 都先执行 `migrateDesignDocument`，再由 v1 strict parser 校验；当前只支持 v1，未知字段和未知版本失败。
2. `project.id === document.id`、`project.revision === document.revision`、`project.title === document.metadata.title`。
3. 新项目从 revision 0 开始。完整文档保存要求 `incoming revision > expectedRevision`；条件更新仍以持久层当前 revision 是否等于 `expectedRevision` 决定成败，允许防抖保存合并多个已经执行的本地 Design 事务。
4. Design Ops 每个有实际成功项的批次只增加 1 revision；atomic 失败、全量 rejected 和 conflict 不修改文档。
5. 项目状态只允许 `active | archived`。本阶段完整保存不得改写 document id 或 createdAt。
6. 删除仅删除项目记录以及数据库/文件中的版本和回执，不删除本地媒体或对象存储资产。资源 locator 的生命周期仍由素材系统管理。
7. 跨用户读取统一表现为 404，避免泄露对象存在性。

## 5. 版本语义

- `POST /versions` 只保存事务内读取到的当前服务端文档，不接受客户端 `snapshot`。
- 每个项目的 `version` 从 1 递增。PostgreSQL 先 `SELECT ... FOR UPDATE` 锁项目，再计算 `MAX(version) + 1`；文件 Provider 在 mutation queue 中计算。
- 恢复请求必须携带 `expectedRevision`。
- 恢复在一个事务/一次文件 mutation 中完成：锁定当前项目并校验 revision → 校验目标版本归属 → 保存“恢复前自动快照” → 将目标 snapshot 的 id、createdAt 改为当前项目值，将 revision 改为 `current + 1`，更新时间由服务端产生 → strict validation → 条件更新项目。
- 旧 snapshot 自身的 revision 只作为审计字段保留在版本记录中，不会让当前项目 revision 倒退。

## 6. Design Ops 幂等语义

- 唯一范围为 `(userId, projectId, batchId)`；数据库主键利用 project id 全局唯一简化为 `(projectId, batchId)`，复合外键保证 user/project 配对真实。
- 指纹使用 Phase 2 已冻结的 canonical SHA-256，不接受客户端自报指纹。
- PostgreSQL 在项目行锁内读取 receipt、执行纯函数、条件更新项目并插入 receipt；文件 Provider 在同一个 mutation 中完成等价步骤。
- 相同 batchId + 相同 fingerprint 返回持久化的原 receipt 的 replay 形态，不再次执行；相同 batchId + 不同 fingerprint 返回 409 且不覆盖原 receipt。
- applied、partial、rejected 和 conflict 首次回执均保存；batchId 一经使用即不可换内容重试。
- 回执随项目生命周期保留，不设置 TTL。原因是项目和离线客户端可能长期存在，定时淘汰会令旧 batch 再次生效。删除项目时随项目级联删除；未来若存储量成为实际瓶颈，必须另立带“幂等墓碑”的迁移方案，不能直接清空回执。

## 7. API 契约

| Method | Path                                           | 语义                                               |
| ------ | ---------------------------------------------- | -------------------------------------------------- |
| GET    | `/api/design/projects?page=&pageSize=`         | 当前用户项目轻量分页                               |
| POST   | `/api/design/projects`                         | 创建空白或导入后的 v1 项目                         |
| GET    | `/api/design/projects/:id`                     | 读取 owned project + document                      |
| PATCH  | `/api/design/projects/:id`                     | `{ expectedRevision, document, status? }` 条件保存 |
| DELETE | `/api/design/projects/:id`                     | `{ expectedRevision }` 条件删除，仅删文档数据      |
| GET    | `/api/design/projects/:id/versions`            | 版本元数据列表，不返回所有大快照                   |
| POST   | `/api/design/projects/:id/versions`            | `{ expectedRevision, reason? }` 保存当前快照       |
| POST   | `/api/design/projects/:id/versions/:versionId` | `{ expectedRevision }` 事务恢复                    |
| POST   | `/api/design/projects/:id/operations`          | 提交 Phase 2 `DesignOperationBatch`                |

响应沿用 DQ `{ code, data, msg }`。401 表示未登录，404 表示 owner 范围内不存在，409 表示 revision 或 batchId 冲突，413 表示文档容量越界，400 表示请求/Schema/批次格式错误，422 表示批次已解析但业务操作全部 rejected。Route 只做鉴权、严格 JSON 解析、分页边界和错误映射，领域行为全部调用 Service。

## 8. 升级、备份与回滚

升级是纯加法：新增三张表、三个索引并登记 migration marker；不迁移、不复制、不读取 `canvas_projects`，旧数据和 API 均不变化。上线前应对 PostgreSQL 做一致性备份，并备份文件 Provider 数据目录；部署初始化只使用项目现有显式 Schema 初始化流程。

回滚应用代码时可安全保留三张新表，旧版本不会访问它们，这是首选可恢复方案。若在确认没有任何版本仍写 Design 数据后需要物理回滚，顺序为：

```sql
DROP TABLE IF EXISTS design_operation_receipts;
DROP TABLE IF EXISTS design_project_versions;
DROP TABLE IF EXISTS design_projects;
DELETE FROM schema_migrations WHERE version = '20260811_design_projects_v1';
```

物理回滚会永久删除 Design 项目和历史，执行前必须再次备份并由操作者显式确认；Phase 3 实施和验证不执行 DROP。文件 Provider 回滚以备份恢复整个 `design-projects.json`，不得拼接或部分覆盖。

## 9. Gate 验证

- 文件 Provider 使用真实临时数据目录，覆盖 CRUD、owner 隔离、分页、stale 409、版本递增、恢复原子性、Ops replay/batch conflict 和删除不碰媒体。
- PostgreSQL 覆盖 Schema 前缀、owner + expected revision SQL、行锁、事务提交/回滚、版本恢复与 receipt 原子写。当前本机未配置 `DATABASE_URL`，若 Gate 时仍无可用实例，必须明确记为环境偏差，不得伪造真实集成测试通过。
- Service 覆盖 migration + strict validation、10 MiB、immutable 字段、revision 单调性和错误映射。
- Route 覆盖 401、非法 JSON 400、404、409、413、422 以及 current-user 参数传递。
- 最后执行 Design/Phase 3 定向 Vitest、TypeScript、ESLint、Prettier 与 Node 22 production build，并确认 `/canvas` 相邻回归不受影响。
