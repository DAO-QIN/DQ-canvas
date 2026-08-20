# Phase 3 Gate Report：Design 持久化闭环

日期：2026-08-11（Asia/Shanghai）
结论：**PASS WITH KNOWN DEVIATIONS**
下一步：停在 Phase 4 门前；只有用户明确确认后才新增 `/design` 正式入口、项目列表或编辑器 Shell

## 1. 交付结论

Phase 3 已按 `phase-3-persistence-protocol.md` 完成：

- 新增独立 `design_projects`、`design_project_versions`、`design_operation_receipts`，并纳入现有 `dq_` 前缀与加法 Schema 初始化；没有迁移、读取或修改 `canvas_projects`。
- 新增独立 `design-projects.json` 文件 Provider；项目、版本、回执在同一文件的一次原子替换中提交。
- 实现 owner 隔离、轻量分页、CRUD、revision 条件写入、手动当前快照、事务恢复和 Ops 幂等回执。
- PostgreSQL 恢复和 Ops 使用项目行锁事务；文件 Provider 使用 mutation queue。恢复前当前快照与恢复写入、Ops 文档更新与 receipt 写入分别保持原子。
- Service 在所有文档读写路径执行 migration + strict validation；持久化索引字段、时间、status、revision 和 replay receipt 不一致时失败关闭。
- 新增 5 组 Route：项目集合、项目详情、版本集合、版本恢复、Design Ops；Route 只处理 current-user 鉴权、严格 JSON 和 HTTP 映射。
- 删除项目只删除 Design 文档数据、版本和回执，不调用媒体删除或对象存储删除。

## 2. Gate 结果

| Gate                | 结论 | 证据                                                                                                                 |
| ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| G1 独立数据边界     | PASS | 业务 Store/Service/Route 零引用 `canvas_projects`、`canvas-projects.json`；文件集成测试确认未创建旧 Canvas 文件      |
| G2 Schema 与回滚    | PASS | 三表、三索引、复合 owner/project 外键、约束、migration marker 和非破坏回滚方案已冻结；前缀测试通过                   |
| G3 双 Provider CRUD | PASS | 文件真实临时目录覆盖 CRUD/分页/owner；PostgreSQL 16 临时实例完成真实 DDL、JSONB、CRUD 与 owner 隔离                  |
| G4 乐观并发         | PASS | 文件与真实 PostgreSQL 的两个并发旧写都只允许一个成功，另一个 409；零行更新区分 404/409                               |
| G5 版本与恢复       | PASS | 版本只保存服务端当前文档；恢复事务先自动快照，当前 revision 5 恢复旧 revision 2 后得到 revision 6                    |
| G6 Ops 幂等         | PASS | 相同 batch/fingerprint replay 不重写；同 batch 不同内容冲突；文档与首次回执同事务；replay 保持原始 409/422 HTTP 语义 |
| G7 强校验与容量     | PASS | 未知字段/未来结构拒绝，10 MiB 映射 413，项目索引或 receipt 损坏时失败关闭                                            |
| G8 API 与鉴权       | PASS | 非法 JSON 明确 400，不再静默 `{}`；401、409、413、422 和 current-user 参数有自动化证据                               |
| G9 旧 Canvas 回归   | PASS | Canvas 62 files / 279 tests 通过，未改旧 Canvas Store/Service/Route                                                  |
| G10 生产构建        | PASS | Next.js 16.2.12 production build 成功，5 个 `/api/design/projects...` Route 均进入构建产物                           |

## 3. 验证记录

本机有效运行时为 Node.js 24.16.0、pnpm 11.16.0。桌面随附 Node 路径实际为 24.14.0，不是预期的 Node 22，因此不能将其记为 Node 22 Gate。

```text
Phase 3 + Design 定向测试：10 files / 57 tests PASS
真实 PostgreSQL 16 integration：1 file / 1 end-to-end test PASS
自审后 Service/Store 子集：7 files / 46 tests PASS
Canvas 相邻回归：62 files / 279 tests PASS
TypeScript strict：PASS
定向 ESLint：PASS
定向 Prettier：PASS
Next production build：PASS（最终代码 27.1s compile；64/64 static pages）
```

真实 PostgreSQL Gate 使用本机已有 `postgres@sha256:57c72f...`（PostgreSQL 16.14）镜像启动一次性随机端口实例，覆盖完整 Schema 初始化、JSONB、复合外键、两连接条件并发、版本恢复、receipt replay/batch conflict、migration marker 和删除级联；测试完成后容器已停止并自动删除。集成测试由 `DESIGN_POSTGRES_TEST_URL` 显式启用，普通测试环境不会依赖 Docker。

构建使用独立 `NEXT_DIST_DIR=.next-phase3-final2`。Next 自动修改了 `tsconfig.json` 与 `next-env.d.ts`；构建后已恢复构建前内容，SHA-256 分别重新匹配：

