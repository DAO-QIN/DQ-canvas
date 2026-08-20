# Asui 风格共享创作工作台执行账本

> 状态：本地交付完成；外部模型鉴权未通过；线上灰度未执行
> 启动日期：2026-08-12
> 上游视觉与交互基线：Asui Canvas `v2.1.3` / `5e11c353b47fe82bdc9962bf4658005fdc873b38`
> 目标入口：`/design`、`/design/[id]`、`/canvas`、`/canvas/[id]`

本文是本任务跨会话、跨上下文的唯一执行账本。每完成一个可验证单元，必须同步更新状态、验证证据、未解决问题与下一步。不得依赖聊天记忆替代本文。

## 1. 最终目标

1. `/design` 与 `/canvas` 使用同一套 Asui 风格创作工作台布局与交互语言。
2. 共享无领域 UI、素材、生成任务、积分、Agent 会话与 Handoff 基础设施。
3. 保持两套领域真源隔离：
   - Canvas：Node、Connection、Canvas Store、Canvas Agent Ops。
   - Design：Fabric、DesignDocument、typed Design Ops、revision、receipt。
4. AI 继续使用 DQ 现有模型、渠道、积分、任务恢复和权限体系。
5. 历史 Canvas/Design 项目无需迁移即可打开、编辑、刷新和保存。

## 2. 不可破坏的约束

- 不引入第二套 Design 持久化真源，不序列化 Fabric 对象作为项目数据。
- 不将 Design 伪装成 `surface="canvas"`。
- 不合并 Canvas Store 与 Design Store，不建立混合 Agent Ops。
- 不把 `data:`、`blob:`、临时签名 URL、Provider 凭据或 API Key 写入项目、文档、日志、测试夹具或提交。
- 外部联调凭据只允许通过当前进程环境变量临时注入；本文和源码不得记录凭据。
- 不覆盖、回滚或格式化用户已有修改；根 `AGENTS.md`、`CONTRIBUTING.md` 当前删除状态保持不动。
- tldraw 不扩大到正式 `/design`；Design 继续使用 Fabric 7.4。
- 每个阶段必须有功能开关或清晰回滚边界，验证失败不得假称完成。

## 3. 阶段状态

状态枚举：`TODO` / `IN_PROGRESS` / `BLOCKED` / `DONE`。

### P0：执行记忆、基线与安全边界 — `DONE`

- [x] P0-01 建立本执行账本。
- [x] P0-02 记录工作区脏文件边界与允许修改范围。
- [x] P0-03 固化 Design 现有相关单测与类型检查基线；Canvas 构建/浏览器基线随 P1-06 接入前补齐。
- [x] P0-04 为新版共享工作台建立按 Surface 控制的功能开关（Design 已接入，Canvas 开关保留待 P1-06 使用）。
- [x] P0-05 修复 Design 路由离开时保存队列未 flush 的风险。
- [x] P0-06 固定 Asui 复用登记、版权和 MIT 归属策略。

转入 P1 的条件：P0 改动相关单测、类型检查通过，旧入口行为不变，未保存草稿不会因应用内返回而静默丢失。

### P1：Asui 风格共享工作台壳 — `DONE`

- [x] P1-01 新建无领域 `CreativeWorkspaceShell`。
- [x] P1-02 新建共享 Top Bar、底部胶囊 Tool Dock、Zoom Dock、Right Rail。
- [x] P1-03 建立主题 Token、桌面/860px/520px 响应式规则与 reduced-motion。
- [x] P1-04 拆分 Design Workbench 的生命周期、Controller、快捷键和 View State。
- [x] P1-05 `/design/[id]` 接入共享壳，保留原 Fabric/Store/Ops。
- [x] P1-06 `/canvas/[id]` 通过适配 props 接入同一壳，不改变节点/连线逻辑。
- [x] P1-07 建立视觉快照与关键交互 E2E。

转入 P2 的条件：两套旧项目零迁移可用；共享组件不导入 Canvas/Design 领域类型；桌面和移动端关键控件均可达。

### P2：Surface Controller 与选区浮层 — `DONE`

- [x] P2-01 定义 `WorkspaceSurfaceCapabilities`、命令描述符和 Surface Registry。
- [x] P2-02 建立 Canvas Client Adapter。
- [x] P2-03 建立 Design Client Adapter。
- [x] P2-04 Fabric 暴露只读选区 bounds、scene/screen 转换、viewport/resize 事件。
- [x] P2-05 实现 Asui 选区尺寸条、Prompt 浮层及碰撞翻转。
- [x] P2-06 Fabric 按稳定 ID 增量投影，避免文档 revision 全量重建。

转入 P3 的条件：缩放、平移、resize、Agent 展开后浮层不漂移；选择、历史和保存无退化；200 元素性能达到 Gate。

### P3：共享素材与生成 Runtime — `DONE`

- [x] P3-01 抽取 `LibraryAssetPicker`，统一返回稳定 locator。
- [x] P3-02 抽取按 `surface/projectId` 查询的 Generation Task Tray。
- [x] P3-03 正式扩展 `CreativeSurface`、Conversation Source 和数据库约束以支持 `design`。
- [x] P3-04 新增强类型 `SurfaceBinding` 与结果提交协调器。
- [x] P3-05 补 Design 当前/历史/间接素材引用扫描与删除保护。
- [x] P3-06 补用户导出、账户删除、备份恢复和 PostgreSQL/文件双 Provider。

转入 P4 的条件：相同请求不重复建任务或扣积分；服务重启可恢复；Design 直接和间接引用素材均不会被误删。

### P4：图片创作闭环 — `DONE`

- [x] P4-01 Canvas/Design 共用上传、素材拖入、Prompt、参考图和模型选择 UI。
- [x] P4-02 Design 接通真实图片资源、裁剪与原始资源解析。
- [x] P4-03 接通图片生成、编辑、遮罩、抠图、放大、取消、重试与恢复；Canvas/Design 共用任务与无领域像素能力，各自通过领域 adapter 写回。
- [x] P4-04 接通单批注、同源多批注和归一化局部改图；Design 图片单选浮条可直接进入批注与蒙版流程。
- [x] P4-05 Canvas 结果使用稳定节点 ID/receipt，重放不重复插入。
- [x] P4-06 Design 结果以不可变 AssetVersion 和固定 batchId 原子写回。
- [x] P4-07 派生版本默认并排放置，保留源图；并发变化时进入待放置区。

转入 P5 的条件：图片 P0 E2E 全通过，积分、幂等、冲突、恢复和父版本链正确。

### P5：共享 Agent 与跨工作台 Handoff — `DONE`

- [x] P5-01 共用 Agent Panel、会话、消息、Planner、模型与 Skill UI。
- [x] P5-02 Canvas Snapshot/Action Adapter 保持节点语义。
- [x] P5-03 Design Snapshot/Action Adapter 输出强校验 DesignOperationBatch。
- [x] P5-04 先开放只读/生成工具，再开放排列、修改、删除等写工具。
- [x] P5-05 实现 Canvas → Design 稳定素材 Handoff。
- [x] P5-06 实现 Design → Canvas 稳定素材 Handoff。

转入 P6 的条件：Agent 恢复、确认、取消、重试、revision 冲突和 applied/partial/rejected 回执通过集成测试。

### P6：切图、导出、灰度与收口 — `DONE（本地发布就绪）`

- [x] P6-01 共用无领域导出审阅 UI；Design 注入 Frame 执行器，Canvas 保留项目包与媒体导出语义。
- [x] P6-02 Design 完成 Frame 原始尺寸 PNG/JPEG/WebP、透明/白色/Frame 背景和批量 ZIP 导出。
- [x] P6-03 完成导出快捷键、焦点恢复、键盘可达、reduced-motion、响应式与 200 元素性能回归。
- [x] P6-04 完成分 Surface 构建时开关、灰度与回滚方案；旧布局按一个稳定发布周期保留，不在首次上线中删除。
- [x] P6-05 完成代码复用清单、Asui MIT/NOTICE、上线与回滚说明及最终 Gate 报告。

## 4. 目标共享边界

```text
Shared Creative Workspace
├─ WorkspaceTopBar
├─ WorkspaceToolDock
├─ WorkspaceZoomDock
├─ WorkspaceRightRail
├─ SelectionFloatingBar
├─ GenerationComposer
├─ LibraryAssetPicker
└─ GenerationTaskTray
        ├─ CanvasClientAdapter → Canvas Store / Nodes / Connections
        └─ DesignClientAdapter → Fabric / DesignDocument / Design Ops

Shared Creative Runtime
├─ 模型与渠道
├─ generation_tasks / 恢复 / Webhook
├─ 积分扣减与退款
├─ 素材与对象存储
├─ Agent 会话 / Planner / Skill
└─ Handoff Coordinator
        ├─ CanvasServerAdapter
        └─ DesignServerAdapter
```

共享层只表达语义能力和 UI 状态，禁止依赖 `CanvasNodeData`、`CanvasAgentOp`、`DesignDocument` 或 `DesignOperation`。

## 5. 验收矩阵

每阶段按风险选取并记录实际命令：

- 单元测试：相关 Vitest 文件。
- 类型：`pnpm typecheck`。
- 静态检查：仅相关文件 ESLint；不执行全仓自动格式化。
- 构建：`pnpm build`。
- 浏览器：Playwright 或受控浏览器验证 1440px、860px、520px。
- API：权限、401/404/409/413、幂等、积分、任务恢复。
- Provider：PostgreSQL 与文件 Provider 行为一致。
- 性能：200 元素操作与长任务；真实大图不重复解码。

## 6. 当前工作区保护记录

- 当前分支：`feature/qanvas-homepage-redesign`。
- Design 实现、Design API 和进度文档大部分为用户未跟踪文件；必须在原位小范围修改。
- `web/src/components/layout/app-workspace-shell.tsx` 已有用户修改。
- 根 `AGENTS.md` 与 `CONTRIBUTING.md` 为用户删除状态，不得恢复。
- 禁止 `git reset --hard`、`git checkout --`、全仓 `prettier --write` 或大范围机械重写。

## 7. 当前检查点

