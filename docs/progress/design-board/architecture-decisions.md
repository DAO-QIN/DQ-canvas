# “我的画板”架构决策记录

更新时间：2026-08-11

## ADR-001：保留 `/canvas`，新增独立 `/design`

状态：已接受

决定：

- 使用 `/design` 作为项目库，`/design/[id]` 作为编辑器。
- `/canvas` 继续保持节点式生成工作流语义，不承担精确平面设计文档。
- 导航文案暂定“我的画板”，与现有“我的画布”区分。

原因：现有 Canvas 的节点/连线/Frame 是生成编排结构；设计画板的 Frame、图层顺序、字体、裁剪和导出是另一组领域不变量。混用同一文档会让保存、历史、Agent 操作和兼容迁移互相牵制。

验证：P0 回归必须同时覆盖 `/design` 和 `/canvas`，证明两者项目列表、保存和恢复互不污染。

## ADR-002：使用独立 `design_projects`，不写入 `canvas_projects`

状态：已接受，Phase 2 已冻结持久化边界

决定：

- PostgreSQL 新增独立 `design_projects`，JSON Provider 使用独立 `design-projects.json`。
- 项目表保存轻量索引字段与带版本号的 Design Document JSON；媒体只保存稳定站内资源引用或 `storageKey`，不保存 base64、blob/object URL 或临时签名 URL。
- 私有项目的列表、读取、更新、删除都必须校验当前用户与资源归属。

Phase 2 冻结的数据形态：

- 项目索引至少包含 `id`、`user_id`、`title`、`status`、`revision`、`document_json`、`created_at`、`updated_at`；`revision` 是服务端权威乐观锁，不由客户端自增后直接信任。
- `document_json` 写入前必须经过 `migrateDesignDocument` 和严格 v1 校验；写入只产生当前版，未知版本和未知字段失败。
- 文件 Provider 使用独立 `design-projects.json`，与 PostgreSQL 保持 owner 过滤、revision 冲突、容量限制和错误语义一致。
- 手动版本/恢复快照使用独立版本集合；恢复前先保存当前快照，恢复本身产生新的 project revision，而不是让旧 revision 倒退。
- Phase 3 的 PostgreSQL 更新必须等价于 `UPDATE ... WHERE id = ? AND user_id = ? AND revision = expectedRevision`，零行更新返回 409；文件 Provider 在单进程 mutation queue 中做相同检查。

原因：独立表可隔离兼容策略、容量限制、查询索引和未来协作版本；也避免旧 Canvas 服务误解析 Design Document。

约束：Phase 3 才允许修改 Schema。执行前必须给出 SQL、文件 Provider 同步实现、备份/迁移影响和回滚方案；不得删除现有数据库或卷。

## ADR-003：编辑器只能有一个可写状态真源

状态：已接受

决定：

- 画板引擎的文档 Store 是元素、Frame、选择和历史的唯一可写真源。
- React/Zustand 只保存编辑器 Shell、面板开关、异步任务展示等派生 UI 状态；不得保存第二份可独立修改的元素树。
- Design Ops 只能通过编辑器适配层校验并写入同一 Store。
- 选中对象、图层面板、属性面板和 Agent 引用从同一 Store 订阅派生。

拒绝方案：外层 tldraw 加 Frame 内 Fabric 的双引擎嵌套。它会形成双坐标系、双选择模型、双历史栈和双导出路径，P0 不接受。

Phase 2 进一步冻结：

- `DesignDocument` 是可持久化领域真源，Fabric 对象只是投影；Fabric 的 cache、控制柄、selection、viewport transform 和对象引用不得序列化。
- 文档只保存轻量 Workspace 恢复视口；当前选择、hover、面板开关和 Generation Task 运行状态属于运行时 Shell 状态。
- 每个成功批次只增加一次 revision 并产生一个历史事务；atomic 批次失败不产生历史，partial 批次只记录成功的 opId。
- UI、快捷键、属性面板和未来 Agent 共用 `applyDesignOperationBatch`，不得各自维护一套写逻辑。

## ADR-004：引擎选型由隔离 PoC 决定

状态：已接受（Phase 1 Gate）；Fabric.js 7.4.0 为 P0 单引擎

候选顺序：

1. tldraw 5.2.5：DQ 已安装，Lovart 的真实交互已验证可由该类无限画布实现；但许可证、Frame 导出、精确文本和自定义图片行为必须实测。
2. Fabric.js：固定设计画板、文本、图层、裁剪和导出路径成熟；需要自行构建多 Frame 无限 Workspace、对象引用和 Agent 上下文。
3. Konva：仅在前两者出现硬阻断时评估，自建编辑器能力成本更高。

Phase 1 证据与结论（2026-08-11）：

