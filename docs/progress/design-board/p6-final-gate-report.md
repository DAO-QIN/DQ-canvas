# P6 Final Gate Report：共享工作台导出与发布收口

日期：2026-08-14（Asia/Shanghai）
结论：PASS（本地 production 发布就绪）
发布状态：尚未执行线上灰度；必须按 Surface 重新构建

## 1. 原定目标

- 参考固定 Asui Canvas revision 的布局与切图交互，统一 Canvas/Design 的工作台语言，同时保留两套领域真源。
- 抽取无领域导出审阅器，由 Surface 注入真实执行能力。
- 完成 Design Frame 原始尺寸 PNG/JPEG/WebP、1x-4x、背景与批量归档。
- 完成快捷键、焦点、键盘可达、reduced-motion、三档响应式和 200 元素性能回归。
- 完成许可证/复用记录、分 Surface 灰度、上线与回滚文档，并通过 production、浏览器和全量静态 Gate。

## 2. 完成情况

- [x] `WorkspaceExportReview` 只依赖通用导出项和执行回调，不依赖 Fabric、`DesignDocument` 或 Canvas 类型。
- [x] Design 通过当前 Fabric Adapter 导出真实 Frame 像素；资源、图片加载、revision、编码和 MIME 均为强失败边界。
- [x] 单张直接下载；多张生成 ZIP 与 `manifest.json`；支持 PNG/JPEG/WebP、1x-4x、透明/白色/Frame 背景和质量设置。
- [x] `Ctrl/Cmd+Shift+E`、Dialog 键盘操作、焦点返回、reduced-motion、1440/860/520 布局和窄屏 Rail 隐藏完成。
- [x] 分 Surface 构建时开关、Asui MIT/NOTICE、复用登记、发布与回滚说明完成；旧布局保留至少一个稳定发布周期。
- [x] production、真实下载/像素、完整 Chromium、200 元素性能、Vitest、typecheck、ESLint 与 diff Gate 通过。
- [ ] 外部文本/图片/视频模型真实联调未通过：三次均为 HTTP 401，额度已用完，本轮不再调用。
- [ ] 线上灰度尚未执行：这是发布动作，不由本地 Gate 冒充完成。

## 3. Gate 证据

| Gate | 结果 | 证据 |
| --- | --- | --- |
| Production build | PASS | `.next-p6-export-final3-20260814` 编译成功，页面生成 67/67，`BUILD_ID` 与 standalone server 存在 |
| 导出像素 | PASS | 64x48 PNG 首像素 `[255,0,0,255]`；32x24 WebP 含 alpha=0；ZIP 文件、manifest、尺寸一致 |
| 聚焦 Chromium | PASS | 安装前置 + 导出/响应式 `5/5` |
| 完整工作区 Chromium | PASS | 安装前置 + `creative-workspace.spec.ts` `20/20` |
| 响应式与可访问性 | PASS | 1440/860/520 无溢出；Rail 动画后不可见；Dialog 关闭后焦点返回触发按钮；三张截图人工审视通过 |
| 200 元素性能 | PASS | Fabric 三轮 63.6/55.8/57.9ms，中位 57.9ms、最差 63.6ms、长任务 0；完整 Gate 三轮通过 |
| 单元/契约测试 | PASS | 561 文件通过、2 跳过；2744 测试通过、3 跳过 |
| 静态检查 | PASS | `pnpm typecheck`、`eslint . --quiet`、`git diff --check` |
| 许可证与发布 | PASS | 固定 Asui commit、完整 MIT 文本、复用登记、灰度/回滚说明齐全 |
| 外部模型 | NOT PASSED | 文本/图片/视频各一次请求均为 401；不能宣称联调成功 |

## 4. 领域边界

- Design 继续以 `DesignDocument + Design Ops` 为文档真源，以 Fabric 为渲染投影和导出执行器。
- Canvas 继续以 Node/Connection Store 与 Canvas Agent Ops 为真源；项目包和单媒体导出不等同于 Frame 切图。
- 两个 Surface 共用布局、Composer、任务恢复、素材、Agent、Handoff 和无领域 UI 基础设施，不共享文档或渲染实现。
- Canvas 暂不消费 `WorkspaceExportReview`。只有出现真实的多项可审阅媒体导出需求时，才注入 Canvas 专属执行器；禁止为了代码复用伪造 Frame。

## 5. 工作审视报告

### 发现的问题

| 严重程度 | 具体问题 | 根本原因 | 改进结果/建议 |
| --- | --- | --- | --- |
| 必须改正 | 首次 production PNG Gate 中红色 Frame 左上像素为 `[255,0,0,143]` | 把 Fabric Frame Rect 当导出底色，裁剪边界抗锯齿进入结果像素 | 改由 Canvas `backgroundColor` 绘制底色，导出期间隐藏 Frame Rect，并以 final3 真实下载复验 alpha=255 |
| 应当改正 | 全量 Vitest 首跑 1 项失败：移动端 CSS 契约未包含新增 `.exportAction` 例外 | UI 为保留窄屏导出入口已更新，静态契约仍表达旧选择器 | 更新契约并完整重跑，最终 2744/2744 非跳过项通过 |
| 应当改正 | 隔离 Next 构建把多个 `.next-p4*/.next-p5*/.next-p6*` 路径追加到 `tsconfig.json` | Next 自动配置与多构建目录叠加，形成无关配置噪声 | 删除临时 include 并恢复原文件内容；后续隔离构建后固定检查 `tsconfig.json` |
| 建议改进 | 首次聚焦 E2E 被工具超时中止后复用同一数据目录，安装前置不再是 fresh deployment | 未在重新执行前把“已启动过的数据目录”视为一次性资源 | 不删除现场，改用全新目录重跑；以后每次 E2E 运行使用唯一目录并先断言不存在 |
| 外部阻断 | 模型三通道均返回 401 | 上游凭据/鉴权状态不可由本地代码修正，且三次额度已用完 | 保留为独立未通过项；取得有效凭据后分别重跑文本、图片、视频验收，不修改客户端绕过服务端配置 |

### 做得好的地方

- 真实 PNG 像素检查发现了普通尺寸断言无法发现的半透明边缘问题，并在新 production 产物上复验修复。
- 导出失败采用强边界：不会把占位图、过期 revision、错误 MIME 或不完整 ZIP 当成功结果。
- 共用边界停在无领域 UI 和基础设施，没有把 Canvas 项目包、Design Frame 与两套领域 Store 强行合并。
- 自动断言之外人工查看三档截图，确认紧凑布局中的文字、控件和 Footer 真实可读。

### 下次重点关注

- 线上发布必须按 Design -> Canvas 顺序使用独立构建产物灰度，并观察保存冲突、重复 receipt、扣费、恢复和导出失败率。
- 旧布局至少保留一个稳定发布周期；删除必须单独提交，不能与首次上线捆绑。
- 获取有效上游鉴权后补真实模型三通道证据；在此之前不得把 fixture 成功描述为外部模型成功。
- 隔离 production build 后检查 `tsconfig.json` 与 `next-env.d.ts`，避免 Next 自动改写混入业务变更。

## 6. 发布决定

本地实现与质量 Gate 允许进入生产灰度，不代表已在线上开启。两个 `NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_*` 开关默认关闭且在构建时固化；发布人员必须按 `p6-rollout-and-rollback.md` 生成目标产物、验证旧项目保存恢复，再逐 Surface 放量。