- 当前阶段：Design `IMG-04` 可达性与 Gate 缺口已封口，P4 恢复为 `DONE`；P5/P6 的既有实现与 Gate 证据保持有效，仍未执行线上灰度。
- 当前实现：Design 图片选区已接通裁剪、批注、蒙版、抠图和放大闭环；复用无领域 UI/像素能力，所有 Design 写入继续经过 Design typed Ops、revision、receipt 与稳定任务链。
- 最近完成：无领域导出审阅器、Design Frame 原始尺寸多格式/透明背景/批量 ZIP、导出安全预算、响应式和焦点管理已闭环；final3 production、完整工作区 Chromium 与 200 元素性能 Gate 通过。
- Canvas 适配实况：共享工作台已接通撤销/重做、视口平移/缩放/重置、清空/删除选择、节点创建和单节点尺寸调整；Canvas 原节点内 Prompt 面板已迁移到共享 Composer，仍由 Canvas adapter 保留节点生成与晚到响应防护，共享层不伪造 `selection.prompt`、多选对齐或分布能力。单选未锁定节点的 W/H 可编辑，多选或锁定节点只读，空选或仅选中连线不显示尺寸条。
- Canvas 已有验证：适配层相关 6 个 Vitest 文件 31 项测试、定向 ESLint、全量 typecheck、diff-check 通过；隔离 Chromium E2E 7 项通过，覆盖 1440/860/520、节点/连线/视口保存恢复与 Agent rail。生产编译已成功，随后仅在 Windows 写入被占用的 `next-env.d.ts` 时退出；该文件原本已有用户修改，未强行回滚。
- 下一步：按 `p6-rollout-and-rollback.md` 重新构建目标 Surface 产物并执行线上灰度；运行期修改 `NEXT_PUBLIC_*` 不能切换已固化布局。
- 未解决风险：外部模型文本/图片/视频三通道仅得到 401 鉴权拒绝，不能宣称真实媒体联调成功；管理员直接物理删除 file Provider 用户仍缺统一清理协调器；Canvas 未消费共享 Frame 审阅器是有意领域边界，不是待补的伪统一。
- 2026-08-12 扩展 E2E 新发现：Canvas 高频创建/连线时约产生 336 次连续 PATCH，`flushProject()` 以服务端 `updatedAt` 与本地状态比较会持续误判新快照并阻止导航；当前按显式本地 dirty/version/ack 语义修复。1440px Dock 存在 1400px² 真实碰撞，另行修正。文件 Provider 下 `/api/notifications/interactions?limit=20` 的 409 为既有 PostgreSQL-only 基线噪声，必须分类但不归因于 Canvas。
- P2-04 验证完成：Fabric/Adapter/shared 8 文件 60 项测试通过，Design Editor 15 文件 102 项测试通过；目标 ESLint、全量 typecheck、Prettier 与 diff-check 通过。只在 Fabric ready 时声明 viewport observe/coordinate conversion、selection bounds/observe；resize 暂为 `extension:design.surface.resize-observe`，未伪造 selection.resize/prompt/export。
- P2-05/P2-06/B-03 验证完成：隔离 `NEXT_DIST_DIR=.next-p2-final4` 下，`creative-workspace.spec.ts --project=chromium --no-deps --grep "disables shared size editing"` 为 1/1，`design-fabric-probe.spec.ts --project=chromium --no-deps` 为 1/1；probe 覆盖 207 个 Fabric 对象、稳定实例、箭头局部替换、层级重排、同/跨 Frame 选区边界、移动回执和画布像素。服务日志中的 worker heartbeat 失败及 `/api/public/prompt-images` UnsafeOutboundUrl 502 为隔离环境既有噪声，未计入浏览器失败。

### 7.1 本轮持久化执行批次（2026-08-12）

- [x] B-01 收拢三项并行结果：扩展 E2E、Fabric 只读几何/事件接口、Canvas 选区浮层接线。
- [x] B-02 用实际测试与浏览器证据收口 P1，并更新 P1-04/P1-06/P1-07 状态。
- [x] B-03 完成 P2 真实能力边界、Fabric 增量投影、选择/历史/保存回归与 200 元素性能 Gate。
- [x] B-04 修正 P3 在制改动：Design conversation/source 数据库约束、服务错误语义、Generation Task 查询与本地媒体引用扫描；Handoff 留到 P5。
- [x] B-05 完成 P3 素材选择、任务恢复、SurfaceBinding、删除保护、导出/账户删除/备份与双 Provider Gate。
- [x] B-06 完成 P4 图片生成/编辑/批注/版本链闭环；本地 Gate 通过后已执行 3 次外部模型联调，上游均返回 401。
- [x] B-07 完成 P5 Agent、强校验 Design Ops 与 Canvas/Design 双向 Handoff。
- [x] B-08 完成 P6 导出、可访问性、响应式、视觉/性能回归、灰度和许可证/回滚收口。

### 7.2 本轮执行检查点（2026-08-12，P3）

目标：在不开放 Design Agent 写操作、不改变 Canvas/Design 持久化真源的前提下，闭合共享素材与生成 Runtime 的数据边界。

- [x] CP-01：验证 LibraryAssetPicker 的稳定 locator 契约，以及 Canvas/Design 任务托盘只按 `surface + projectId` 读取。
- [x] CP-02：验证 CreativeSurface、Conversation Source、generation task 和数据库 schema/mapper 的一致性；Design Agent 继续 fail-closed。
- [x] CP-03：建立无领域 `SurfaceBinding` 与结果提交协调器；Canvas/Design 写入由各自 adapter 承担并具备 receipt/task/batch 幂等。
- [x] CP-04：补齐 Design 当前文档、历史版本、元素间接 `libraryAssetId`/storage key 引用扫描；素材删除先扫描、后删记录、最后删媒体，引用时返回 409。
- [x] CP-05：将 Design project/version/receipt 纳入用户导出，核对账户删除和管理员备份/恢复覆盖边界；file/PostgreSQL 语义一致。
- [x] CP-06：执行相关 Vitest、typecheck、定向 ESLint、隔离 production build、关键 Playwright；本地 Gate 全部通过，外部模型联调保留到 P4 本地图片闭环完成后执行。

本轮终止条件：CP-01~CP-06 均有命令输出或明确阻塞证据；未通过本地 Gate 时不得消耗外部联调次数。

外部模型联调计数：`0 / 3`。凭据只注入单次测试进程，不进入源码、配置、日志、夹具、截图或本账本。

本轮 P3 证据：

- CP-01：`libraryAssetSelection()` 只持久表达 `{ kind: "library-asset", libraryAssetId }`，预览 URL/asset 数据停留在运行时 selection；客户端与 API 均以 `surface + projectId` 构造、校验和下推任务查询。相关定向 4 文件 38 项通过。
- CP-02：`CreativeSurface`/Conversation Source/schema/mapper 均包含 `design`，并新增完整 source 兼容矩阵断言；Design 可读取自身任务，但 `POST /api/agent/runs` 在查询幂等记录、限流、扣费或创建任务前即返回“画板 Agent 将在 Design 操作适配器完成后开放”，继续 fail-closed。
- CP-03：新增无领域 `SurfaceBinding` 与结果提交协调器，固定 task/receipt/batch/fingerprint、落点和回执状态；同步并发重放被合并，不同 fingerprint 冲突，完成后仍回到领域 adapter 读取持久化 receipt，避免以内存缓存冒充幂等。共享边界、协调器和 locator 共 3 文件 17 项通过，定向 ESLint 通过。
- CP-04：新增结构化 Design 引用扫描，file/PostgreSQL 均覆盖当前项目、全部历史 snapshot、AssetVersion locator 和 Image Element 间接关系；storage key 按“引用实体”计数，不再对 Design JSON 做任意字符串命中。Library Asset 删除严格执行“读取归属 → 扫描业务引用 → 删除记录 → 尝试回收媒体”，引用时 API 原样返回 409，记录与媒体均不触碰。相关 4 文件 10 项通过，定向 ESLint 通过。
- CP-05：Design Store 新增按用户隔离的完整归档读取；file Provider 单次读取项目/版本/回执，PostgreSQL 在 repeatable-read read-only 事务中读取三类记录。个人数据导出新增 `designProjects`，包含当前文档、历史 snapshot 和 operation receipt，并继续剔除 base64、签名 URL、Provider 内部字段与规划字段。管理员账户/配置备份新增机器可读 `scope`，明确 merge-no-delete 且排除 Canvas、Design、creative runtime、generation tasks、素材库和媒体，继续拒绝灾备导入。注销接口固定为 `manual-review-request-only`，不会把审核结果伪装成物理删除。相关 7 文件 27 项、Design/export 合并 4 文件 12 项、typecheck 与定向 ESLint 通过。
- 账户删除风险：管理员直接物理删用户时，PostgreSQL 依赖用户外键级联；file Provider 的跨业务 JSON/媒体清理仍缺少统一事务与失败恢复协调器。该路径不同于用户注销申请，本阶段不擅自把申请审核改成不可逆删除；进入上线治理前必须单独补齐并验证。
- CP-06：`pnpm test` 为 527 文件/2478 项通过，另有 2 文件/3 项按既定条件跳过；`pnpm typecheck`、P3 相关定向 ESLint 与 `git diff --check` 通过。素材删除 409、任务托盘与任务查询定向 5 文件/21 项通过。
- CP-06 构建与浏览器：隔离 `NEXT_DIST_DIR=.next-asui-p3-cp06-enabled` 在构建阶段注入 Canvas/Design 两个公开功能开关后，Next 16.2.12 生产构建成功并生成 66 个静态页面；同一产物在独立 4420/4421/4422 端口和隔离数据目录下执行 `creative-workspace.spec.ts --project=chromium --no-deps`，Design/Canvas 布局、保存恢复、Agent rail 和选区尺寸共 10/10 通过。首次 `--no-deps` 因缺登录态未触达应用；第二次使用未在构建阶段注入公开开关的产物加载旧布局，均已按命令环境问题归类并用最终成功运行替代，不计为产品回归。
- P3 最终基线：外部模型联调计数仍为 `0 / 3`；P4 本地闭环 Gate 未通过前不消耗调用次数。

### 7.3 P4 图片创作闭环检查点（2026-08-12）

目标：复用 DQ 现有图片任务、积分、媒体和 Canvas 成熟能力，为 Design 补齐真实图片输入、渲染、生成/编辑、版本派生与恢复；共享层不持有 Canvas 节点或 Design 文档。

- [x] IMG-01：统一图片任务的 `design` surface、稳定媒体结果和共享生成输入契约；补客户端/API 契约测试。
- [x] IMG-02：实现 Design 图片上传与素材库插入，以原子 `add-asset + create-element` 写入稳定 locator，并在 Fabric 中解析和渲染真实图片。
- [x] IMG-03：实现 Design 图片生成/参考图编辑、模型与 Prompt UI、取消/重试/任务恢复；任务按 `surface=design + projectId` 可查询。
- [x] IMG-04：实现 Design 裁剪、蒙版、抠图、放大和批注输入；派生结果保留父版本与来源任务，不覆盖源图。
- [x] IMG-05：实现 Canvas/Design 结果提交 adapter 的稳定 receipt/batch/fingerprint；重放不重复插入，并发 revision 变化进入待放置区。
- [x] IMG-06：执行图片相关 Vitest、typecheck、定向 ESLint、隔离 build 与 Chromium P0 E2E；本地 Gate 通过后才开始外部模型联调。

