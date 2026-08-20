# “我的画板”源码复用与授权登记

更新时间：2026-08-13
当前状态：P6 收口中；Asui 布局与候选审阅流程已完成 DQ 适配，正式领域契约与像素执行器仍由 DQ 自有实现负责

## 使用规则

用户已明确授权在本 DQ 项目内直接借鉴或复用代码。该授权记录项目实施意图，但不会改变第三方仓库的许可证、版权归属、商标或商业授权条件。

每次实际复制或改写前必须登记以下字段，并固定到具体 commit：

- `sourceRepo`
- `sourceCommit`
- `sourcePath`
- `destinationPath`
- `licenseOrAuthorizationBasis`
- `reuseType`
- `DQAdaptation`
- `requiredTests`

`destinationPath` 为 `TBD` 的条目目前只能研究，不能宣称已复用。MIT 代码需保留版权与许可文本；Apache-2.0 还需检查 NOTICE、修改声明和专利条款；AGPL 衍生代码需保持相应源码和归属义务；无许可证或自定义限制代码不得仅凭公开可见就复制。

## 候选登记

### R-001 Asui Canvas

- sourceRepo: `https://github.com/Asai2080/asui-canvas.git`
- sourceCommit: `5e11c353b47fe82bdc9962bf4658005fdc873b38`
- sourcePath:
  - 协议研究：`src/lib/canvas/annotations.ts`; `src/lib/canvas-agent/context/build-context.ts`; `src/lib/canvas-agent/canvas-commands/schema.ts`; `src/lib/canvas-agent/task-operations.ts`
  - 本轮工作台布局：`src/components/canvas/canvas-main-toolbar.tsx`; `src/components/canvas/ai-canvas.tsx`; `src/app/globals.css`
  - P6 候选审阅与导出：`src/components/canvas-slicing/canvas-slicing-overlay.tsx`; `src/lib/canvas-slicing/schema.ts`; `src/lib/canvas-slicing/candidate-editing.ts`; `src/lib/canvas-slicing/candidates.ts`; `src/app/api/slices/candidates/route.ts`; `src/app/api/slices/crop/route.ts`; `src/app/api/slices/archive/route.ts`
- destinationPath:
  - Design 协议：`web/src/lib/design/context.ts`、`operations.ts`、`operation-executor.ts`、`validation.ts`
  - 共享工作台：`web/src/components/creative-workspace/`
  - P6 共享审阅：`web/src/components/creative-workspace/workspace-export-review.tsx`、`workspace-export-review.module.css`
  - P6 Design 执行：`web/src/features/design-editor/model/design-frame-export.ts`、`fabric/design-fabric-adapter.ts`、`controller/use-design-editor-controller.ts`、`components/design-editor-workbench.tsx`
- licenseOrAuthorizationBasis: MIT；固定 commit 的仓库根 `LICENSE`，`Copyright (c) 2026 Asui Canvas contributors`；归属同步写入 DQ 根 `NOTICE`
- reuseType: 协议部分为思想吸收；共享工作台与导出审阅为依据上游结构、尺寸、候选确认和批量归档行为的 DQ/React 适配实现，未引入上游 tldraw Store、Shape、模型凭据传递或持久化代码
- DQAdaptation: 协议将节点/标注语义改为 Frame/元素并接入 DQ revision/receipt；UI 保留上游浮动 Top Bar、56px/44px 胶囊 Dock、400–460px 右栏和 860px/520px 响应式关系，但颜色、主题、可访问性和插槽改为 DQ Theme Token 与无领域 descriptors。候选审阅映射为“Frame 列表 -> 用户选择 -> 格式/倍率/背景/质量 -> 预览 -> 单张或 ZIP”；Fabric Adapter 是 Design 唯一像素执行器，DQ 既有 AI/积分/任务恢复链保持不变
- requiredTests: 归一化坐标、越界裁剪、稳定 ID、上下文选择、命令 schema、重复回执、部分失败、用户隔离；共享层领域隔离、Dock/右栏几何、键盘/ARIA、reduced-motion、1440/860/520 浏览器验收；PNG/JPEG/WebP MIME 与尺寸、透明 alpha、资源失败阻断、批量总像素预算、ZIP manifest、同名去重和锁定 Frame 偏好不写入

### R-002 tldraw Agent Template