- Fabric 7.4.0 在统一 4 Frame / 28 元素 / 7 Ops / 10 往返 / 7 Undo-Redo / 200 元素夹具上三轮均通过 G2-G10；Node 22.23.2、pnpm 10.34.5、Chromium 151.0.7922.34，最终生产构建 Gate 中位 773 ms，200 元素测量中位 77.5 ms，1x PNG 中位 70.6 ms，2x PNG 中位 209.2 ms。
- tldraw 技术夹具三轮通过，但 npm 包内许可证明确仅允许 Development Environment；生产需独立 trial/commercial agreement 与 License Key。当前 `.env` / `.env.example` Key 为空，因此为 `TECHNICAL PASS / BLOCKED BY LICENSE`，不具备 P0 资格。
- Fabric 7.4.0 的 MIT 许可证覆盖生产使用，DQ 需自建多 Frame Workspace、历史、裁剪与 Design Ops，但统一契约已证明可行。
- Fabric 的 `HTMLCanvasElement.toBlob` 导出长尾曾在多个会话复现为 6.7–6.8 s；PoC 已改为优先 `OffscreenCanvas.convertToBlob` 并保留回退，最终生产构建三轮未复现。Phase 2 仍须做 Safari/低端设备/无 OffscreenCanvas 性能矩阵；该风险不改变本次选型，但不得隐瞒。

PoC 硬性项目：

- 无限平移/缩放与至少 4 个独立 Frame。
- 图片、文字、矩形的选择、变换、层级与多选。
- 图片裁剪/遮罩，且源图不被破坏。
- 文档 JSON 保存、重载和版本字段。
- 单 Frame 1x/2x 原始像素 PNG 导出；至少验证 3000px 级边长。
- 稳定元素 ID、选中对象引用和最小 Design Ops 应用。
- React 19 / Next.js 16 客户端边界、内存与交互流畅度。
- 许可证与 NOTICE 要求。

一票否决：生产授权不成立、需要双引擎才能完成 P0、无法稳定恢复文档、原始尺寸导出错误、破坏现有 tldraw 补丁或 `/canvas`。

## ADR-005：共享平台服务，不共享画布文档状态

状态：已接受

复用：Session/权限、积分及幂等退款、逻辑模型与 Provider、Generation Task、素材库、对象存储、本地媒体登记、Agent Run 基础设施。

隔离：项目 Store、文档 Schema、元素类型、选择、视口、Undo/Redo、自动保存、Design Ops、导出状态。

集成规则：

- 浏览器只访问本站 Route Handler，不直连数据库、对象存储或模型上游。
- AI 改图任务仍以服务端持久任务为事实源；前端元素 metadata 只关联任务和展示结果。
- 同一请求重复送达只能返回原任务，刷新/恢复不得再次创建上游任务。
- AI 结果作为带 `sourceElementId` / `sourceAssetId` 的派生版本写回，不覆盖源元素或源媒体。
- 真实 AI 调用会消耗积分，专项验收前另行确认。

## ADR-006：Design Document 与 Design Ops 先版本化再扩展

状态：已接受，Phase 2 契约已冻结

最小契约必须包含：

- `schemaVersion`、项目元数据、Frame 顺序、元素稳定 ID、资源稳定引用、画布视口。
- Frame 的像素宽高、背景和导出设置。
- 图片、文字、基础图形的几何、样式、层级、锁定与父 Frame。
- 图片裁剪参数、源资源、当前派生版本与版本父链。
- 可校验、可回执、可重放失败的 Design Ops；禁止 Agent 直接写任意 JSON Patch。

兼容原则：读取旧版本时显式迁移，写入只产生当前版本；未知关键字段或非法写操作必须明确失败，不能静默丢失。

Phase 2 最终契约：

- 当前 `schemaVersion` 为 1；类型与实现位于 `web/src/lib/design/`，不依赖 Fabric、React、Zustand 或 server-only 代码。
- 文档包含 metadata、revision、Workspace 视口、辅助线、Frame、image/text/shape/line/arrow 元素、显式图层顺序、逻辑资产、资源版本父链和独立标注。
- Frame 内几何使用 Frame 局部坐标，Workspace 元素使用 Workspace 坐标；`frameId: null` 的元素不参与任意 Frame 导出。
- 逻辑资源与不可变 AssetVersion 分离；文档只保存 `storage-key` 或 `library-asset` locator。thumbnail/proxy/original 和签名 URL由运行时 resolver 派生。
- AssetVersion 的 `sourceElementId` 是不可变 provenance，可指向后来已删除的元素；它不是当前元素树的强外键。删除元素不得抹掉资源来源审计。
- Ops 批次包含稳定 `batchId` / `opId`、`expectedRevision`、`atomic | partial` 策略和逐项 receipt；禁止任意 JSON Patch。
- 相同 batchId 与相同指纹可返回已保存 replay receipt；相同 batchId 不同内容、旧 revision、未知字段、非法类型和悬空引用都明确冲突或失败。
- Design Context 采用“选中 → 视口 → 其余”预算；历史只记录文档事务，异步任务状态不进入 Undo/Redo。

容量上限：文档 10 MiB、Frame 100、元素 5,000、资源/资源版本各 2,000、标注 2,000、辅助线 1,000、单批 Ops 100。Frame 边长最大 16,384 px，导出边长最大 32,768 px，领域浮点统一为 0.001 精度。

## ADR-007：P0 围绕商品图闭环，Design Agent 后置

状态：已接受

P0 包含导入、Frame、基础元素、图层、对齐/吸附、裁剪、一种 DQ AI 改图、版本回写、原始尺寸导出和保存恢复。

P1 才扩展完整 Design Agent、多轮上下文、批量画板生成、模板/品牌套件、视频和其他高级能力。P0 仍预留稳定 ID、Design Context 和 Design Ops，以避免后续 Agent 只能通过 UI 自动化操作。
