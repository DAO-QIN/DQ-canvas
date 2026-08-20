# Phase 2 Gate Report：Design Document 与 Design Ops 契约

日期：2026-08-11
结论：**PASS WITH KNOWN DEVIATIONS**
下一步：停在 Phase 3 门前；只有用户明确确认后才允许创建数据库、Provider、Service 与 API

## 本阶段完成

- 冻结 `web/src/lib/design/` 为引擎无关的正式领域核心；Fabric.js 7.4.0 仍是后续单引擎，但 Fabric/React/Zustand/server-only 运行时不进入该目录。
- 实现 Design Document v1：metadata、revision、Workspace 恢复视口/辅助线、Frame、image/text/shape/line/arrow、显式图层、稳定资源 locator、不可变 AssetVersion 父链、标注与导出设置。
- 实现严格解析、未知字段拒绝、数值规范化、容量限制、引用/图层/资产链校验和显式迁移入口；读取只接受已知版本，写入只产当前版。
- 实现类型化 Design Ops、SHA-256 批次指纹、atomic/partial 语义、逐项 receipt、revision 冲突、批次重放、历史事务和 UI/未来 Agent 共用纯函数执行器。
- 实现运行时资源 resolver 边界、单 Frame 导出计划和选择优先/视口次优先的预算化 Design Context。
- 更新 ADR-002、ADR-003、ADR-006、源码复用登记和实施状态；没有复制研究仓库源码。

本阶段没有修改数据库 Schema、Repository、文件 Provider、Route Handler、正式导航、Generation Task、积分、对象存储或真实模型调用。

## Gate 证据

统一工具链：Node.js 22.23.2、pnpm 10.34.5、Next.js 16.2.12、Fabric.js 7.4.0、Chromium 151 系列。

| Gate            | 结果 | 证据                                                                                               |
| --------------- | ---- | -------------------------------------------------------------------------------------------------- |
| G1 引擎无关核心 | PASS | `web/src/lib/design/` 无 Fabric、tldraw、React、Zustand、server-only、window/document/Canvas 依赖  |
| G2 严格文档契约 | PASS | 当前版往返、未知字段/版本、非法 URL、重复/悬空 ID、图层遗漏、越界裁剪、大小限制自动化通过          |
| G3 资源版本链   | PASS | currentVersion、父链同源、循环检测、源元素删除后 provenance 保留、运行时签名 URL 不回写均通过      |
| G4 Design Ops   | PASS | atomic rollback、partial receipt、revision 409 语义、嵌套 patch 白名单和 100 Ops 上限已冻结/测试   |
| G5 幂等重放     | PASS | canonical payload 使用同步 SHA-256；标准向量、同批重放和 batchId 内容冲突自动化通过                |
| G6 导出/Context | PASS | Frame 导出排除 Workspace/其他 Frame/隐藏/标注；选择优先、文本截断、稳定 AssetVersion context 通过  |
| G7 容量压力     | PASS | 5,000 元素最大文档严格解析与 JSON 往返测试通过                                                     |
| G8 DQ 回归      | PASS | TypeScript、ESLint、Prettier、59 个 Canvas test files / 274 tests、Node 22 production build 通过   |
| G9 浏览器冒烟   | PASS | Fabric 非法 Ops、200 元素、完整 Gate 与 `/canvas` 项目列表在隔离 Node 22 production build 实测通过 |
| G10 阶段边界    | PASS | 无数据库/导航/真实 AI/积分/对象存储副作用；阶段 3 接入点未修改                                     |

定向自动化最终结果：

- Design 契约：4 个 test files，30 tests 全部通过。
- `/canvas` 相邻回归：59 个 test files，274 tests 全部通过。
- Node 22.23.2 `tsc --noEmit`：PASS。
- Design 目录 ESLint `--quiet`：PASS。
- Design 目录与治理文档 Prettier：PASS。
- Node 22.23.2 production build：PASS，63 个静态页面生成完成，`/design-poc` 和 `/canvas` 路由均编译。

真实浏览器单次冒烟：