- sourceRepo: `https://github.com/tldraw/agent-template.git`
- sourceCommit: `18c18fb9b2ede232592da68e80dc245591181c3d`
- sourcePath: `client/parts/SelectedShapesPartUtil.ts`; `client/parts/UserViewportBoundsPartUtil.ts`; `client/parts/PeripheralShapesPartUtil.ts`; `client/agent/managers/AgentActionManager.ts`; `client/components/chat-history/TldrawDiffViewer.tsx`
- destinationPath: Phase 2 映射到 `web/src/lib/design/context.ts`、`operations.ts`；Phase 11 UI 仍待定
- licenseOrAuthorizationBasis: 模板代码 MIT；仓库 `LICENSE.md`。tldraw SDK 本身是独立 tldraw license，不能以模板 MIT 代替
- reuseType: 已吸收选择优先上下文、动作校验与事务元数据思想；未复制源码
- DQAdaptation: 只保留选择/视口/外围元素上下文和动作回执思想；请求、持久化和模型调用接入 DQ 现有 Agent 基础设施
- requiredTests: 大画布上下文预算、选中优先级、外围元素截断、非法动作拒绝、取消、中断、diff 与真实 Store 一致性

### R-003 Canva Clone

- sourceRepo: `https://github.com/Davronov-Alimardon/canva-clone.git`
- sourceCommit: `53f2704646714e70339ffcad88a4e96d9b2138c9`
- sourcePath: `src/features/editor/hooks/use-editor.ts`; `src/features/editor/hooks/use-history.ts`; `src/features/editor/hooks/use-canvas-events.ts`; `src/features/editor/hooks/use-load-state.ts`; `src/features/editor/components/*-sidebar.tsx`
- destinationPath: 仅当 Phase 1 选择 Fabric.js 后映射到 `web/src/app/(user)/design/[id]/editor/`，否则不复制
- licenseOrAuthorizationBasis: Apache-2.0；仓库 `LICENSE`，实际使用时补充 NOTICE/修改说明审计
- reuseType: Fabric.js 固定画板功能实现候选
- DQAdaptation: 不移植认证、数据库、支付或 API；修正其导出实现并扩展多 Frame、稳定资源引用和单一状态真源
- requiredTests: 图片 CORS、裁剪、文字属性、图层、历史、JSON 恢复、PNG/JPEG 像素尺寸、SVG 真实性、多个 Frame 导出
- 注意: 上游 `saveSvg` 实现实际调用 `canvas.toDataURL`，不能直接视为正确 SVG 导出；这是需要纠正的参考代码，不是可原样照搬的结论

### R-004 OpenPencil

- sourceRepo: `https://github.com/open-pencil/open-pencil.git`
- sourceCommit: `b6bf9e9d6b55b274964a100c7c5caaf09d2d0064`
- sourcePath: `src/components/LayerTree/`; `src/components/EditorCanvas.vue`; `src/app/document/io/`; `src/app/automation/`; `src/components/FontSettings/`
- destinationPath: 概念映射到 `web/src/lib/design/schema.ts`、`validation.ts`、`export.ts`、`operations.ts`
- licenseOrAuthorizationBasis: MIT；仓库 `LICENSE`
- reuseType: 已吸收文档 IO、运行时 source state、图层与自动化边界思想；未复制源码
- DQAdaptation: 将 Page/Frame、图层树、文档 IO、导出倍率和自动化边界转译为 React/所选引擎契约
- requiredTests: Frame/元素层级、重命名/锁定/排序、历史、文档 IO、字体回退、导出倍率、Ops 自动化

### R-005 Open AI Canvas

- sourceRepo: `https://github.com/ddcat-ai/open-ai-canvas.git`
- sourceCommit: `4b54b65091b7fdfb24dfcd0e05a9b7dabfee6316`
- sourcePath: `web/src/components/canvas/canvas-leafer-graphics-layer.tsx`; `web/src/components/canvas/canvas-asset-tray.tsx`; `web/src/services/project-asset-sync.ts`; `canvas-agent/src/tools.ts`; `canvas-agent/src/canvas-session.ts`
- destinationPath: 默认不复制；如后续发现 DQ 缺口，再逐文件登记目标
- licenseOrAuthorizationBasis: AGPL-3.0；仓库 `LICENSE` 与 `NOTICE`，且声明基于 Infinite Canvas 的指定基线
- reuseType: 架构对照和少量算法候选
- DQAdaptation: DQ 已具备相近的素材、任务和 Agent 能力，不整体移植；仅比较 Leafer 视口、素材托盘和任务回写的边界设计
- requiredTests: 如实际采用，必须增加上游归属/NOTICE 审计、用户隔离、任务恢复、素材引用与现有 DQ 行为对照测试