- `tsconfig.json`: `3D981270366BE918CACCCF08185D12CB25B9C844C4C7D8DC3DED970D523EF61F`
- `next-env.d.ts`: `08B3AF56B02D356AAB53D01B576F5FF0BA78B755A44C77DFB5C13712C19876DF`

## 4. 已知偏差

### D1：无法执行 CI 同版 Node 22 Gate

- 事实：当前 PATH Node 为 24.16.0，桌面捆绑 Node 为 24.14.0，机器未发现 Node 22 运行时；此前 Phase 2 的 Node 22 证据不等于本阶段证据。
- 影响：阶段 3 没有新增依赖并使用项目 TypeScript/Next 标准 API，Node 24 全部通过，但仍存在 Node 22 环境差异风险。
- 后续：CI 或取得 Node 22.23.x 后重跑定向测试、PostgreSQL integration、typecheck 和 production build。该偏差不由 Phase 3 代码引入，因此本 Gate 记为 `PASS WITH KNOWN DEVIATIONS`，不伪造 Node 22 成功。

## 5. 工作审视报告

### 原定目标

实现独立 Design Project 双 Provider 持久化闭环，包含 Schema、Service/API、版本恢复、revision 并发、Ops 幂等和迁移/回滚，并在不接正式 UI 的边界内完成 Gate。

### 完成情况

- [x] 已完成：PostgreSQL / JSON Provider、Store、Service、Route、版本、恢复、回执、文档和自动化。
- [x] 已完成：Canvas 隔离与相邻回归、生产构建、构建副作用恢复。
- [x] 已完成：真实 PostgreSQL 16 DDL、并发、恢复、幂等和级联 integration。
- [ ] 环境未完成：Node 22 验证；阻断来自本机运行时缺失，已记录补测条件。

### 发现并改正的问题

| 严重程度 | 问题描述                                                                                                | 根本原因                                             | 改正                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| 必须改正 | 初版 Ops Route 把所有 `replayed` 都映射为 200，导致首次 rejected/conflict 重放时 HTTP 语义改变          | 只看 replay 表面状态，没有追踪 `originalStatus`      | 按 original status 映射 200/422/409，并加入四类 replay 参数化测试        |
| 必须改正 | 初版 Store 对部分 PostgreSQL 数值使用无效值回退 0，损坏数据可能被继续处理                               | 复用了列表展示型宽松 mapper 思路，不符合写路径强校验 | 项目/version 改为 required integer；项目和 replay 持久化数据统一失败关闭 |
| 应当改正 | 初版手动版本 Service 直接进入 Store，虽有事务 revision 检查，但没有先验证已存文档                       | 把事务并发正确性误当作完整领域正确性                 | Service 先读取并 strict validation，Store 在事务内再次检查 revision      |
| 应当改正 | 首轮 Schema 测试仍硬编码旧表总数 59                                                                     | 新增表后未同步基线测试                               | 更新为 62，并对三张表、复合外键与索引增加具体断言                        |
| 必须改正 | 自审新增的 replay validator 与 SQL CHECK 误把指纹当成裸 64 位 hex，但 Phase 2 实际契约带 `sha256:` 前缀 | 写 Phase 3 约束时没有逐字符复核 Phase 2 指纹返回值   | Store、Schema、协议和测试统一为 `^sha256:[0-9a-f]{64}$`                  |
| 建议改进 | 最初尝试用随附运行时执行 Node 22 Gate，但该路径实际报告 Node 24.14                                      | 依据路径名称推断版本，没有先读取事实                 | 先执行 `node --version`；Gate 如实记录两套 Node 都是 24                  |

### 做得好的地方

- 修改前完成一手调查并先冻结 SQL、文件结构、receipt 生命周期与回滚方案。
- 将恢复和 Ops 作为组合事务建模，没有照搬 Drama 的非原子恢复流程。
- 将版本 API 限定为服务端当前快照，客户端不能通过 snapshot 绕过 revision。
- 文件 Provider 采用真实临时目录而非纯 Map mock，并补了两个并发写者竞争测试。
- 发现 Docker 与本地 PostgreSQL 16 镜像后，没有满足于 SQL mock，补齐了可重复、显式启用的真实数据库集成 Gate。
- 没有清理或覆盖用户工作区中的其他修改，也没有修改依赖锁文件或运行数据。

### 下一阶段重点关注

- Phase 4 只消费已冻结 API 构建独立 `/design` 项目列表和 Shell；不要在 UI 中复制另一套文档写逻辑。
- 自动保存客户端必须串行化请求并显式处理 409，不能重试为无条件覆盖。
- 在 Node 22 环境出现后优先重跑同一 Gate，不要等待 Phase 12 才补齐运行时差异。

## 6. Phase 4 门前状态

Phase 3 已完成，当前停在 Phase 4 门前。未新增 `/design` 或 `/design/[id]` 正式页面、导航入口、Fabric 正式编辑器或真实 AI 调用。
