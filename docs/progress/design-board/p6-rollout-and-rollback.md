# P6 共享工作台上线、灰度与回滚

更新时间：2026-08-13
适用入口：`/design/[id]`、`/canvas/[id]`

## 发布边界

- 两个 Surface 只共用布局 Chrome 与无领域基础设施。Design 继续使用 `DesignDocument + Design Ops + Fabric Adapter`；Canvas 继续使用 Node/Connection Store 与 Canvas Agent Ops。
- 本轮没有数据迁移，开关切换不会转换项目数据。新旧布局读取相同的各自领域 Store，因此回滚不需要回滚数据库 revision 或删除用户项目。
- Design 的 Frame 审阅器已经接通；Canvas 仍保留项目包和媒体导出语义，不宣称两套导出执行器已经统一。

## 构建时开关

两个开关默认关闭，只有精确值 `1` 启用：

| Design | Canvas | 构建变量 |
| --- | --- | --- |
| 旧布局 | 旧布局 | 两个变量均为 `0` 或未设置 |
| 新布局 | 旧布局 | `NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED=1` |
| 旧布局 | 新布局 | `NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED=1` |
| 新布局 | 新布局 | 两个变量均为 `1` |

`NEXT_PUBLIC_*` 会被 Next.js 固化进客户端产物。修改运行中容器的环境变量或只重启进程不会切换布局，必须使用目标变量重新构建并部署新产物。

PowerShell 的独立构建示例：

```powershell
$env:NEXT_DIST_DIR='.next-p6-design-canary'
$env:NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED='1'
$env:NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED='0'
pnpm build
```

## 灰度顺序

1. 基线：保留一个两个开关均关闭的可部署产物，并验证旧 Design/Canvas 均可打开和保存。
2. Design 灰度：只打开 Design。验证历史项目零迁移打开、编辑/保存/刷新、AI 结果恢复、Frame 单张与批量导出、1440/860/520 布局。
3. Canvas 灰度：Design 稳定后再打开 Canvas。验证历史节点/连线、保存回放、上传、派生结果、Composer、Agent 与 Handoff。
4. 全量：两个开关均打开后执行跨 Surface Handoff、全量 Vitest、typecheck、production build 和 Chromium Gate。

每一步使用独立构建产物；不得在同一个产物上通过运行期变量假装完成分流。

## 观测与停止条件

- 前端：未捕获异常、console error、横向溢出、Dock/Composer 重叠、关闭 Rail 仍可见、Dialog 超出视口。
- 保存：revision 冲突率、失败队列、重复 receipt、刷新后对象数量变化。
- 生成：重复扣费、重复任务、结果恢复失败、临时媒体进入持久文档。
- 导出：资源解析失败、实际 MIME 不匹配、像素预算拒绝、ZIP 缺项或 manifest 不一致。

任一 Surface 出现数据写入错误、重复扣费、历史项目打不开或保存后刷新丢失，立即停止该 Surface 灰度并回滚；纯视觉偏差可先关闭对应 Surface，再在隔离产物修复。

## 回滚

优先回滚到上一个已验证产物。若必须重新构建，只关闭受影响 Surface：

```powershell
$env:NEXT_DIST_DIR='.next-p6-design-rollback'
$env:NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_DESIGN_ENABLED='0'
$env:NEXT_PUBLIC_DQ_CREATIVE_WORKSPACE_CANVAS_ENABLED='1'
pnpm build
```

Canvas 回滚则反转两个值；全量回滚将两个值都设为 `0`。部署后必须重新验证登录、旧项目打开、一次真实保存和刷新恢复。不要回滚数据库或清理项目，因为新旧布局没有不同的数据格式。

## 旧布局删除条件

旧布局分支至少保留一个稳定发布周期。只有同时满足以下条件才可单独提交删除：

- Design 与 Canvas 均已在生产开启一个完整稳定周期；
- 没有未关闭的数据完整性、保存、计费或权限事故；
- 新布局关键路径、响应式和可访问性 Gate 持续通过；
- 已确认不再需要按 Surface 回滚，并保留可部署的前一稳定版本。

删除旧布局不得与 P6 首次上线放在同一发布中。