### R-006 Loomic

- sourceRepo: `https://github.com/fancyboi999/Loomic.git`
- sourceCommit: `875ff78296c990b29fcfc74b2f528e2825b1812c`
- sourcePath: `apps/server/src/agent/tools/inspect-canvas.ts`; `apps/server/src/agent/tools/manipulate-canvas.ts`; `apps/server/src/features/agent-runs/`; `apps/web/src/components/canvas-layers-panel.tsx`
- destinationPath: 禁止直接复制；仅可记录公开行为和接口思想
- licenseOrAuthorizationBasis: 根目录未发现许可证，当前没有可依赖的开源授权证据
- reuseType: 只读概念参考
- DQAdaptation: 自行实现 `inspect_design` / `apply_design_ops`，不复制源代码、提示词、字体或资产
- requiredTests: Design Ops 权限、schema 校验、长任务恢复、幂等和审计；授权状态变化前保持禁止复制

### R-007 Jaaz

- sourceRepo: `https://github.com/11cafe/jaaz.git`
- sourceCommit: `145dd85067be77e36d400637a595e19a7b07c77a`
- sourcePath: `react/src/routes/canvas.$id.tsx`; `react/src/stores/canvas.ts`; `react/src/components/canvas/`; `server/routers/canvas.py`; `server/tools/utils/image_canvas_utils.py`
- destinationPath: 禁止直接复制，除非提供覆盖 DQ 商业部署和衍生修改的书面商业授权
- licenseOrAuthorizationBasis: 自定义双许可证；社区许可明确限制组织多用户部署、修改、衍生和再分发
- reuseType: 产品行为参考，非源码复用
- DQAdaptation: 只观察入口、上下文工具条、画板列表和生成回写的通用交互，不复制实现和品牌资产
- requiredTests: 若未来获得书面授权，仍需逐文件登记、版权审计和 DQ 集成回归

### R-008 React Design Editor

- sourceRepo: `https://github.com/salgum1114/react-design-editor.git`
- sourceCommit: `aeba5d239e88e5abbbf41df836a4f9848c09852f`
- sourcePath: 待 Phase 1 按功能分层定位，当前只确认仓库用于复杂 Fabric 编辑器结构参考
- destinationPath: TBD
- licenseOrAuthorizationBasis: MIT；仓库 `LICENSE`
- reuseType: 候选结构参考
- DQAdaptation: 不整体移植旧技术栈；只在 Fabric PoC 出现明确缺口时提取最小实现
- requiredTests: 依实际提取能力补充；未登记具体源文件前不得复制

### R-009 tldraw SDK 5.2.5（DQ 现有依赖）

- sourceRepo: `https://github.com/tldraw/tldraw`
- sourceCommit: npm `gitHead=32f526615477f3554b62ead28d26d0fd374fb346`；tag `v5.2.5` peeled commit `32f526615477f3554b62ead28d26d0fd374fb346`
- sourcePath: npm 包；DQ 补丁为 `web/patches/@tldraw__editor@5.2.5.patch`
- destinationPath: 现有依赖；Phase 1 PoC 使用隔离目录，正式目标待选型
- licenseOrAuthorizationBasis: 包元数据声明 `SEE LICENSE IN LICENSE.md`；许可证原文允许开发环境，禁止生产环境，生产需 trial/commercial agreement 与 License Key；`NEXT_PUBLIC_TLDRAW_LICENSE_KEY` 当前为空。结论：技术通过但生产许可阻断。
- reuseType: 已有依赖的生产适用性核验，不等于已批准扩大使用
- DQAdaptation: 先验证现有补丁、React 19/Next 16、完整画板和生产授权，再决定是否采用
- requiredTests: 许可证 Gate、补丁回归、SSR/客户端边界、多 Frame、导出、文档恢复、性能和 `/canvas` 回归

### R-010 Fabric.js 7.4.0（Phase 1 实际使用）

