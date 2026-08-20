# Phase 6 工作审视报告

日期：2026-08-11（Asia/Shanghai）

## 原定目标

在 Phase 5 单一状态真源与串行保存协议上，实现 Frame 与基础元素的创建、选择、移动、缩放、旋转和基础属性编辑，并完成自动化、生产构建、浏览器、Docker 3000 部署和 Phase Gate 验收。

## 完成情况

- [x] 已完成：Frame、文字、矩形、椭圆、线条、箭头创建与单选。
- [x] 已完成：Frame 移动/缩放，元素移动/缩放/旋转；Frame 子元素局部坐标换算。
- [x] 已完成：Frame、元素公共属性以及文字/形状/线/箭头基础样式编辑。
- [x] 已完成：locked、Escape、Delete/Backspace 和 Frame 非级联删除边界。
- [x] 已完成：typed Ops、Store FIFO、Fabric intent 边界和保存刷新恢复。
- [x] 已完成：全量测试、静态检查、宿主与 Docker Node 22 build、浏览器验收、3000 部署和 Gate 报告。
- [ ] 未完成：正式 PostgreSQL 登录态下的编辑器浏览器验收。原因：正式 3000 没有可复用登录态，且不读取/猜测/重置密码；由隔离同产物 UI 验收、正式 readiness 和既有 PostgreSQL integration 补证。

## 发现的问题

| 严重程度         | 问题描述                                                                                                  | 根本原因                                                                         | 改进建议                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 必须改正（已改） | `design-editor-workbench.tsx` 最初使用 Ant Design Dropdown 承载形状入口；真实浏览器中菜单项点击未触发创建 | 在第一轮实现后过早把组件库的常规行为视为已验证，直到端到端阶段才检查             | UI 入口必须在真实浏览器中逐个点击；已换成显式内部菜单并重新构建、复验          |
| 应当改正（已补） | 初次 Gate 证据中 Frame 手势主要来自纯函数测试，真实 Canvas 手势证据集中在元素                             | 对共用事件桥的间接证据评价偏乐观，没有一开始按对象类型列验收矩阵                 | 对同一桥上的不同持久化 Op 分支分别留真实证据；已补 Frame 拖动/缩放、保存和清理 |
| 建议改进         | `operations.ts` 仍只在 parser 层严格限制 patch 字段，完整值类型继续由 executor 的 Document Schema 拒绝    | 复用单一 Schema 校验，避免维护两套值 parser；错误会较晚表现为 `DOCUMENT_INVALID` | Phase 7 若引入更复杂 Ops，评估抽取共享字段 parser，而不是复制 Schema 规则      |

## 做得好的地方

- 先冻结 Schema 可表达的边界，明确没有 Frame rotation，不制造只存在于 Fabric 的假状态。
- selection 收敛到项目 Store，表单 draft 与可写 Design Document 有清晰边界。
- Text/Line/Arrow 采用相对初始 scale，解决 Fabric 内部 bounds 不一致的结构性问题。
- 浏览器发现的问题没有降级为“已知偏差”，而是修改后重跑测试、构建和真实交互。
- 部署只重建 app/worker，PostgreSQL、rembg 和持久卷保持稳定；Phase 5 镜像保留回滚。

## 下次重点关注

- Phase 7 在编码前冻结多选、图层、历史事务和对齐/吸附的原子边界。
- ActiveSelection 只能是运行时投影，禁止从 Fabric stacking 或 selection 反向生成文档。
- 按“每一种新 Op 分支至少一个纯测试 + 一个真实交互路径”建立验收矩阵。
- 若正式 PostgreSQL 登录态仍不可用，继续明确隔离证据，不能把 readiness 写成完整 UI 验收。