IMG-04 可恢复执行清单（2026-08-14）：

- [x] IMG-04A：允许本地确定性派生结果使用 `generationTaskId=null`；AI 编辑和抠图仍必须记录真实任务 ID，并补领域回归测试。
- [x] IMG-04B：新增独立 `useDesignImageTools` adapter，统一完成单选图片解析、编辑用途资源 URL、源 `elementId + assetVersionId` 重校验、裁剪与批注 typed Ops。
- [x] IMG-04C：接入蒙版编辑任务的创建、取消、恢复和成功回写；失败时保留可重新打开编辑器的上下文，不以丢失 mask 的普通重试伪装恢复。
- [x] IMG-04D：接入本地放大，结果先永久上传，再以不可变 AssetVersion 和兄弟元素原子写入；不覆盖源图、不伪造上游任务 ID。
- [x] IMG-04E：把背景移除扩展为 Canvas/Design 双 Surface；Design 服务端必须校验真实项目、图片元素、AssetVersion 与稳定 locator，公共任务 DTO 只暴露已注册永久图片结果。
- [x] IMG-04F：在 Design 图片选区浮条接入裁剪、批注、蒙版、抠图、放大五个入口，并挂载共享 Dialog；窄屏不得遮挡 Composer/Dock/Rail。
- [x] IMG-04G：补领域、adapter、Shell、路由、存储去重、恢复和源版本变化测试；通过 typecheck、定向/全量 Vitest、ESLint、diff-check、隔离 production build。
- [x] IMG-04H：使用真实浏览器完成 1440/860/520、真实选图及五入口 Gate，检查焦点、溢出、任务状态、派生兄弟元素和刷新恢复；验收证据已回填本账本。

IMG-04 收口检查点（2026-08-14）：

- `IMG-04A` 至 `IMG-04H` 已完成。Design 写入继续经过 typed Ops、revision 和 receipt；蒙版/抠图绑定 `elementId + assetVersionId`，放大创建兄弟元素和不可变 AssetVersion，不覆盖源图。
- 首轮 Gate 发现并修复三个共享根因：上传尺寸曾从 1600px 展示变体反查；Dialog 关闭后焦点曾落到 `BODY`；蒙版清理 effect 曾因尺寸对象引用变化在普通重渲染时擦除笔迹。当前上传与本地放大读取原始媒体字节，Dialog 统一恢复触发焦点，全局快捷键在可见模态期间不消费同一 `Escape`，蒙版只在开关、资源或实际宽高变化时清空。
- 最终静态 Gate：IMG-04 定向 `6 files / 29 tests`；全量 Vitest `567 passed / 2 skipped` 文件、`2778 passed / 3 skipped` 测试；`pnpm typecheck`、目标 ESLint、Prettier、全工作树 `git diff --check` 均通过。隔离 `NEXT_DIST_DIR=.next-img04-final7-build` production build 成功，Next.js 16.2.12 生成 67/67 静态页面；构建后 `tsconfig.json` 与 `next-env.d.ts` 已恢复构建前 SHA-256。
- 最终浏览器 Gate：`http://127.0.0.1:4484` 使用 final7 产物和隔离数据运行；1440/860/520 均无页面横向溢出，860px 下 Composer/缩放 Dock/工具 Dock 交叠面积均为 0，520px 页面与 Fabric canvas 均为 `520x820`。截图与日志位于 `web/output/playwright/img04/`。
- 权威尺寸与焦点：新源 AssetVersion 保持 `2335x1270`；裁剪显示原图 `2335x1270`，蒙版隐藏层与可视层像素缓冲均为 `2335x1270`。蒙版落笔后非透明像素数为 8011，跨 2.2 秒父级轮询重渲染仍为 8011。按 `Escape` 关闭裁剪 Dialog 后选区浮条仍存在，焦点返回“裁剪图片”按钮。
- 失败路径：缺图片模型时广播 `{ capability: "image" }` 并显示管理员模型配置通知，不请求 `/api/image-tasks`；抠图 Provider 未启用时真实 `POST /api/background-removal-tasks` 返回 503 和“抠图服务未启用”，两条路径均保持任务存储为空，不创建假任务。
- 放大与刷新恢复：`2335x1270` 默认选择 4K，输出 `4096x2228`；服务端 receipt 原子应用 `add-asset-version + create-element`，revision `7 -> 8`。新版本父版本指向 `2335x1270` 源版本、`generationTaskId=null`、locator 为永久 storage key，源元素保留。刷新后稳定为 4 elements / 4 AssetVersions / 8 receipts，4K 版本仅 1 个，不重复写入。
- 外部文本/图片/视频联调已达 `3/3` 且均为 HTTP 401；本执行单元未再次调用，也未把用户提供的凭据写入仓库、命令、日志或报告。

P4 调查结论：Canvas 已有成熟节点生成链与晚到响应防护；Design 已有 Asset/AssetVersion/ImageElement、父版本、裁剪、批注和强校验原子操作，但图片工具仍禁用且 Fabric 只投影占位框。服务端 generation task 已支持 `design` 和 `clientRequestId`，图片客户端 surface 类型仍漏 `design`；`uploadImage()` 已返回稳定 `storageKey`。因此共享请求/媒体/回执，领域 adapter 分别写 Canvas 节点与 Design 版本，不重写 Canvas 主流程。

P4 历史断点（2026-08-13，后续已由 EX-03～EX-10 完成）：当时主攻 IMG-01/IMG-03。公共任务列表只返回白名单化的 `clientRequestId`、`attemptNo`、`quality`、`size`、经严格解析的 `SurfaceBinding`，以及由当前用户永久图片注册记录验证后的 `{ storageKey, mimeType, width, height, bytes? }`；禁止返回 `dataUrl`、临时/上游 URL、Provider payload 或渠道配置。Design 任务固定携带 `surface=design + projectId + clientRequestId + binding`，刷新恢复按同一任务 ID 和同一导入请求 ID 幂等写回。当时的下一执行单元为任务上下文/公共 DTO 与契约测试，再接 Design Composer 和协调器。

P4 历史在制证据（以下均为 2026-08-13 阶段快照，后续状态以 EX-03～EX-10 和 IMG-04 收口证据为准）：

- IMG-01：图片客户端已复用全局 `CreativeSurface` 并接受 `design`；契约测试精确覆盖 `surface=design + projectId + clientRequestId` 与幂等请求头。`image.ts` / `image.test.ts` 共 3 项通过。
- IMG-02：新增 `createDesignImageImportBatch()`，按 `document.id + requestId` 派生稳定 asset/version/element/batch/op ID，以原子 `add-asset + create-element` 写入 `storage-key` 或 `library-asset` locator；元素失败时资源整体回滚。Design Store 新增 `dispatchBatch()`，保留传入批次身份并复用乐观更新、历史、FIFO 保存和严格回执校验。
- IMG-02 完成：共享壳新增“上传图片/从素材库插入”入口；Workbench 上传仅接受 PNG/JPEG/WebP，`uploadImage()` 结果只持久化 `storageKey`，素材库只持久化 `libraryAssetId`。放置策略区分 workspace 视口中心与显式 Frame 局部中心，原图像素保留在 AssetVersion，展示尺寸独立等比收敛。
- IMG-02 资源与投影：鉴权 resolver 严格解析 `storage-key` / `library-asset`，仅允许当前用户永久图片，非法输入为 400，越权、临时、非图片和缺失统一 404；响应只含运行期 `url/cacheKey/expiresAt`。Fabric 7.4 使用真实图片、crop、fill/contain/cover 与圆角裁剪，按 locator/cacheKey 去重解析和解码；projection generation 防止版本切换、删除、销毁后的晚到响应回写或继续解码。
- IMG-02 验证：共享壳/Workbench/Fabric/导入/Store 8 文件 74 项通过；异步 Fabric 投影 2 文件 32 项通过；resolver/Route/client 3 文件 33 项通过；全量 `pnpm typecheck`、相关 ESLint 和 diff-check 通过。浏览器与隔离生产构建统一留到 IMG-06。
- IMG-05（Design 部分）：固定图片导入批次经 Store 原样持久化，过期 revision 在本地拒绝；网络失败仍由既有队列重试同一批次。Store/image-import 合并 2 文件 20 项通过，Store 定向 ESLint 与 diff-check 通过。Canvas receipt/replay 与并发待放置仍未完成。
- IMG-03/IMG-06 在制基础：新增 Asui 风格共享 `WorkspaceGenerationComposer`，只接收通用配置、Prompt、参考图和回调，不导入 Canvas/Design 领域模型；约 683px 居中悬浮，上层 Prompt/参考图、下层模型/参数/发送，继续复用 DQ `ModelPicker` 与 `ImageSettingsPanel`。共享边界 3 项测试与全量类型检查通过。
- IMG-03/IMG-05（Design 写回规划）：新增 `createDesignImageResultPlan()`；纯生成创建新 Asset，编辑/抠图/放大等在原 Asset 上追加不可变 AssetVersion，保留 `parentVersionId/sourceElementId/generationTaskId`，默认创建兄弟元素而不覆盖源元素，批次/版本/元素 ID 按请求稳定派生。
- IMG-03/IMG-05（Design 回执）：`DesignSurfaceBinding` 新增可选 `baseRevision` 并纳入 binding key；Design Store 新增 `dispatchBatchAndWait()`，复用唯一 FIFO 保存队列并返回服务端真实 `DesignOperationReceipt`，支持 applied/replayed，网络失败、409、回执不匹配或 Store 销毁均拒绝 Promise。领域/Store/Binding 4 文件 34 项、Store 定向 16 项通过，`pnpm typecheck` 通过。
- IMG-03 Hook 在制：新增 Design 图片创建、轮询、取消、重试、刷新恢复和显式放置控制器；提交固定携带 `surface=design + projectId + clientRequestId + binding + baseRevision`，revision 变化进入待放置。接入前必须修正：只有 `save.status === "saved"` 且 `confirmedRevision === document.revision` 才能把乐观文档命中认作持久化 replay；收窄 callback/effect 依赖；消费 `recoveryTasks`；为托盘补取消、重试和待放置动作；单选 Design 图片参考图只解析运行期 URL，不持久化 URL。
- 外部模型联调计数仍为 `0 / 3`；凭据未进入源码、配置、测试、日志、截图或本账本。

### 7.4 续执行批次（2026-08-13，P4-P6）

本节是上下文压缩后的恢复入口。执行顺序固定为“Design 生成闭环 -> Canvas 共用化 -> 图片编辑工具 -> P4 Gate/外部联调 -> P5 -> P6”，除非测试证据表明主矛盾发生变化。

