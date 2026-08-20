# “我的画板”实施状态

更新时间：2026-08-14（Asia/Shanghai）
当前阶段：共享工作台 P6 本地生产 Gate 已通过；线上按 Surface 灰度待发布
功能入口：`/design`、`/design/[id]`、`/canvas` 与 `/canvas/[id]`；新布局按 Surface 构建时开关灰度

Phase 3 的持久化边界见 `phase-3-persistence-protocol.md`；执行证据与结论见 `phase-3-gate-report.md`。Phase 2 契约见 `phase-2-contract-protocol.md` 和 `phase-2-gate-report.md`。

## 目标与边界

“我的画板”是面向 Amazon Listing、独立站商品图、详情图、广告图和社媒产品图的独立设计编辑器。它与现有节点式 AI 工作流画布并存：

- `/canvas` 继续负责节点、连线、生成编排和工作流 Agent。
- `/design` 负责无限 Workspace、多固定尺寸 Frame、图片/文字/图形排版、图层、裁剪、对齐、AI 改图、版本派生和原始尺寸导出。
- 两个编辑器的文档状态、Undo/Redo 和保存契约隔离；用户、权限、积分、Provider、Generation Task、素材、对象存储和 Agent 基础设施复用。
- P0 只交付可保存、可恢复、可导出的商品图设计闭环；完整 Design Agent、视频、字体生成和复杂模板市场不进入 P0。

## 阶段状态

| 阶段 | 内容                                         | 状态                                             | 进入条件                            |
| ---- | -------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| 0    | 工作区基线与安全边界                         | PASS                                             | 已完成                              |
| 1    | tldraw / Fabric 隔离 PoC 与许可证核验        | PASS（Fabric 可落地；tldraw BLOCKED BY LICENSE） | 已完成                              |
| 2    | 架构冻结与 Design Document / Design Ops 契约 | PASS                                             | 已完成，见 `phase-2-gate-report.md` |
| 3    | 数据库、文件 Provider、服务与 API            | PASS WITH KNOWN DEVIATIONS                       | 已完成，见 `phase-3-gate-report.md` |
| 4    | 独立入口、项目列表与编辑器 Shell             | PASS WITH KNOWN DEVIATION                        | 已完成，见 `phase-4-gate-report.md` |
| 5    | 编辑器内核、保存与恢复                       | PASS WITH KNOWN DEVIATIONS                       | 已完成，见 `phase-5-gate-report.md` |
| 6    | Frame 与基础元素                             | PASS WITH KNOWN DEVIATION                        | 已完成，见 `phase-6-gate-report.md` |
| 7    | 图层、排版、对齐、吸附与历史                 | PASS WITH KNOWN DEVIATION                        | 已完成，见 `phase-7-gate-report.md` |
| 8    | 素材、代理图片、裁剪与归属校验               | PASS                                             | 已完成                              |
| 9    | AI 改图与图片版本链                          | PASS                                             | 已完成                              |
| 10   | 高分辨率导出与 P0 闭环                       | PASS                                             | 已完成，见 `p6-final-gate-report.md` |
| 11   | Design Agent 与跨 Surface Handoff            | PASS                                             | 已完成                              |
| 12   | 共享布局、质量门禁、灰度与上线准备           | PASS（本地发布就绪；线上灰度待执行）             | 已完成，见 `p6-final-gate-report.md` |

每个阶段都必须提交 Phase Gate Report。只有 `PASS` 才能进入下一阶段；`PASS WITH KNOWN DEVIATIONS` 只用于不由本阶段引入、已归因且有隔离措施的基线偏差。

## P0 完成定义

同一登录用户能够：

1. 从独立入口创建并打开画板项目。
2. 导入一张商品原图并创建多个固定尺寸 Frame。
3. 添加、选择、移动、缩放、旋转图片、文字和基础图形。
4. 使用图层、对齐、吸附与裁剪完成排版。
5. 对选中图片执行至少一种现有 DQ AI 改图能力，并将结果作为新版本回写而非覆盖源图。
6. 按 Frame 原始像素导出，结果尺寸、透明度和清晰度符合设置。
7. 保存、刷新、退出后重新打开，文档、资源引用和关键视口状态可恢复。
8. 不影响 `/canvas` 的保存、Agent、生成任务和现有项目数据。

## 已确认的项目事实