- Fabric 非法 Ops：`rejected / ELEMENT_NOT_FOUND, TYPE_MISMATCH, FRAME_NOT_FOUND`。
- 200 元素载入与 60 次选择：69.9 ms，long task 0。
- 完整 Gate：805 ms；文档 10/10 往返、Undo/Redo PASS。
- PNG 1x：2000×2000、131.4 ms；PNG 2x：4000×4000、217.5 ms；JPEG 1x：2000×2000、49.2 ms。
- `/canvas` 实际打开为“我的画布”项目列表，空状态和新建入口正常。
- 控制台唯一 error 是文件 Provider 下 `/api/notifications/interactions` 的已知 409；CSS preload 为非阻断 warning，均非本阶段引入。

## 关键纠偏

1. Phase 1 PoC 类型没有升级为生产 Schema；正式文档改为显式图层、不可变资源版本链和严格字段白名单。
2. 现有 Canvas/短剧的 `updatedAt` 防旧写没有照搬；正式边界使用服务端权威 revision 和 expectedRevision。
3. 资源版本 `sourceElementId` 被确认为审计 provenance，不是当前元素树强外键；删除源元素不会让历史资源失效。
4. P0 没有偷渡复杂 Blend Mode、三角形/钢笔或专业滤镜；Schema 只冻结原需求的普通混合、矩形/圆形、线与箭头。
5. 幂等指纹由弱 32 位散列升级为同步 SHA-256，可在浏览器和服务端得到同一持久指纹。
6. Design Context 不会因超长文本预算把选中元素整个丢弃，而是保留元素并显式列出被截断的文字 ID。
7. 锁定对象仍允许显式解锁，但禁止移动、属性修改和层级重排；JPEG 透明背景、非 UTC 时间、绝对/带查询资源路径和多根资源链均明确拒绝。

## 已知偏差与未关闭风险

1. **真实 Safari/Firefox/低端设备矩阵尚未执行。** 本阶段新增的是纯领域契约，不包含正式 Fabric adapter；Chromium 冒烟不能泛化为 Safari。无 OffscreenCanvas 回退、低内存图片解码和 100 次编辑器挂载必须放在 Phase 5/10 的真实编辑器/导出 Gate，不能伪称本阶段已解决。
2. **完整长期历史性能尚未测。** 领域层已通过 5,000 元素文档往返和 Phase 1/2 的 200 元素浏览器用例；正式 Store 的 50/100 步历史内存、listener/worker 清理要等 Fabric 单一真源 Store 存在后测。
3. **全仓 Prettier 基线仍非绿色。** 这是 Phase 0 已归因的用户工作区偏差；本阶段仅对新增/修改文件定向格式化，未全仓改写。
4. **Node 22 构建残留。** Next 自动生成的 `web/.next-phase2/` 是未跟踪临时构建目录；`tsconfig.json` / `next-env.d.ts` 已精确恢复，但宿主策略拒绝递归删除该目录。它不属于交付源码，可安全删除。
5. **浏览器隔离数据残留。** `web/.e2e-phase2-data/` 是本轮隔离端口的文件 Provider 测试数据；不包含业务/线上数据，不应提交，可安全删除。浏览器 CLI 还在仓库根的既有 `.playwright-cli/` 中追加了本轮 snapshot/console 文件。

这些偏差均不破坏 Phase 2 的契约目标；因此判定为 `PASS WITH KNOWN DEVIATIONS`，不把后续编辑器真实设备 Gate 伪装成本阶段完成。

## Phase 3 输入与回滚前置条件

Phase 3 只允许实现持久化闭环，不进入正式导航或编辑器：

1. PostgreSQL 新增独立 `design_projects`，至少包含 owner、status、revision、document JSON、created/updated；条件更新按 owner + expected revision，零行返回 409。
2. JSON Provider 使用独立 `design-projects.json`，在 mutation queue 中提供同样的 owner、revision、容量和错误语义。
3. 手动版本/恢复使用独立快照集合；恢复前保存当前快照，恢复产生新 revision，不让 revision 倒退。
4. Ops replay receipt 的保存位置、保留期和 batchId 唯一范围必须明确；数据库迁移 SQL、索引、备份和回滚方案先于代码执行。
5. Route Handler 只调用 Service，浏览器不直连数据库；写入前再次运行 migration + strict parser。
6. Phase 3 Gate 必须同时覆盖 PostgreSQL 和文件 Provider，且不得读取/修改现有 `canvas_projects`。

按阶段协议到此停止，等待用户确认进入阶段 3。

## 工作审视报告

### 原定目标