- [x] EX-01：固定上游 Asui Canvas commit、许可、共享边界、DQ AI/runtime 保留策略和唯一执行账本。
- [x] EX-02：完成 Design 真实图片输入、稳定 locator、Fabric 投影、不可变结果规划、等待真实回执的 Store 接口和共享 Composer 基础。
- [x] EX-03：修正 `useDesignImageGeneration` 的持久化 replay 判定、稳定依赖、恢复任务输入和销毁/晚到响应防护。
- [x] EX-04：接入 `DesignEditorWorkbench` 与 `DesignEditorCreativeShell`；支持 Prompt、本地参考图、单选图片自动参考、空选区视口中心生成、恢复、取消、重试和冲突后显式放置。
- [x] EX-05：扩展共享 `GenerationTaskTray` 的领域无关动作插槽；运行中可取消、失败可重试、Design 待放置结果可写入当前 revision，Canvas 既有调用保持兼容。
- [x] EX-06：补 Hook、Composer、Workbench/Shell、任务恢复与回执失败测试；通过定向 Vitest、`pnpm typecheck`、相关 ESLint 和 diff-check。
- [x] EX-07：将 Canvas 原 Prompt 面板迁移到共享 Composer；保留 Canvas 节点生成、晚到响应防护和稳定节点 ID，不引入 Design 类型。
- [x] EX-08：补齐裁剪、蒙版、抠图、放大、单批注/同源多批注与归一化局部编辑；派生结果不覆盖源图。
- [x] EX-09：完成 Canvas 结果 receipt/replay/fingerprint；相同任务重放不重复插入，保存失败和冲突不伪装成功。
- [x] EX-10：执行 P4 完整 Gate：相关/全量 Vitest、typecheck、定向 ESLint、隔离 production build、Chromium 1440/860/520 关键路径与画布像素检查。
- [x] EX-11：仅在 EX-10 通过后，以单次进程临时注入凭据，最多三次分别联调文本、图片、视频模型；不在命令输出、文件、日志、测试或截图中暴露凭据。三次已执行，但上游均返回 401，外部验收未通过。
- [x] EX-12：完成 P5 共享 Agent、强校验 Surface action adapter 与 Canvas/Design 双向稳定素材 Handoff。
- [x] EX-13：完成 P6 切图/导出、可访问性、性能、响应式、灰度、许可证、上线/回滚说明和最终验收。

EX-12 执行清单（2026-08-13）：

- [x] AG-01：新增无领域 `WorkspaceSnapshot`、`WorkspaceAction`、`WorkspaceActionReceipt` 契约；固定脱敏、大小上限、稳定 ID、读写风险和显式确认语义。
- [x] AG-02：Canvas Adapter 将共享快照/动作映射到既有 Canvas Snapshot 与 `CanvasAgentOp`；共享层不得导入 Canvas 领域类型。
- [x] AG-03：Design Adapter 将共享快照/动作映射为带 `baseRevision`、固定 `batchId`/fingerprint 的 `DesignOperationBatch`，保存真实 receipt；非法、越权、锁定和 revision 冲突 fail-closed。
- [x] AG-04：将既有 `WorkbenchAgentPanel`、会话/消息、Planner、模型与 Skill 控件接入共享 Right Rail；读操作可直接执行，任何写操作先展示摘要并显式确认。
- [x] AG-05：实现 Canvas → Design 与 Design → Canvas 稳定素材 Handoff；只传 `storageKey`/`libraryAssetId`，用固定 `handoffId` 保证幂等，不持久化临时 URL、Provider payload 或凭据。
- [x] AG-06：完成 P5 定向契约/集成测试、typecheck、相关 ESLint、隔离 build 和关键浏览器路径；满足转入 P6 条件后更新 P5/EX-12/B-07。

AG-01～AG-03 完成证据（2026-08-13）：

- 新增领域无关 Snapshot/Action/Confirmation/Receipt 契约与通用 SHA-256；快照限制为 256 KiB，禁止临时 URL、Provider payload、凭据字段和非稳定资源定位符，所有写操作必须显式确认并校验 request/fingerprint 身份。
- Canvas Adapter 保留既有节点、连接、锁定和 `CanvasAgentOp` 语义；Design Adapter 固定使用 atomic/source=agent batch、expected revision、本地整批预验和服务端真实 receipt，二者不共享领域 Store 或领域操作类型。
- Agent 契约与两套 Adapter 共 3 个测试文件 20 项通过；哈希兼容与共享边界 19 项通过；误触发的全量 Vitest 为 540 files passed / 2 skipped、2592 tests passed / 3 skipped；`pnpm typecheck` 与新增文件定向 ESLint 通过。
- AG-04 子步骤：先扩展 Planner/validator 生成 `workspaceActions`，服务端发布 `workspace.actions`；再由共享 Right Rail 展示摘要并对写操作显式确认；最后分别调用 Canvas/Design Adapter，只有真实 receipt 才显示成功。Design 在该闭环完成前继续 fail-closed。

AG-04～AG-06 可恢复执行队列（2026-08-13）：

- [x] AG-04A：扩展 Planner tool/validator，模型只提议受限的 `workspaceActions`；服务端依据已验证快照固定 `surface/projectId/baseRevision/batchId/actionId/kind/effect/fingerprint`，允许仅动作、无 deliverable 的计划。
- [x] AG-04B：为 `AgentRun` 增加 `awaiting_confirmation`、待执行 request 与真实 receipt；恢复器、SSE、活跃任务计数和并发租约不得在等待态启动生成任务。
- [x] AG-04C：新增确认、拒绝和 receipt API；校验用户、Surface、项目、批次、指纹、确认身份与回执身份。拒绝必须零工作区写入，真实 applied/replayed/partial receipt 后才恢复后续生成。
- [x] AG-04D：抽取无领域共享 Agent Panel 状态与确认卡，接入 Canvas/Design Right Rail；读动作自动执行，写动作显式确认，显示取消、重试、冲突和真实回执。
- [x] AG-04E：补 `DesignSurfaceBinding`，使 Design Agent 生成任务通过既有 generation runtime、积分与恢复链，并以原子 batch/真实 receipt 进入写回或待放置。
- [x] AG-04F：兼容 Canvas 旧 `nodes/connections` 与共享 `entities/relations` 快照；选中媒体只传稳定 locator，服务端通过现有媒体注册/签名访问解析，禁止持久化临时 URL。
- [x] AG-05A：定义稳定 Handoff request/receipt 与 `handoffId` 幂等语义，只携带 `storageKey`/`libraryAssetId`；分别实现 Canvas → Design、Design → Canvas。
- [x] AG-06A：完成 P5 契约/路由/集成测试、typecheck、相关 ESLint、隔离 build 和 1440/860/520 浏览器 Gate，再更新 P5/EX-12 状态。
- [x] OUT-01～OUT-05：P5 Gate 通过后执行 P6；外部文本/图片/视频联调已达 `3/3` 且均为 401，本轮禁止继续调用或记录凭据。

AG-04D 可恢复实施队列（2026-08-13）：

- [x] AG-04D-01：把 Canvas 专属 SSE 监听器拆为领域无关运行事件客户端；兼容历史 `canvas.ops`，并处理 `workspace.actions`、`workspace.actions.confirmed`、`workspace.actions.rejected`、`workspace.actions.receipt` 与 `awaiting_confirmation` snapshot 重放。
- [x] AG-04D-02：建立共享 Agent Panel 控制器与 API client；统一创建、恢复、暂停、继续、取消、失败任务重试和工作区动作状态，Surface 仅通过注入的 snapshot/action adapter 参与。
- [x] AG-04D-03：建立共享动作确认卡；读动作在服务端可信 request 到达后自动执行，写动作必须先显示逐项摘要并由用户确认；拒绝不得调用 Surface adapter，重复 SSE/点击/receipt 必须幂等。
- [x] AG-04D-04：Canvas 接线使用既有会话、消息、模型和 Skill 体验；共享 request 映射到 `CanvasAgentOp` 后必须等待 Canvas 保存队列返回服务端真实 `CanvasSaveReceipt`，再提交 workspace receipt，禁止把本地乐观状态冒充成功。
- [x] AG-04D-05：Design Right Rail 增加 Agent tab 并复用同一 Panel；动作只经 `executeDesignWorkspaceActions()` 与 `dispatchBatchAndWait()` 执行，保持 DesignDocument/Fabric 投影、revision 与 receipt 真源不变。
- [x] AG-04D-06：为以上闭环补客户端协议、确认/拒绝、刷新恢复、持久化失败、revision 冲突和 receipt 重放测试；完成定向 typecheck/ESLint 后才解除 Design Agent API fail-closed。
- [x] AG-04E-01：Design Agent 创建请求携带强类型 `DesignSurfaceBinding`；生成任务继续走 DQ 模型、积分、恢复与结果提交协调器，成功结果使用既有原子图片写回，revision 变化进入待放置区。
- [x] AG-04F-01：兼容 Canvas 历史快照字段与共享快照；只把稳定媒体 locator 送入 Planner/生成绑定，签名 URL 仅在当前用户鉴权解析时存在。

AG-04F 可恢复实施队列（2026-08-13）：

- [x] AG-04F-01A：Canvas 与 Design 规划前均按当前用户读取一次服务端可信 Workspace snapshot；同一 snapshot 驱动 Planner、选区纠偏、任务绑定与确认批次。
- [x] AG-04F-01B：`compactCanvasSnapshot()`、`selectedCanvasNodeIds()`、`canvasSnapshotNodes()` 同时兼容历史 `nodes/connections/selectedNodeIds` 与共享 `entities/relations/selectionIds`，Planner 投影不得包含节点 URL。
- [x] AG-04F-01C：新建 Canvas 任务仅持久化通用 `WorkspaceStableResourceLocator`；派发时才校验媒体注册的当前用户所有权、永久存储类型、媒体类型和安全路径并解析站内地址。历史 Run 的 `referenceUrl/references` 只保留恢复兼容。
- [x] AG-04F-01D：补新旧快照等价投影、临时 URL 不进入 Planner/Run、locator 鉴权解析、重试恢复不丢 locator 的定向测试，并执行 typecheck、相关 ESLint 与 diff-check。

AG-04F 调查结论（2026-08-13）：

- Canvas 动作确认已从真实项目重建共享 snapshot，但 Planner、选区纠偏和任务归一化仍读取客户端历史 snapshot，导致规划/任务与确认批次可能不在同一 revision。
- 共享 `WorkspaceSnapshot` 已只投影稳定 `storageKey/libraryAssetId` locator；旧 `compactCanvasSnapshot()` 与 `canvasSnapshotNodes()` 仍会读取 `serverUrl/remoteUrl/url/dataUrl`，临时或签名 URL 可进入 Planner、prompt 与 Agent Run。
- 现有本地媒体注册表已提供 `ownerUserId/storageClass/type/scope`，可作为派发时鉴权真源；无需新增媒体注册体系。Canvas Store 与 Design Store 继续严格隔离。
- 实施边界：新 Run 只写稳定 locator；签名或站内访问 URL 只存在于单次派发请求；历史已创建 Run 继续读取旧 URL，避免升级后无法恢复。