- sourceRepo: `https://github.com/fabricjs/fabric.js`
- sourceCommit: npm `gitHead=ce64f450bad811750cb5a75aa749fc1502c644be`; npm package `fabric@7.4.0`
- sourcePath: 依赖包 API；未复制上游源码文件
- destinationPath: `web/src/features/design-engine-poc/fabric/`
- licenseOrAuthorizationBasis: MIT；包内 `LICENSE` 已核验，生产使用许可明确
- reuseType: 依赖集成与 DQ 自写适配器，不是源码复制
- DQAdaptation: 显式左上原点、Frame clipPath、稳定 metadata、归一化 crop、单一 PoC adapter、历史与导出封装
- requiredTests: 统一 Gate、像素探针、10 次生命周期、200 元素测量、PNG/JPEG 1x/2x、`/canvas` 回归；均已执行，证据见 `phase-1-gate-report.md`

## 实际复用变更日志

### 2026-08-11 Phase 1

- 引入 `fabric@7.4.0` 依赖，目标为 `web/src/features/design-engine-poc/fabric/`；代码调用公开 API，未复制 Fabric、Canva Clone、React Design Editor 或其他研究仓库源码。
- `web/src/features/design-engine-poc/contract/`、`tldraw/`、`fabric/` 与比较页均由 DQ 针对统一 PoC 契约实现；第三方影响限于依赖 API、许可证和产品/架构研究。
- 测试结果、包体、许可证和修正记录见 `phase-1-gate-report.md`；Fabric MIT 版权与许可证由依赖包保留，当前没有新增 NOTICE 文件义务。

后续每次复制、移植或实质改写时，仍须在提交代码的同一阶段补充：具体源文件、目标文件、采用的行级/模块级范围、修改说明、测试结果和所需 NOTICE 更新。

### 2026-08-11 Phase 2

- 新增 `web/src/lib/design/` 正式领域契约，全部为 DQ 自写纯 TypeScript；未复制 Asui、tldraw Agent Template、OpenPencil、Loomic、Jaaz 或其他研究仓库源码。
- 从 Asui 一手源码吸收：严格判别命令、逐项 acknowledgement、归一化标注和内联媒体剔除原则；DQ 改为 Frame/元素、稳定资源 locator、revision 与 atomic/partial receipt。
- 从 tldraw Agent Template 一手源码吸收：选中元素优先的上下文层次和动作事务/diff 思想；DQ 不复制其 tldraw record、聊天 UI 或 SDK 依赖。
- 从 OpenPencil 一手源码目录与 IO/automation 分层吸收：持久文档、运行时 source state、自动化桥分离；DQ 不移植 Vue、CanvasKit 或文件系统实现。
- Loomic 与 Jaaz 继续只作产品行为参考，授权边界未变化；Phase 2 没有复制其代码、提示词或资产。
- Phase 2 测试覆盖严格 Schema、稳定资源、版本父链、导出隔离、上下文预算、Ops rollback/partial/revision/replay；不产生新增第三方 NOTICE 义务。

### 2026-08-13 P1-P6 共享工作台与导出

- `/design/[id]` 与 `/canvas/[id]` 共用无领域工作台 Chrome、主题 Token、工具描述、Right Rail、底部 Composer、任务托盘、素材选择和 Handoff 基础设施；两套文档 Store、Undo/Redo、保存队列和 Agent Action Adapter 保持隔离。
- `WorkspaceExportReview` 吸收 Asui 的候选审阅、逐项选择、背景切换和批量归档交互；它不导入 Fabric、Design Document、Canvas Node 或任一 Surface Store。
- 当前只有 Design 注入审阅器执行适配器。Canvas 已有项目包、媒体下载和派生结果语义与 Frame 切图不同，P6 不以同名按钮强行合并；这不等于“两套导出已经统一”。未来 Canvas 只有在形成明确的媒体候选集合与 receipt 后，才可复用同一无领域审阅器。
- Design 由当前 Fabric 投影生成 Frame 像素，支持 PNG/JPEG/WebP、1x-4x、透明/白色/Frame 背景、最大 320px 预览、单张下载和带 `manifest.json` 的 ZIP。资源解析、图片加载、revision 或编码失败会阻断整包，禁止导出占位图或残缺 ZIP。
- DQ 补充了上游交互之外的边界：单 Frame 1.2 亿像素、批量 2.4 亿像素预算；JPEG 空 Frame 背景铺白；浏览器实际 MIME 校验；同名文件去重；锁定 Frame 可导出但不写偏好；导出后恢复 Fabric 视口、背景、描边与阴影。
- 根 `NOTICE` 已记录固定 commit、版权归属并内嵌完整 Asui MIT 文本；P6 没有复制上游品牌素材、模型配置、密钥或服务端 API 实现。