- 主应用：Next.js 16.2.12、React 19.2.5、TypeScript strict、Zustand 5.0.14。
- 项目声明的包管理器：pnpm 10.34.5；锁文件真源：`web/pnpm-lock.yaml`。
- CI 使用 Node.js 22；当前本机命令行 Node.js 为 24.16.0。后续阶段用 CI 同版 Node 22 做最终门禁。
- 已安装 tldraw 5.2.5，并对 `@tldraw/editor` 应用本地补丁；当前只用于节点内绘图编辑器。
- `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` 在 `.env` 与 `.env.example` 中存在但为空，生产许可状态尚未通过。
- PostgreSQL 是默认数据库，JSON 文件 Provider 是现有单机回退模式；新项目存储必须保持两者语义一致。
- `canvas_projects.project_json`、250ms 保存防抖、50 步内存历史、素材与对象存储、图片任务、抠图、裁剪、放大和 Agent 操作协议已经存在，但不能直接当作 Design Document。

## 当前保护边界

阶段 0 开始时分支为 `feature/qanvas-homepage-redesign`，基线提交为 `e4bae0f4ab4719479a14a33ae21157da215ff871`。工作区包含用户未提交修改，后续必须先读后改，不得恢复、覆盖或全仓格式化。

重点保护：

- 根目录 `AGENTS.md`、`CONTRIBUTING.md` 当前处于已删除状态；只读取了 HEAD 版本作为仓库规则证据，不恢复文件。
- `/create`、`image-tasks`、`text-tasks`、`video-generation-tasks`、`creative-runtime-service`、`request-origin` 及其客户端/测试已有用户修改。
- `web/next.config.ts` 与 `web/next-env.d.ts` 已有用户修改。
- `web/package-lock.json` 为未跟踪文件，不作为依赖真源，也不提交。
- `web/.data-3100/` 是本地运行数据，不读取业务内容、不格式化、不提交。

当前可新增或修改前仍为干净的核心接入点包括：

- `web/src/constant/navigation-tools.ts`
- `web/src/app/(user)/layout.tsx`
- `web/src/lib/server/database/schema.ts`
- `web/src/lib/canvas-project-contract.ts`
- `web/src/lib/server/canvas-project-service.ts`
- `web/src/lib/server/canvas-project-store.ts`

“干净”只表示 Phase 0 时没有 Git 差异，不代表后续可跳过再次检查。

## P6 收口结果与下一步

- `/design/[id]` 与 `/canvas/[id]` 已使用同一套 Asui 风格工作台布局语言，复用 Top Bar、Tool/Zoom Dock、Right Rail、Composer、任务恢复、素材选择与 Handoff 基础设施。
- 两套领域真源没有合并：Design 保留 `DesignDocument/Design Ops/Fabric`，Canvas 保留 Node/Connection Store 与 Canvas Agent Ops；历史项目不迁移即可打开、保存和恢复。
- Design 已接通真实图片资源、上传/素材库、生成与派生版本、裁剪、背景编辑、Agent 动作和跨 Surface 稳定素材交接；AI 继续使用 DQ 服务端模型、积分、权限与任务恢复链。
- 无领域 `WorkspaceExportReview` 已提供候选选择、预览、PNG/JPEG/WebP、1x-4x、背景、质量、进度和错误状态。Design 注入 Fabric Frame 执行器；Canvas 暂不接入，因为项目包与媒体导出不是 Frame 切图语义。
- Design 单张直接下载，多 Frame 生成 ZIP 与 `manifest.json`；资源/图片/编码任一失败不生成残缺包。单 Frame 和批量总像素预算分别为 1.2 亿与 2.4 亿；JPEG 空 Frame 背景铺白；锁定 Frame 导出后不写偏好。
- 新布局开关默认关闭并在构建时固化：`NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED`、`NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED`。灰度、回滚与旧布局删除条件见 `p6-rollout-and-rollback.md`。
- final3 production 已完成 67/67 页面生成；真实 PNG/WebP/ZIP 与像素 Gate、1440/860/520 Dialog、完整共享工作区 Chromium `20/20`、候选性能 Gate `4/4` 均通过。Fabric 200 元素三轮中位 57.9ms、最差 63.6ms、长任务 0。
- 最终全量 Vitest 为 561 个文件通过/2 个跳过、2744 项通过/3 项跳过；`pnpm typecheck`、全仓 ESLint 和 `git diff --check` 通过。人工截图审视未发现遮挡、溢出或 Footer 错位。
- 本地发布就绪不等于线上已开启：两个新布局开关默认关闭且由构建固化，实际生产必须按 `p6-rollout-and-rollback.md` 重新构建并依次灰度 Design、Canvas。
- 外部文本/图片/视频模型三次联调均为 401，不能宣称真实模型通道验收成功；Canvas 未接入 Frame 导出审阅器是领域语义选择，不是遗漏。