AG-04F 完成证据（2026-08-13）：

- 新增 Canvas 双快照投影层：历史 `nodes/connections/selectedNodeIds` 与共享 `entities/relations/selectionIds` 统一投影为相同节点/关系语义；Planner 只接收文本、尺寸、锁定、关系和稳定 locator，不接收 `data:`、`blob:`、外链或签名 URL。
- Workspace Run 创建阶段只持久化受限 selection hint；规划阶段按当前用户读取一次真实 Canvas/Design 项目，并用同一可信 snapshot 驱动模型筛选、Planner、选区纠偏、任务 locator、工作区确认 request 和刷新/重试恢复。
- 新 Run 的 Canvas/Design 任务统一只写 `referenceLocator`；旧 `designReferenceLocator` 与历史 `referenceUrl/references` 仅保留恢复兼容。派发时通过通用 resolver 校验当前用户、永久存储、媒体类型、scope 和安全 storage key，运行时 URL 不回写 Agent Run。
- 兼容旧 Canvas 项目仅有站内媒体路径的情况：服务端快照可提取候选 storage key，但仍必须经过媒体注册表鉴权；查询签名不会进入 snapshot。Canvas/Design 领域 Store 和操作类型保持隔离。
- 定向 Gate：核心快照/任务/resolver 8 个文件 122 项、扩展契约/路由/SSE/恢复/媒体注册 17 个文件 190 项全部通过；`pnpm typecheck`、定向 ESLint 与 `git diff --check` 通过。
- 历史下一入口（后续已完成）：执行 AG-05A，先定义稳定 Handoff request/receipt 与 `handoffId` 幂等语义，再分别实现 Canvas → Design、Design → Canvas。

AG-05A 可恢复实施队列（2026-08-13）：

- [x] AG-05A-01：定义领域无关 `WorkspaceHandoffRequest/Receipt`；客户端只提交固定 `handoffId`、source/target surface 与 projectId、source selection、source revision 和 target base revision，不提交 URL、素材尺寸、媒体类型、Provider payload 或凭据。
- [x] AG-05A-02：服务端按当前用户读取 source/target 真实项目，从 source selection 重建稳定 locator，并通过媒体注册表验证所有权、永久存储、图片类型、scope 和安全 storage key；请求与真实项目不一致时 fail-closed。
- [x] AG-05A-03：Canvas → Design 构造固定 `DesignOperationBatch` 并调用既有 Design Store；Design → Canvas 构造确定性节点 ID 和固定 `CanvasSaveRequest` 并调用既有 Canvas Store。两方向均以目标 Store 的真实 receipt 返回 `applied/replayed/conflict`，禁止混合 Store 或第二真源。
- [x] AG-05A-04：新增共享 Handoff UI，显式选择目标项目，只展示当前选区中可交接的永久图片；覆盖处理中、成功、重放、revision 冲突、失败与打开目标项目，重复点击不得重复插入。
- [x] AG-05A-05：补契约、鉴权、越权、临时资源、媒体类型、source/target revision、固定 handoffId 不同 payload、并发、重复点击和刷新恢复测试；通过后执行 AG-06A。

AG-05A 当前决策：Handoff 写入用户显式选择的既有目标项目，不隐式新建目标项目。这样两方向都能复用现有 revision/receipt 真源并把并发冲突显式呈现；项目创建仍保留在各自项目库，不给 Design schema 增加仅为 Handoff 服务的来源字段。服务端是唯一跨域协调边界，共享客户端不得导入 `CanvasNodeData`、`DesignDocument`、`CanvasAgentOp` 或 `DesignOperation`。

AG-05A 后端完成证据（2026-08-13）：

- 新增严格 Handoff 契约、双 Provider 协调日志与 `POST /api/workspace/handoffs`；请求仅持久化 surface/project/revision/selection，所有 locator、尺寸、MIME 和目标写入均由服务端真实 source project 重建。
- Canvas → Design 使用确定性 Asset/Version/Element/Operation/Batch ID 和 Design Store receipt；Design → Canvas 使用确定性节点、网格布局和 Canvas Store receipt。同进程并发合并、跨进程以 30 秒 lease 恢复，固定 `handoffId` 不同 payload 冲突关闭。
- 恢复安全边界：目标批次 ID 绑定 request fingerprint，目标写入前原子记录预期 batch/fingerprint；崩溃恢复只接受两者完全匹配的目标 Store receipt，伪造的同批次异指纹回执不得冒充成功。PostgreSQL schema 使用增量列升级，文件 Provider 保持旧记录兼容。
- 服务/Store/契约基线 6 文件 44 项通过；恢复边界与 schema 2 文件 10 项通过；路由/客户端/服务 3 文件 18 项通过；`pnpm typecheck`、新增文件定向 ESLint 与 `git diff --check` 通过。Design Store 仍只有 4 条既有 unused warning，无 error。

AG-05A/AG-06A 完成证据（2026-08-13）：

- Canvas 与 Design 分别新增可交接选区投影，只允许带永久稳定资源的图片、全景图、绘图或含图片 Frame；空白图片、临时资源、文本、视频和失效 ID 在入口处失败关闭。
- 共享 Handoff 对话框显式列出既有目标项目；刷新清除旧 receipt，网络失败后从 `sessionStorage` 固定恢复原请求、原目标和原 `handoffId`，重试期间锁定目标，只有“重新选择”才创建新请求。目标 Select 关闭虚拟化，移动端 Design 顶栏保留交接入口。
- 定向 UI/投影回归 6 个文件 24 项通过；此前 Handoff/API/页面结构 8 个文件 41 项、选区与恢复 4 个文件 13 项均通过；`pnpm typecheck`、相关 ESLint 和 `git diff --check` 通过。
- 构建期显式开启两端共享工作台后，隔离生产构建 `.next-p5-handoff-final4-20260813` 成功，Next 16.2.12 生成 67 个静态页面，BUILD_ID `9hrewpDpO-al72884h-w3`，standalone 产物存在。
- 新端口/新文件数据目录的 Chromium Gate 8/8 通过：Design 1440/860/520、Canvas 1440/860/520 均无横向溢出；永久图片 Canvas → Design → Canvas 两方向均返回 200、打开目标项目并由目标 Store 真实落盘。8 张截图位于 `web/output/playwright/p5-handoff/`。
- 已知隔离噪声：generation worker heartbeat/退款 worker 无独立服务而重试，`/api/public/prompt-images` 因私网出站策略返回 502；均未进入关键路径或浏览器诊断失败。人工截图另发现窄屏 Design rail 关闭动画后的可见性需要 P6-03 继续收口。

历史下一入口（后续已完成）：执行 P6 OUT-01～OUT-05；先盘点并复用现有 Canvas/Design 导出能力，禁止建立第二套领域渲染真源。

AG-04D 状态语义：`applied/replayed` 才能恢复后续生成；`partial/conflict/rejected` 一律 fail-closed 并终止后续生成。确认只授权服务端签署的 fingerprint，不能授权随后变化的 request。每个子项完成后立即在本节记录测试命令、结果和下一入口。

本轮实践验证终止条件：服务端确认状态机在契约、持久化、SSE、确认/拒绝/receipt 上闭环；Canvas 与 Design 各至少一条真实动作路径通过独立适配器落地；随后完成 Handoff、P6 和全套 Gate。若测试表明主要矛盾改变，必须先更新本节再调整顺序。

AG-04D-01 完成证据（2026-08-13）：

- 新增无领域 `workspace-agent-run-client`，统一监听运行阶段、历史 `canvas.ops`、可信 `workspace.actions/confirmed/rejected/receipt` 和 `awaiting_confirmation` snapshot；终态 snapshot 已避免有 receipt 时重新执行 request。
- 新增共享动作控制器：读动作自动执行，写动作等待确认，拒绝不调用 Surface adapter，执行与 receipt 提交串行且按 fingerprint 幂等；`partial/conflict/rejected` 均保持失败关闭。
- Canvas 监听器降为兼容包装并保留既有画布提示语；定向 4 个 Vitest 文件 14 项、`pnpm typecheck` 和相关 ESLint 通过。
- 下一入口：让 Canvas 保存队列返回服务端真实 `CanvasSaveReceipt`，共享动作 adapter 必须等待该回执再构造 workspace receipt，保存失败或 revision 冲突不得报告 applied。

AG-04D-03/04 完成证据（2026-08-13）：

- 共享确认卡显示逐项动作、目标数、base/result revision、执行状态与真实回执；写动作确认、拒绝、幂等点击、receipt 重交不重复执行 Surface 的状态机由共享控制器测试覆盖。
- Canvas 在创建 Run 前先 `persistAgentSnapshot()`；动作先写入 Canvas Store，再等待 `flushProject()` 返回服务端 `CanvasSaveReceipt`，无回执、保存失败或 revision 冲突均不报告 applied。
- Canvas 刷新恢复覆盖 `awaiting_confirmation`，Right Rail 已接共享确认卡的确认、拒绝和重试命令；新增源码边界断言锁定 `onPrepareRun`、Store 写入后 flush、等待态恢复与确认卡接线。
- 定向 Gate：`pnpm exec vitest run` 执行 Canvas 集成、Store 保存、Canvas action adapter、共享 action controller、确认卡和运行客户端共 6 个文件 30 项，全部通过。
- 下一入口：抽取共享 Agent Panel 控制器/API client，让 Canvas 继续保留项目内历史会话兼容，Design 通过相同运行控制器接入 Right Rail。

AG-04D-02/05/06 完成证据（2026-08-13）：

- 无领域 `WorkspaceAgentPanel` 已统一服务端会话/消息历史、SSE 刷新恢复、模型与 Skill、确认卡、暂停/继续/取消和整体/子任务重试；Canvas 与 Design 仅注入 snapshot、prepareRun 和 action adapter。
- Design Right Rail 与 Tool Dock 已增加 Agent 入口；写动作严格经过 `executeDesignWorkspaceActions() -> dispatchBatchAndWait() -> DesignOperationReceipt`，持久化异常保持可重试且不提交虚假终态回执，409 映射为 conflict，服务端 replay receipt 保留幂等语义。
- Design 创建路由的临时 fail-closed 已在客户端 Gate 通过后解除；服务端 receipt 提交仍读取当前用户真实 Design project revision 校验写入结果。
- 定向 Gate：UI/无障碍 6 个文件 19 项、Adapter/Store/共享控制器 4 个文件 32 项、路由/执行器/服务端回执 5 个文件 68 项全部通过；`pnpm typecheck` 与定向 ESLint 通过。
- 下一入口：执行 AG-04E-01，核对 Agent deliverable 到 generation task 的 Design binding，复用既有图片任务、积分、恢复和 Design 原子结果写回/待放置协调器。