在不创建数据库、正式导航和真实 AI 调用的前提下，冻结并实现引擎无关、严格可校验、可迁移、可测试的 Design Document / Design Ops / 资源 / 历史 / 导出 / Agent 边界，并以 Node 22、DQ Canvas 回归和真实浏览器证据完成 Phase 2 Gate。

### 完成情况

- [x] 已完成：正式 v1 Schema、严格解析、迁移入口、容量/引用/图层/资源链不变量。
- [x] 已完成：类型化 Ops、atomic/partial、revision、SHA-256 幂等重放、历史事务与逐项 receipt。
- [x] 已完成：稳定资源 resolver、Frame 导出计划、选择优先且可截断的 Design Context。
- [x] 已完成：Node 22 测试/类型/生产构建、Canvas 回归和真实 Chromium 冒烟。
- [x] 已完成：ADR、复用登记、实施状态与 Phase 3 输入/回滚前置条件。
- [ ] 未完成：Safari/Firefox/低端设备和 100 次正式编辑器生命周期测试。原因：Phase 2 没有正式 Fabric adapter/Store，当前无法对不存在的生产编辑器做诚实测量；已设为 Phase 5/10 硬 Gate。

### 发现的问题

| 严重程度 | 问题描述                                                                       | 根本原因                                                   | 改进结果                                                                    |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| 必须改正 | 初版 `operations.ts` 只严格校验 Ops 顶层，`patch` 内可能带运行时字段           | 把最终文档校验当成了命令入口白名单的替代品                 | 已增加嵌套 patch/target 严格白名单和空 patch 拒绝测试                       |
| 必须改正 | 初版 `validation.ts` 把 AssetVersion 的历史 `sourceElementId` 当当前元素强外键 | 没有区分审计 provenance 与活跃关系                         | 已解除强外键；补“删除来源元素后资源链仍可读”测试                            |
| 应当改正 | 初版 Schema 漏掉持久辅助线和图片元素显式版本切换                               | 过度从 Phase 1 PoC 最小类型出发，没有逐条对照用户 MVP 列表 | 已加入 guides 与对应 Ops、`set-image-asset-version` 及测试                  |
| 应当改正 | 初版 batch fingerprint 使用 32 位 FNV                                          | 为同步纯 TS 过早选择了实现最短方案                         | 已改为同步 SHA-256，并用 ASCII/Unicode 标准向量验证                         |
| 应当改正 | Next build 自动改写 `tsconfig.json` / `next-env.d.ts`                          | 虽使用独立 distDir，但 Next 仍会更新类型引用               | 已保存并精确恢复构建前内容；下阶段构建脚本需自动快照/恢复                   |
| 建议改进 | 浏览器 CLI `run-code` 一次因参数语法失败                                       | 在不需要 eval 的场景加入了多余等待命令                     | 未影响页面状态或 Gate；后续直接用 snapshot 轮询，不增加无价值 eval          |
| 应当改正 | 最终复核时发现锁定元素无法解锁、可被重排，且资源链允许多个根版本               | 只验证了单操作入口，没有从对象完整生命周期检查不变量       | 已允许唯一的 `locked: false` 解锁、禁止锁定元素重排、要求单根资源链并补测试 |

### 做得好的地方

- 先读真实 DQ 代码、Phase 1 证据与参考仓库一手源码，再冻结契约；没有把 PoC 或第三方示例直接升级成生产设计。
- 发现不变量错误后修的是领域边界，而不是在测试里放宽断言；所有纠偏均新增了可重复自动化。
- 生产构建、浏览器和 Canvas 回归都使用隔离目录/端口/数据，不读取或覆盖用户业务数据。
- 未把 Chromium 结果泛化为 Safari，也未把阶段 3/5 才能验证的能力伪造成 Phase 2 完成。

### 下次重点关注

- Phase 3 开始前先冻结 SQL、双 Provider revision 事务与 replay receipt 保留策略，再写 Schema。
- 所有 Next 独立构建先自动保存 `tsconfig.json` / `next-env.d.ts`，构建后无条件精确恢复。
- Phase 5 第一版 Fabric adapter 即加入无 OffscreenCanvas、100 次挂载/销毁、listener/worker 和历史内存 Gate。
- Phase 9 接 Generation Task 时保持 provenance 与活跃元素关系分层，禁止把临时任务 URL/状态写回文档。
