# Phase 4：独立入口、项目库与编辑器 Shell 协议

日期：2026-08-11
状态：已冻结，按本协议实现

## 1. 阶段目标

Phase 4 将 Phase 3 已验证的 Design Project API 接入正式产品界面：

- 在“项目”分组新增独立“我的画板”入口 `/design`，保留现有“我的画布” `/canvas`。
- `/design` 提供登录用户自己的项目列表、创建、打开、分页加载和删除。
- `/design/[id]` 提供全屏编辑器 Shell、只读项目装载、加载/错误/不存在状态和项目删除。
- 新版先在备用端口验收，通过后替换 Docker 旧版并接管 `3000`。

## 2. 数据与交互边界

- 客户端只调用 `/api/design/projects...`；不得读取或写入 Canvas Store、`canvas_projects` 或 `canvas-projects.json`。
- 列表删除和编辑器删除都必须携带服务端返回的 `revision`。遇到 `409` 时不得覆盖，应提示项目已变化并重新读取服务端状态。
- 编辑器 Shell 可以保存最近一次服务端项目快照用于展示，但不得修改 `document`，不得建立可独立写入的元素树、历史栈或自动保存队列。
- 本阶段不接 Fabric 正式编辑器、不调用 AI、不创建 Generation Task、不消费积分、不做素材上传或导出。

## 3. 页面状态

### 项目库 `/design`

- `loading`：首次加载显示明确加载状态，创建与删除入口不可误操作。
- `ready/items`：显示项目标题、更新时间、revision、Frame/元素/素材统计，支持打开与带 revision 删除。
- `ready/empty`：解释画板与旧画布的职责差异，并提供首个项目创建入口。
- `error`：保留错误信息和显式重试入口。
- `creating/deleting`：按钮具备 loading/disabled 状态，成功后以服务端返回结果更新或重新读取列表。
- `conflict`：删除返回 `409` 时不移除本地卡片，刷新列表并提示用户重新确认。

### 编辑器 Shell `/design/[id]`

- `loading`：保持全屏 Shell 骨架，避免退回普通内容页闪烁。
- `ready`：显示项目标题、同步状态、revision、统计、Workspace 占位区和只读检查器。
- `404`：显示项目不存在或无访问权限，并提供返回项目库入口。
- `error`：显示读取失败和重试入口。
- `conflict`：删除返回 `409` 时重新读取项目，保留页面并提示服务端已有更新。

## 4. Phase Gate

1. 导航能区分“我的画板”与“我的画布”，桌面和移动导航均由同一导航常量派生。
2. 创建、列表、打开、删除均通过 Phase 3 API，且删除携带正确 revision。
3. 401、404、409 与一般网络错误有明确前端语义，不静默失败。
4. `/design/[id]` 是全屏 Shell；没有引入正式编辑内核或第二份可写 Design Document 状态。
5. Design 定向测试、导航测试、TypeScript、ESLint、Prettier、Canvas 相邻回归和 production build 通过。
6. 备用端口实际验证登录用户创建、打开、冲突保护与删除路径后，才允许替换旧 3000。