AG-04E-01 完成证据（2026-08-13）：

- Agent 规划前由服务端按当前用户读取一次真实 Design Document，并用同一可信 snapshot 驱动 Planner、`DesignSurfaceBinding` 与工作区确认批次；客户端伪造 revision/selection 不参与任务身份。
- Design 图片任务在 Agent Run 中只持久化强类型 binding 与稳定 `storageKey/libraryAssetId` locator；派发瞬间才按用户权限解析站内参考地址，临时 URL 不进入 Run。binding 同步写入图片 generation context 与恢复链接。
- 图片任务继续经过既有模型路由、积分、generation scheduler/recovery 和公共任务投影；Design Tray 复用既有结果提交协调器与 `dispatchBatchAndWait()`，同 revision 原子写回，revision 变化进入待放置，回放保持幂等。
- 定向 Gate：Agent/Design binding、派发、任务存储与写回 7 个文件 97 项，资源鉴权/图片路由/公共任务投影 5 个文件 65 项全部通过；`pnpm typecheck`、定向 ESLint、`git diff --check` 通过。
- 下一入口：执行 AG-04F-01，兼容 Canvas 历史 `nodes/connections` 与共享 `entities/relations` 快照，并把选中媒体引用收敛为服务端可鉴权解析的稳定 locator。

AG-04A 完成证据（2026-08-13）：

- Planner tool/schema、解析器和系统提示支持 `workspaceActions`，conversation 禁止动作，generation 允许仅动作或动作加 deliverables；非 Canvas/Design Surface 会剥离动作。
- 新增服务端可信动作构建器：只接受命令/摘要/目标/参数提议，服务端按快照固定 Surface、项目、revision、kind、effect、batchId/actionId，并校验命令白名单、目标存在性、锁定状态、关系端点和稳定资源定位符。
- 定向 3 个测试文件 27 项通过；相关 ESLint、`pnpm typecheck`、`git diff --check` 通过。

AG-04B 完成证据（2026-08-13）：

- `AgentRun` 新增 `awaiting_confirmation`、持久化 request/receipt；规划器在动作计划落盘后清除 executionId 并停止，不再立即调用 `executeTasks()`。
- generation scheduler 新增非活跃 `awaiting_confirmation` phase，未加入恢复或并发活跃集合；文件/PostgreSQL Provider 都把 Run 业务状态映射为底层 pending，等待态不被 Worker 抢占且不占生成并发名额。
- 动作 request 的实体、关系和 revision 改从当前用户的服务端 Canvas/Design 项目构建，客户端旧 `nodes/connections` 或共享快照只提供本轮 selection，不能伪造项目内容或 revision。
- SSE snapshot 持久恢复 request/receipt，等待态不触发 recovery；数据库 CHECK 约束已兼容新 phase。
- 首轮 Gate 为 9 个测试文件 70 项通过；补充 Provider 自查 Gate 为 5 个测试文件 41 项通过；相关 ESLint、`pnpm typecheck`、`git diff --check` 均通过。

AG-04C 完成证据（2026-08-13）：

- 新增 `confirm/reject/receipt` API 与原子 Run 转换服务：确认由服务端签署当前 request fingerprint；拒绝原子取消 planned tasks 且关闭租约；回执完整校验后才决定恢复、完成或失败。
- 纯 Canvas/Design 生成计划由服务端追加不可伪造的 `generation.authorize` 控制动作，同样先进入等待态；控制动作本身不改变领域文档 revision，生成结果仍走 DQ generation binding 的真实写回。
- `WorkspaceActionReceipt` 强制 action/result 唯一一一对应、status 与逐项结果一致、affectedIds 一致；成功/partial 回执还必须与当前服务端项目 revision 对上，临时本地应用或伪造回执不能恢复生成。
- 同一真实回执重放幂等，不重复调度；失败/冲突回执无需生成并发名额，成功且确有 tasks 时才申请并发并恢复 Worker。Canvas 的 plan/task/output 节点在 receipt 成功事件中才发布。
- 完整 AG-04C Gate 为 9 个测试文件 95 项通过；`agent-run-executor` 已更新为确认前零生成 POST 的新语义；`pnpm typecheck`、相关 ESLint、`git diff --check` 均通过。

EX-13 执行清单（2026-08-14）：

- [x] OUT-01：抽取无领域导出审阅 UI；Design 提供预览、执行与回执，Canvas 保留项目包/媒体导出，不把不同语义伪装成同一执行器。
- [x] OUT-02：Design Frame 以原始尺寸导出 PNG/JPEG/WebP，支持透明/白色/Frame 背景、质量、1x-4x 与批量 ZIP，保持 Fabric 仅为渲染投影。
- [x] OUT-03：完成 `Ctrl/Cmd+Shift+E`、原生 Dialog 焦点恢复、键盘可达、reduced-motion、1440/860/520 响应式和当前 production 200 元素性能回归。
- [x] OUT-04：核对分 Surface 构建时开关、旧布局保留边界、Asui MIT/NOTICE、代码复用清单、上线与回滚说明。
- [x] OUT-05：完成全量 Vitest、typecheck、全仓 ESLint、production build、完整 Chromium、真实下载/像素和人工截图检查；外部模型 401 作为独立未通过项保留。

EX-13/P6 调查检查点（2026-08-13）：

- 上游证据固定为 Asui Canvas `v2.1.3` / `5e11c353b47fe82bdc9962bf4658005fdc873b38`，已读取该 revision 的 `canvas-slicing-overlay.tsx`、候选/几何 schema、`candidates/crop/archive` 三条 API 及测试，后续不得以浮动 `main` 替换依据。
- 可复用交互为“自动或手动候选 -> 画布内框选/移动/缩放/键盘微调 -> 用户选择导出项和背景模式 -> 批量归档”；模型只提供候选，不能替代用户最终确认。源像素坐标、最小边界、全选/清空、逐项状态、明确失败和 manifest 是必须保留的逻辑。
- 不复用的实现包括前端随请求传模型凭据、Design Frame 再经服务端 `sharp` 重绘，以及把 Canvas 项目包导出伪装成共享切图。DQ 的 AI 仍走既有服务端配置；Design 像素必须由当前 Fabric Adapter 生成；Canvas 继续保留自己的项目包和单媒体导出执行器。
- 共享边界确定为无领域导出审阅器：只接收 `id/name/尺寸/预览`、选择、格式、倍率、背景、质量、进度和执行回执，不导入 Fabric、`DesignDocument` 或 Canvas 类型。Design/Canvas 分别注入执行适配器。
- Design 导出必须等待当前 Frame 所需图片资源完成；解析、加载或画布编码任一失败即整项失败，禁止把占位图当成功结果。单张直接下载；多张使用仓库已有 `fflate` 在浏览器打包，不新增依赖。
- P6 浏览器 Gate 除 1440/860/520 无溢出外，必须等待窄屏 rail 的 200ms transition 完成后断言 `not.toBeVisible()`，并验证单张 PNG、透明 WebP、批量 ZIP 的真实下载与图像尺寸/透明像素。
- 本轮实践终止条件：共享导出契约与 Design 像素导出通过单测/typecheck；真实浏览器完成单张及批量下载；窄屏 rail 动画后不可见；分 Surface 开关、NOTICE、复用登记、上线和回滚说明完整；最终 production build 与聚焦 Chromium Gate 通过。

EX-13/P6 完成证据（2026-08-14）：

- `WorkspaceExportReview` 保持无领域边界，只接收导出项、预览、格式、倍率、背景、质量、进度和结果；Design 通过 Fabric Adapter 注入执行，Canvas 不导入 `DesignDocument` 或 Frame 语义。
- Design 支持 PNG/JPEG/WebP、1x-4x、透明/白色/Frame 背景；单张直接下载，多张用 `fflate` 生成 ZIP 与 `manifest.json`。单 Frame/批量像素预算为 1.2 亿/2.4 亿；资源解析、图片加载、编码、实际 MIME 或 revision 任一失败即拒绝结果。
- 首次真实像素 Gate 发现 Frame Rect 裁剪边缘使左上红色像素 alpha 为 143；改为 Canvas `backgroundColor` 绘制底色并在导出期间隐藏 Frame Rect 后，final3 production 中 64x48 PNG 首像素为 `[255,0,0,255]`，透明 WebP 与 ZIP 清单/尺寸同时通过。
- 隔离构建 `.next-p6-export-final3-20260814` 使用 Design/Canvas 两个公开开关构建为启用，Next 16.2.12 编译成功并完成 67/67 页面生成；`BUILD_ID` 与 standalone `server.js` 存在。
- 聚焦导出/响应式 Gate 含安装前置为 `5/5`；完整 `creative-workspace.spec.ts` 含安装前置为 `20/20`，覆盖 Design/Canvas 保存恢复、生成回写、Handoff、Composer、上传、派生图片、尺寸/锁定和导出。
- 当前 final3 产物的候选性能 Gate 含安装前置为 `4/4`；Fabric 200 元素/60 次选择三轮为 63.6/55.8/57.9 ms，中位 57.9 ms、最差 63.6 ms、长任务 0；完整 Gate 三轮均通过。
- 全量 Vitest 为 `561 passed / 2 skipped` 文件、`2744 passed / 3 skipped` 测试；`pnpm typecheck`、全仓 `eslint . --quiet` 与 `git diff --check` 通过。全量首跑暴露移动端契约测试遗漏 `.exportAction`，修正契约后完整重跑全绿。
- 1440/860/520 三张 Dialog 截图已人工检查：双栏/单栏切换、标题、选择项、分段控件、滑杆和 Footer 无遮挡或文字溢出；窄屏 Rail 等待 200ms 动画后不可见，Dialog 关闭后焦点返回导出触发按钮。
- `NOTICE` 固定 Asui revision 并内嵌完整 MIT 文本；复用登记与 `p6-rollout-and-rollback.md` 已完成。功能开关默认关闭且在构建时固化，线上尚未执行实际灰度发布。
- 外部联调额度仍为 `3/3` 且均为 401；未再次调用，仓库检索未发现临时凭据落盘。该项不计作模型通道通过。

EX-03~EX-06 本轮终止条件：Design 从 Composer 提交后能按 `surface + projectId` 创建/恢复任务；成功结果经服务端真实 receipt 只写入一次；保存失败或 revision 变化进入可操作的待放置状态；取消和失败重试可从任务托盘触发；刷新不重复扣费、不重复创建 AssetVersion/Element。外部模型联调计数：`0 / 3`。

