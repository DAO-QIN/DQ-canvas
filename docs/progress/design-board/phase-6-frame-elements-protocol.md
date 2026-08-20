# Phase 6：Frame 与基础元素编辑协议

日期：2026-08-11
状态：已冻结，按本协议实现

## 1. 阶段目标

在 Phase 5 的项目级 Store、typed Design Ops、FIFO 保存与冲突协议之上，开放可持久化的基础编辑闭环：

- 创建、单选、移动和缩放 Frame；
- 创建、单选、移动、缩放和旋转文字、矩形、椭圆、线条与箭头；
- 在检查器编辑 Frame、元素公共属性和各元素的基础样式；
- 删除未锁定元素与空 Frame；
- 每次创建、变换、属性编辑和删除均通过一个 atomic typed Op 批次进入既有保存队列。

Frame 的正式 Schema 没有 rotation 字段，因此本阶段不提供 Frame 旋转；元素继续使用 `DesignTransform.rotation`。图片只保留 Phase 5 安全占位投影，不开放创建或资源解析。

## 2. 状态边界

- `store.project.document` 仍是唯一可写 Design Document。
- `selection` 是同一项目 Store 中的编辑器运行时状态，不进入 Document、不持久化，也不参与 revision。
- Fabric 只保存投影对象和一次指针手势期间的瞬时值；手势结束只为目标对象生成一个 transform intent。
- Fabric 不得导出整份文档，不得调用 `canvas.toJSON()`，不得直接调用项目 API。
- 检查器允许保存输入草稿，但草稿只属于单个表单字段；blur 或 Enter 时才转换为 typed Op。

本阶段 selection 是：

```ts
type DesignEditorSelection =
  { kind: "frame"; id: string } | { kind: "element"; id: string } | null;
```

只开放单选。空白点击与 Escape 清空；重新 hydrate 时仅保留仍存在的对象；删除选中对象后清空。

## 3. 创建协议

工具栏开放 Frame、文字、矩形、椭圆、线条和箭头按钮。点击即按冻结默认值创建，不在本阶段实现拖拽绘制。

- Frame：默认 `1200 × 1200`、白色背景、PNG/1x/frame 导出设置；放在当前视口中心，并以 48px 错位避免完全重叠。
- 元素：若选中 Frame，或选中某个 Frame 内元素，则创建到该 Frame；否则优先使用第一个未锁定 Frame，没有可用 Frame 时创建到 Workspace。
- 新元素放在目标作用域中心附近，并按同作用域元素数做小幅错位。
- 新对象插入目标 layer 末尾并立即成为 selection。
- 文字默认 480 × 120；矩形 320 × 220；椭圆 260 × 260；线条 360 × 1；箭头 360 × 120。

所有默认对象必须先通过现有 `applyDesignOperationBatch` 与完整 Document Schema 校验，再进入本地草稿和保存队列。

## 4. Fabric 变换桥

每个投影对象只携带运行时 identity 与基线：对象类型、Document ID、Frame ID、原始 transform、初始 Fabric scale。Fabric 不携带第二份 Document。

手势结束时：

- Frame 生成一个 `update-frame`，仅提交 x、y、width、height；尺寸取整并限制在 Schema 范围内。
- 元素生成一个 `update-transform`；宽高按“原始 Document 尺寸 × Fabric scale 相对初始 scale 的比例”计算，避免 Textbox、Line 与 Arrow 的 Fabric 内部 bounds 差异污染文档尺寸。
- Frame 子元素的 Fabric 场景坐标减去当前 Frame x/y 后转回局部坐标。
- 禁止缩放控制柄穿越对象产生隐式 flip；本阶段保留已有 `flipX/flipY`，不提供新增 flip 操作。
- 移动 Frame 时，子元素可在 Fabric 内跟随预览；提交时仍只提交 Frame Op，随后由 Store 文档重新投影。
- locked 对象可以选择和查看，但不能移动、缩放、旋转或删除；检查器允许用显式 `locked: false` 解锁。

## 5. 属性与删除协议

Frame 检查器开放 name、x、y、width、height、background、locked。元素公共项开放 name、x、y、width、height、rotation、opacity、locked。

类型属性：

- Text：text、fontSize、fontWeight、fill、align；
- Rectangle / Ellipse：fill、stroke、strokeWidth，Rectangle 另有 cornerRadius；
- Line：stroke、strokeWidth、cap；
- Arrow：stroke、strokeWidth、startHead、endHead。

为保持外部契约清晰，新增 `update-shape`、`update-line`、`update-arrow` typed Ops；服务端仍复用统一 parser、executor、receipt 与 provider 通道。

Delete / Backspace 只删除未锁定元素或没有子元素的未锁定 Frame。输入框、textarea、select 或 contenteditable 获得焦点时不响应快捷键。有子元素的 Frame 不静默级联删除。

## 6. 明确不做

- 多选、框选、ActiveSelection、跨 Frame 拖动；
- Undo/Redo、复制粘贴、方向键微移；
- 图片创建、上传、受保护资源解析；
- 图层面板、隐藏开关、裁剪、导出、AI 操作；
- Fabric 文档反向序列化或未经 Ops 的保存旁路。

## 7. Phase Gate

1. 创建的 Frame 和五类基础元素均通过 Schema/Executor 校验，并保存、刷新恢复。
2. selection 只有 Store 一个运行时真源，不进入 Document；删除、reload 后无悬空 selection。
3. Frame 与元素单对象移动/缩放正确；元素旋转正确；Frame 子元素场景坐标正确还原为局部坐标。
4. locked 对象可选、不可变换/删除且能显式解锁；有子元素 Frame 不被静默级联删除。
5. 属性检查器按 blur/Enter 提交 typed Ops，类型属性通过专用 Op 持久化。
6. Fabric 边界测试继续证明不存在 `exportDocument`、`toJSON`、项目 fetch/PATCH 或整文档回写。
7. 定向测试、全量 Vitest、TypeScript、ESLint、Prettier、production build 与 Docker Node 22 构建通过。
8. 浏览器完成创建、选择、变换、属性修改、删除、保存与刷新恢复验收；Phase 6 镜像接管 `127.0.0.1:3000`，PostgreSQL、worker 与既有卷保持健康。
