# Phase 2 执行协议：Design Document 与 Design Ops 契约

状态：执行中；完成后必须停在 Phase 3 门前
日期：2026-08-11
目标：把 Phase 1 的引擎 PoC 结论升级为与 Fabric.js 无关、可校验、可迁移、可测试的正式画板领域契约

## 1. 本阶段边界

本阶段允许：

- 在 `web/src/lib/design/` 新增纯 TypeScript 领域代码和测试。
- 冻结 Design Document、稳定资源引用、导出计划、历史事务、Design Context 与 Design Ops 的边界。
- 更新 ADR、源码复用登记、实施状态与 Phase 2 Gate。

本阶段禁止：

- 修改数据库 Schema、Repository、文件 Provider 或 Route Handler。
- 新增正式 `/design` 导航、项目列表或编辑器页面。
- 调用真实模型、创建 Generation Task、扣积分或写对象存储。
- 把 Fabric、React、Zustand、`server-only` 或临时签名 URL 引入领域核心。

## 2. 冻结目录与职责

```text
web/src/lib/design/
|- schema.ts                 # 正式领域类型；不含引擎运行时字段
|- limits.ts                 # 文档容量和数值上限
|- validation.ts             # 严格解析、未知字段拒绝、规范化
|- migration.ts              # 版本入口；只写当前版，未知版拒绝
|- resources.ts              # 稳定 locator 与运行时 resolver 边界
|- export.ts                 # 单 Frame 导出计划，不执行像素渲染
|- history.ts                # 非持久化历史事务元数据
|- operations.ts             # 判别联合 Design Ops 与回执
|- operation-executor.ts     # UI/未来 Agent 共用的纯函数执行器
|- context.ts                # 选择优先、可预算的 Design Context
`- index.ts                  # 稳定公共导出面
```

Fabric 适配器、编辑器 Store、自动保存和服务端持久化不进入该目录；它们只能消费这里的契约。

## 3. Design Document 决策

- 当前写入版本为 `schemaVersion: 1`；所有读取先经过迁移入口，再做严格校验和数值规范化。
- 文档包含项目元数据、显式 `revision`、Workspace 恢复视口/辅助线、Frame、元素、逻辑资产、资产版本链、图层顺序与语义标注。
- 元素支持 `image`、`text`、`shape`、`line`、`arrow`；标注独立于可导出元素。
- 元素 `frameId: null` 表示 Workspace 层；Frame 导出只读取目标 Frame 的可见图层。
- 选择、hover、Fabric 对象、缓存、异步任务状态、签名 URL 和预览 URL 都不是文档字段。
- 资产版本只保存 `storage-key` 或 `library-asset` 稳定 locator；派生版本通过 `parentVersionId` 保留链路，不覆盖源版本。
- 资产 provenance 的 `sourceElementId` 是历史引用，可在源元素删除后保留，不能当作当前元素树强外键。
- 图层顺序为显式数组；元素对象本身不保存另一套 `zIndex` 真源。

## 4. Design Ops 决策

- 每批操作必须包含 `batchId`、`expectedRevision`、`mode`、`source` 和带稳定 `opId` 的判别联合操作。
- 禁止 JSON Patch、任意路径写入和把未校验对象直接合并进文档。
- `atomic` 批次任一操作失败时全部回滚；`partial` 批次保留合法操作并逐项返回结果。
- revision 不匹配时整批冲突，不尝试猜测或自动覆盖；Phase 3 通过 `If-Match`/等价机制传递该语义。
- 回执包含 batch 指纹、基础/结果 revision、每个操作的 `applied`、`rejected`、`rolled-back` 或 `skipped` 状态以及历史事务元数据。
- 重放由 Phase 3 保存的已知回执驱动；相同 `batchId + fingerprint` 返回 replay receipt，不再次修改文档；相同 batchId 不同内容明确冲突。

## 5. 资源、历史、导出与 Agent 边界

- 资源 resolver 以稳定 locator 为输入，临时 URL 只存在于运行时返回值；领域校验禁止 `data:`、`blob:`、HTTP URL、签名参数和 `..` 路径。
- Undo/Redo 保存文档操作事务；Generation Task 的 queued/running/error 状态留在 Shell/任务 Store，不制造历史项。
- 导出计划固定目标 Frame、像素尺寸、格式、倍率、背景、按图层排序的元素和去重后的资产版本；Workspace 元素与标注不进入 Frame 导出。
- Design Context 接收运行时选择与视口，按“选中元素 → 视口元素 → 其余元素”预算；选中元素不会因文本预算被整个丢弃，超长文本显式截断；上下文只携带稳定资源引用。
- 未来 UI 与 Agent 必须调用同一执行器；Agent 不获得 Fabric 对象或直接写 Store 的旁路。

## 6. 容量与失败策略

- 文档 JSON 最大 10 MiB、Frame 最大 100、元素最大 5,000、逻辑资产和资产版本各最大 2,000、标注最大 2,000。
- Frame 边长为 1–16,384 px；Workspace 坐标绝对值最大 1,000,000；数值统一到 0.001 精度。
- ID、标题、正文、字体、storage key 等均有独立字符串上限。
- 未知关键字段、重复 ID、悬空引用、非法父链、层级遗漏/重复、越界裁剪、非有限数值和运行时 URL全部明确失败，并返回可定位 path 的 issue。

## 7. Phase 2 Gate

以下项目必须全部通过：

1. 核心目录不存在 Fabric、React、Zustand、`server-only` 或浏览器全局依赖。
2. 正式多 Frame 商品图夹具能严格解析、规范化并稳定往返。
3. 未知字段、未来版本、重复/悬空 ID、资源 URL、非法裁剪、超限文档均被拒绝。
4. 资源派生链不覆盖源版本，循环父链被拒绝。
5. atomic 回滚、partial 回执、revision 冲突和幂等重放均有自动化测试。
6. Frame 导出计划排除 Workspace、其他 Frame、隐藏元素和标注，并输出正确像素尺寸。
7. Design Context 选择优先、预算截断且不泄漏运行时 URL。
8. 定向测试、TypeScript、定向 ESLint/Prettier、现有 `/canvas` 专项回归通过。
9. ADR-002、ADR-003、ADR-006、源码复用登记和实施状态与代码一致。
10. 没有数据库、正式导航、真实 AI、积分、对象存储或外部状态副作用。

Gate 通过后只输出 Phase 3 所需的数据形态、迁移与回滚前置条件，并停止等待用户确认。