EX-03~EX-06 完成证据（2026-08-13）：

- 隔离 production build 使用 `NEXT_DIST_DIR=.next-p4-design-generation-gate2`，Next 16.2.12 成功生成 66 个静态页面。
- Design 响应式 production E2E 在 1440px、860px、520px 三档均通过；520px 下 Composer、Zoom Dock、Tool Dock 之间各保留 8px，零重叠。
- 真实生成 E2E 4/4 通过：Composer 创建真实 `/api/image-tasks`，协议夹具返回真实 2x2 PNG，结果登记为永久媒体，经 `/api/generation-tasks` 恢复并由真实 Design operation receipt 写回。
- 单次生成只创建 1 个 Asset、1 个 AssetVersion、1 个 ImageElement；AssetVersion 使用稳定 `storage-key` 并记录正确 `generationTaskId`。刷新后 revision 与三类对象数量不增长，未重复调用上游或重复写回。
- 单选生成图片会自动成为不可移除的 Composer 参考图。Fabric 像素探针在创建文字后命中 20,181 个非白像素与 16,926 个深色像素，证明主画布真实绘制。
- 定向 6 文件 19 项测试、`pnpm typecheck`、相关 ESLint、production build 和上述浏览器 Gate 均通过。隔离环境中的 generation worker heartbeat 失败与 `/api/public/prompt-images` UnsafeOutboundUrl 502 为既有噪声，未导致用例失败。
- 外部模型联调计数仍为 `0 / 3`；未使用或落盘外部凭据。

2026-08-13 Design 浏览器 Gate 在制证据：隔离 4430 production standalone 的干净登录会话加载 Design 项目，console 为 `0 error / 0 warning`，项目、任务恢复与会话请求均为 200。创建 Frame 后服务端保存为 r1；白色 1200x1200 Frame 覆盖当前视口时 lower canvas 为全不透明白色，继续创建文字并保存为 r2 后像素探针命中 20,181 个非白像素、16,926 个深色像素，证明 Fabric 主画布真实绘制而非空壳。1440x900 下 Composer 为 683x144，Top Bar、工具 Dock、缩放 Dock、右 Rail 均在 Shell 内且无横向溢出；860x900 抽屉关闭后 `data-state=closed + aria-hidden + inert`，Composer 恢复可操作。

2026-08-13 响应式阻断与修复：520x820 实测发现 Composer `y=610..754` 与缩放 Dock `y=712..752` 重叠约 7,400px2，模型/参数行被遮挡。共享 Composer 的紧凑底部预留调整为 521-680px 82px、<=520px 116px；浏览器临时注入同值复验得到 Composer `y=560..704`、缩放 Dock `y=712..752`、工具 Dock `y=760..804`，各留 8px 间隔。`creative-workspace` 与 Workbench 结构测试 2 文件 6 项通过；正式 E2E 已加入 Composer 与两个 Dock 的零重叠断言，待新 production 构建验证后封口。

EX-07 完成证据（2026-08-13）：

- Canvas 单选生成节点使用唯一共享底部 Composer；图片、文本、视频、音频能力与模型/参数控件随节点切换，Drawing、Config、多选和连线选择不显示 Composer，节点内部不再保留第二套 Prompt 面板。
- Canvas 专属 521-1500px 布局把缩放 Dock 提到独立行，并提高 Composer 底部预留；1440x900、860x900、520x820 production E2E 均确认 Composer、缩放 Dock、工具 Dock零重叠且无横向溢出。
- 520px “添加组件”菜单改为挂载到 `document.body` 的 fixed Portal，按触发器上沿定位并限制可用高度；Escape 在窗口级关闭、焦点返回触发按钮，关闭后可再次真实点击创建节点。三档响应式定向用例连同安装前置 4/4 通过。
- 共享 Composer 上传契约支持图片及 MP4/WebM/QuickTime 视频；Canvas 适配器先永久化媒体，再次确认目标节点仍存在，随后创建 Image/Video 节点和连接。production E2E 证明图片/视频均写入 `permanent/` storageKey，刷新后保持 4 节点/2 连线且不重复。
- 定向共享 Chrome/契约 Vitest 2 文件 9 项、`pnpm typecheck`、相关 ESLint（0 error）与 `git diff --check` 通过；隔离 `NEXT_DIST_DIR=.next-p4-canvas-composer` production build 成功生成 66 个静态页面；完整 Canvas Chromium 回归 9/9，新增上传闭环用例连同安装前置 4/4 通过。
- 隔离环境仍有既知 generation worker heartbeat 与 `/api/public/prompt-images` UnsafeOutboundUrl 502 启动噪声，未进入浏览器诊断失败集合且不影响 Canvas 用例。外部模型联调计数仍为 `0 / 3`；未使用或落盘外部凭据。

EX-08 完成证据（2026-08-13）：

- Canvas 图片派生工具已覆盖批注、裁剪、切分、蒙版局部编辑、抠图、边缘细化、放大、人物质感、多视角和表情编辑；所有结果均创建兄弟节点，不覆盖源图。
- 派生结果统一写入 `derivedImageProvenance`，以 `storageKey` 优先的稳定 `sourceFingerprint` 识别源图，避免签名 URL 刷新导致重复派生；源节点删除、替换、项目切换、刷新恢复和晚到响应均有任务取消与临时节点清理。
- `canvas-derived-image` 定向测试 27/27 通过；`pnpm typecheck`、相关 ESLint（0 error）和 `git diff --check` 通过；隔离生产构建 `.next-p4-ex08-gate` 成功并生成 66 个静态页面。
- 共享 Canvas 布局在 1440/860/520 三档通过；真实裁剪 Chromium E2E 通过，确认永久图片上传后生成兄弟节点、源图保留、provenance 正确、刷新后不重复生成；隔离环境既有 worker heartbeat 与 prompt-image `UnsafeOutboundUrl` 仅作启动噪声，不计入 Canvas 失败。

EX-09 历史执行重点（2026-08-13，后续已完成）：

- Canvas 保存请求固定携带 `batchId`、稳定 `fingerprint` 和 `expectedRevision`；服务端对同一项目/批次回放返回 `replayed`，不得重复覆盖或重复插入。
- 不同 fingerprint 复用同一 batchId 返回结构化冲突；revision 不匹配返回 409 并保留当前服务端项目，旧时间戳不得再静默伪装保存成功。
- file Provider 与 PostgreSQL Provider 均保存同一份回执语义；客户端队列保持 `local/queued/acknowledged`，失败暴露同步错误，冲突保留本地草稿并停止自动覆盖。

EX-09 完成证据（2026-08-13）：

- 新增 `CanvasProject.revision`（旧项目缺失时按 r0 兼容）、稳定 `canvasSaveFingerprint`、带 fingerprint 后缀的 `canvasSaveBatchId` 和 `CanvasSaveReceipt`；指纹排除服务端重写的 `updatedAt`，避免同一内容因时间戳变化失配。
- file Provider 新增原子回执存储；相同 `projectId + batchId + fingerprint` 返回 `replayed` 且 revision 不增长，不同 fingerprint 返回 `CANVAS_BATCH_ID_CONFLICT`，旧 revision 返回 `CANVAS_REVISION_CONFLICT`；删除项目同时清理回执。
- PostgreSQL 新增 `canvas_project_save_receipts`、复合外键所需的 `(user_id, id)` 唯一约束/索引；项目锁、保存和回执插入在同一事务中，回放只读回执不执行 UPDATE。
- 客户端保存队列携带 `expectedRevision/batchId/fingerprint`，使用服务端 receipt 的 `resultRevision` 串联 in-flight 后续保存；保存失败或冲突不更新本地草稿，暴露 `syncError`，API 409 返回结构化 receipt。
- EX-09 定向 7 个测试文件 29 项通过；全量 Vitest `539 passed / 2 skipped`、`2590 passed / 3 skipped`，`pnpm typecheck`、目标 ESLint 和 `git diff --check` 通过。外部模型联调仍为 `0 / 3`。

EX-10/EX-11 最终证据（2026-08-13）：

- EX-10 本地 Gate：隔离 production build 与 Chromium 1440/860/520 关键路径、Composer/Dock 零重叠、上传/裁剪派生/尺寸编辑/锁定/保存恢复/回放和画布像素检查已通过；完整 `creative-workspace.spec.ts` 为 `17 passed`。
- 静态检查：`pnpm test -- --testTimeout=15000` 为 `540 passed / 2 skipped`、`2591 passed / 3 skipped`；`pnpm typecheck` 通过；相关目录 ESLint 为 `0 errors`（仅既有 warnings）；`git diff --check` 通过。默认 5 秒门限下唯一慢测 `reference-asset-store.test.ts` 单独复跑 `4/4` 通过，故未修改无关测试。
- EX-11 外部联调计数：`3 / 3`。文本 `POST /v1/chat/completions`、图片 `POST /v1/images/generations`、视频 `POST /v1/videos/generations` 均收到 HTTP `401`；响应仅记录脱敏结构（文本约 893ms、图片约 820ms、视频约 851ms），未创建视频任务，未保存响应正文、媒体或凭据。当前证据只能确认上游鉴权拒绝，不能宣称模型通道验收成功；由于已达到三次上限，不再重试。

## 8. 变更日志

### 2026-08-14：完成审计

