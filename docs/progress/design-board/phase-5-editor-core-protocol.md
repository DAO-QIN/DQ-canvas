# Phase 5：编辑器内核、保存与恢复协议

日期：2026-08-11
状态：已冻结，按本协议实现

## 1. 阶段目标

Phase 5 把 Phase 4 的只读 Shell 升级为可验证的正式编辑器内核，但只开放 Workspace 视口平移、缩放和适应内容：

- `DesignProject.document` 在一个项目级 Zustand vanilla Store 中作为唯一可写文档真源。
- Fabric.js 7.4.0 只订阅 Store 并生成运行时投影；Fabric 对象、缓存、选择和 viewport transform 不反向序列化为另一份文档。
- Workspace 视口变化通过新增的 typed Design Op `update-workspace` 进入同一执行器。
- 本地先用 `applyDesignOperationBatch` 校验并乐观应用，再将同一批次按顺序提交 `/operations`。
- 服务端确认后更新保存基线；刷新重新 GET 项目并恢复持久化视口。

本阶段仍不开放 Frame/元素创建、变换、图层、裁剪、素材、导出、Undo/Redo 或 AI；这些入口保持禁用。

## 2. 单一状态真源

允许的状态：

- Store：`project.document`、保存状态、服务端确认 revision、冲突服务端快照。
- React Shell：检查器开关等纯 UI 状态。
- Fabric：由文档生成的对象投影，以及一次指针手势期间尚未提交的瞬时 viewport。

禁止：

- React `useState` 保存第二份可编辑 Design Document。
- 从 `canvas.toJSON()` / Fabric 对象反向生成持久化文档。
- Fabric 事件直接调用项目 PATCH 或直接修改文档对象。
- 失败后用无条件 PATCH 覆盖服务端。

## 3. 保存队列

1. UI 产生 typed operations。
2. Store 使用当前 `document.revision` 组成 atomic batch，并由纯执行器乐观应用；每批只升一次 revision。
3. batch 进入项目级 FIFO；任意时刻最多一个 `/operations` 请求在途。
4. 服务端成功时记录确认 revision。若还有更高 revision 的本地草稿，不以旧响应覆盖草稿。
5. 网络失败保留原 batchId 和本地草稿，进入 `error`；用户重试发送同一 batch，依赖服务端 receipt 幂等恢复。
6. `409` 时停止队列、不覆盖本地草稿，读取并保存服务端快照，进入 `conflict`。
7. 用户只能显式选择“载入服务端版本”；Phase 5 不实现自动合并。

状态集合：`loading | saved | dirty | saving | error | conflict | not-found`。

## 4. Fabric 投影

- Frame 与已有元素按 Design Layer 顺序只读投影；图片在 Phase 8 资源解析前显示安全占位符。
- 文档坐标仍遵守 Phase 2：Frame 子元素使用 Frame 局部坐标，Workspace 元素使用 Workspace 坐标。
- Resize 只改变 Fabric 视口尺寸，不改文档。
- 中键/Alt 拖拽和滚轮缩放可在 Fabric 中即时预览；手势结束后只提交一个 `update-workspace`。
- 顶部和底部按钮通过同一个 Store 操作入口缩放/适应，不直接写 Fabric。

## 5. 恢复与离开保护

- 页面打开只从 Design Project GET hydrate Store。
- 服务端确认后显示保存时间与 revision；刷新后以服务端文档恢复视口。
- `dirty/saving/error/conflict` 时注册 `beforeunload` 保护；`saved` 时不拦截。
- 冲突态保留本地 revision 与服务端 revision，并提供显式重新载入服务端版本。

## 6. Phase Gate

1. Store 是唯一可写 Design Document，Fabric 源码不存在 `exportDocument`、`toJSON` 或项目 PATCH。
2. `update-workspace` 经 parse、executor、Route/Store 与 PostgreSQL/文件 Provider 现有链路持久化。
3. 连续本地批次严格串行；旧响应不能覆盖更高 revision 草稿。
4. 相同 batch 网络重试可接受 replay；409 停止并保留本地草稿。
5. 浏览器能缩放/适应、等待保存、刷新恢复；双标签能稳定触发并显示 revision 冲突。
6. Fabric 能投影当前 Schema 的 Frame 与基础元素，图片资源在 Phase 8 前不越权解析。
7. Design 定向测试、Canvas 回归、TypeScript、ESLint、Prettier、production build 和 Docker Node 22 构建通过。