- 上游基线重新核对为 Asui Canvas `v2.1.3` / `5e11c353b47fe82bdc9962bf4658005fdc873b38`；共享壳与 Design/Canvas 双领域真源、DQ 模型/积分/任务恢复链、分 Surface 构建开关及回滚边界均按该固定基线完成审计。
- 真实 PostgreSQL 16.6 空库 Gate 暴露并修复两个根因：`schema.ts` 中 legacy source identity 的 JSON 取值缺少括号，触发 PostgreSQL 运算符优先级误判；`postgres.ts` 中空库 DDL 初始化缺少跨进程互斥，app/worker 并发启动可碰撞 `pg_type_typname_nsp_index`。当前完整 schema 初始化在事务内先获取数据库级 `pg_advisory_xact_lock`，相关回归覆盖 DDL 顺序与并发初始化。
- 隔离 PostgreSQL Gate 为 `2 files / 3 tests` 全通过，实际覆盖 fresh schema、并发 revision、版本恢复、receipt replay/conflict 与级联删除；临时容器 `dq-completion-audit-pg-20260814` 已在验收后按精确名称删除，未操作现有数据库容器。
- 全量静态与测试 Gate：Vitest `567 passed / 2 skipped` 文件、`2778 passed / 3 skipped` 测试；`pnpm typecheck`、全仓 Lint、目标 Prettier 与 `git diff --check` 全部通过。
- production Gate：Next.js 16.2.12 构建完成 `67/67` 页面，standalone `server.js` 与 `BUILD_ID` 存在；构建期注入 Design/Canvas Surface 开关及 Fabric 性能探针后，目标产物通过验证，构建生成文件恢复到审计前内容。
- Chromium Gate：完整 `creative-workspace.spec.ts` 连安装前置为 `20/20`，覆盖 1440/860/520、保存恢复、真实 fixture 生成、导出像素、Canvas/Design 双向 Handoff、Composer、上传、Canvas 裁剪与 Agent Rail；单独启用构建期探针后，200 元素 Fabric Gate 连安装前置为 `4/4`。首次将探针与主套件合跑的唯一失败来自探针开关未在构建期注入，修正构建配置后通过，不归类为业务回归。
- Playwright CLI 补证：加载与 4484 服务同批次的隔离 `admin-state.json` 后，目标 Design 项目保持在 `/design/design-MxRdPLq_NeYzKp7y78NX9`，快照可见共享生成 Composer、状态/操作区、缩放 Dock、工具 Dock 与右侧检查器，项目为 `r8 / 已保存`；1440px 下 `innerWidth=1440`、`scrollWidth=1440`，控制台为 `0 error / 0 warning`。此前直接使用通用 E2E 账号得到登录 400，已确认是账号与当前隔离数据集不匹配，未将该失败冒充产品回归。
- 外部模型联调仍为 `3/3` 且文本、图片、视频通道均返回 HTTP 401；未继续消耗次数，未保存凭据、响应正文或媒体。该证据只说明上游鉴权拒绝，不能宣称真实模型通道验收成功。
- 本地 `localhost:3000` 换版审计发现运行中的 `dq-new:phase7-perf` 镜像创建于 2026-08-11，早于本轮共享工作台实现；同时 Dockerfile 未接收 `NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED` 与 `NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED`，直接重建仍会固化旧布局。当前 Dockerfile 已补 build arg，本地 compose 默认以 `1` 构建，并新增部署契约测试防止回归。
- 使用当前工作区重建原镜像标签后，production build 完成 `67/67` 页面；仅强制替换 `dq` 与 `dq-generation-worker`，PostgreSQL、rembg 和数据卷保持不动。新 app/worker 使用同一镜像 ID，`/api/health/live` 与 `/api/health/ready` 均通过。首次原标签页仍引用旧 chunk `1am32bkebipla.js` 并产生 404/语法错误；新建无缓存导航后新版资源加载成功，最终精确地址 `http://localhost:3000/` 控制台为 `0 error / 0 warning`，旧标签已关闭。
- 收口结论：P0-P6 的本地实现、持久化、构建和浏览器 Gate 已达到本地发布就绪；线上灰度未执行，外部模型鉴权未通过，两项继续保留为明确外部缺口。

### 2026-08-12

- 建立执行账本，将完整方案拆成 P0–P6 和可验证转阶段条件。
- 明确外部 AI 联调凭据只通过临时进程环境变量使用，不进入仓库。
- 固化改动前 Design 基线：12 个 Vitest 文件、87 项测试通过，`pnpm typecheck` 通过。
- 新增保存导航协调器并接入 Workbench 返回入口；相关协调器、Workbench 接线与 Store 回归 25 项通过，类型检查通过。
- 新增 Canvas/Design 独立的共享工作台公开功能开关；默认关闭、仅精确值 `1` 启用、异常值失败关闭，定向 12 项测试与类型检查通过。
- 从固定 commit 的上游 `LICENSE` 核实 MIT 与 `Copyright (c) 2026 Asui Canvas contributors`；本轮实际参考路径、DQ 改写范围和测试要求已登记，并将归属加入根 `NOTICE`。
- 共享壳、功能开关、Design 适配壳、保存协调器与 Store 合并回归：8 个 Vitest 文件、50 项测试通过；定向 ESLint 与 `pnpm typecheck` 通过。
- 生产构建使用隔离 `NEXT_DIST_DIR=.next-asui-phase1` 通过，Next 16.2.12 成功编译并生成 65 个静态页面；默认 `.next` 被用户现有 3100/3112 服务锁定，未终止这些用户进程。
- 隔离浏览器验收：新建 `Asui Phase 1 验收` 项目，创建画框后 r0→r1 自动保存；创建文字后在“待保存”状态立即返回，协调器完成保存并导航，项目库显示 1 画框/1 元素/r2；重新打开与刷新后文字层和 r2 均恢复。
- 响应式实测：1440×900 下 Top Bar 56px、Dock 56px、按钮 44px、Right Rail 403×876 sibling；860×900 下 Right Rail 为 836px 固定抽屉，关闭后 `aria-hidden + inert` 且可重开；520×820 下 Top Bar 48px、Dock 44px、全部工具按钮 32×32，三种宽度均无横向溢出；浏览器控制台无 warning/error。
- Canvas 保存队列回归：使用本地 `local/queued/acknowledged` 版本号替代服务端 `updatedAt` dirty 判断；40 次高频更新、立即 flush、in-flight 新快照、失败暴露 4 项定向测试通过；共享工作区 Chromium E2E 11/11 通过，Canvas 定向路径 6/6 通过，521–1500px Dock overlap 为 0。文件 Provider 下通知接口预期 409 已按 PostgreSQL-only 基线精确分类；其余 HTTP/console 无异常。构建产物为隔离 `.next-creative-workspace-p1-final2`，仅有既知 worker 启动和 prompt-image fixture 环境噪声。
- P3 收口：全量 Vitest 527 文件/2478 项、类型检查、相关 ESLint、diff-check、隔离生产构建和共享工作台 Chromium 10/10 全部通过；确认 `NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_*` 必须在生产构建阶段注入，运行期注入不能改变已固化的客户端开关。
- P4 Design 图片基础：图片 API 补齐 `design` surface 契约；新增稳定图片导入批次与 Design Store `dispatchBatch()`，证明原子回滚、固定批次身份、过期 revision 拒绝和既有保存/回执链兼容。相关 Store/image-import 2 文件 20 项及图片 API 3 项通过，定向 ESLint/diff-check 通过。
- P4 IMG-02：Design 共享壳接通上传与素材库图片入口、稳定 locator 鉴权 resolver 和 Fabric 真实图片异步投影；原图/展示尺寸分离，Frame/workspace 落点明确，crop/fit/圆角及晚到响应防护有定向测试。相关 UI/领域/Fabric 74 项、resolver 33 项、全量类型检查与目标 ESLint 通过。

## 9. 工作审视报告（2026-08-14）

### 原定目标

以固定 Asui Canvas 版本为布局与交互参考，将 DQ 的 Design/Canvas 改造成共享创作工作台；复用无领域 UI、生成、素材、Agent 与 Handoff 基础设施，同时保留两套领域真源和 DQ 现有 AI、积分、任务恢复、权限契约，并用测试、真实数据库、production 构建和浏览器路径验收。

### 完成情况

- [x] 已完成：P0-P6 本地功能实现、共享边界、双领域持久化、历史项目兼容、DQ Runtime 对接、构建开关、NOTICE 与回滚文档。
- [x] 已完成：全量测试/类型/Lint/格式、真实 PostgreSQL 空库、production、1440/860/520、关键交互、导出像素与 200 元素性能 Gate。
- [ ] 未完成：外部文本/图片/视频模型成功响应；原因是三次允许调用均收到 HTTP 401，当前凭据未通过上游鉴权。
- [ ] 未完成：线上灰度；原因是本任务没有可验证的部署目标与发布授权，本地只完成了开关和回滚准备。

### 发现的问题

| 严重程度 | 问题描述（具体行为，非笼统描述）                                                                                                                                                                                                                  | 根本原因                                                                                   | 改进建议                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 必须改正 | 此前仅依据 P0-P6 勾选、局部 Vitest 与浏览器 Gate 外推“整体完成”，没有先在真实 PostgreSQL 空库执行初始化；最终在 `web/src/lib/server/database/schema.ts` 和 `web/src/lib/server/database/postgres.ts` 发现会阻断部署的 SQL 优先级与并发 DDL 问题。 | 将分阶段通过等同于系统级验收，数据库测试又因默认环境条件跳过，缺少独立 fresh-schema Gate。 | 今后涉及数据库的发布验收必须显式启动隔离真实数据库，验证空库初始化、双进程竞争、回放/冲突和级联删除后才能关闭阶段。  |
| 应当改正 | 首次把 Fabric 性能探针与主套件合跑时，只在运行期设置 `NEXT_PUBLIC_DQ_DESIGN_FABRIC_PROBE_ENABLED`，导致探针页面能力不存在并产生 1 项失败。                                                                                                        | 未把 Next.js 的公开环境变量视为构建时契约。                                                | 将所有 `NEXT_PUBLIC_*` Gate 写入构建命令和产物标识，测试启动只消费已经固化的开关；失败先核对产物配置再判断业务回归。 |
| 应当改正 | Playwright CLI 补证时先使用通用 `E2E_ADMIN` 登录 4484，得到 `/api/auth/login` 400，随后才核对 4484 启动脚本和同批次状态文件。                                                                                                                     | 验证前没有先绑定“服务进程、数据目录、登录态”三者来源。                                     | 浏览器补证前先读取服务启动参数并加载同批次 `admin-state.json`；通用测试账号只用于其安装前置创建的数据集。            |
| 建议改进 | 外部模型三次调用全部 401 后，真实模型成功路径仍无当前证据。                                                                                                                                                                                       | 外部凭据或上游鉴权配置不受仓库实现控制，且调用次数受用户上限约束。                         | 获得可用凭据后，在新一轮明确额度内分别验证文本、图片、视频，并只记录脱敏状态、时延、任务 ID 与媒体校验结果。         |

### 做得好的地方

- 数据库 Gate 暴露问题后没有通过跳过测试掩盖失败，而是修复 SQL 根因、增加并发初始化互斥并用真实 PostgreSQL 重跑。
- 共享层保持无领域，Canvas Store/Nodes 与 DesignDocument/Fabric/Ops 没有被强行合并；AI、积分、任务、素材和 Handoff 通过稳定 adapter/receipt 复用。
- 所有外部调用和浏览器失败均保留真实结论；密钥未进入源码、日志、截图、测试夹具或账本，线上灰度与外部 401 均未伪报成功。

### 下次重点关注

- 先建立跨层发布矩阵，再关闭阶段：fresh database、production build、已登录浏览器、性能探针、外部依赖分别保留独立结论。
- 对数据库和 `NEXT_PUBLIC_*` 开关使用不可跳过的发布 Gate，禁止用默认跳过或运行期注入代替真实验收。
- 外部依赖失败时严格区分“本地实现完成”“通道可达”“真实结果正确”，只有三层证据齐全才宣称端到端验收成功。
