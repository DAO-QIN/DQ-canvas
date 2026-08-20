# Phase 7 图层、排版与历史协议

状态：冻结（2026-08-11）

## 1. 边界

Phase 7 在 Phase 6 的 `DesignDocument -> typed DesignOperation -> FIFO persistence -> Fabric projection` 单向链路上增加图层、多选、排版、吸附和 Undo/Redo。`DesignDocument.layers` 仍是作用域内层级唯一真源；Fabric 对象、`ActiveSelection`、吸附线和历史快照都只是运行时投影，不允许反向导出为文档。

不增加 `replace-document` 或任意 JSON patch。Undo/Redo 必须把目标语义状态重新编译成现有 typed Ops，并作为新的 atomic batch 进入同一 FIFO、获得新 revision 和服务端回执。

## 2. 选择协议

```ts
type DesignEditorSelection =
  { kind: "frame"; id: string } | { kind: "elements"; ids: string[] } | null;
```

- 元素选择至少包含一个唯一 ID，且所有元素必须属于同一 layer scope。
- 普通点击替换选择；Shift 点击在同 scope 中追加或移除；跨 scope 的 Shift 点击替换选择。
- locked 元素可单选查看；包含 locked 元素的集合不可批量移动、对齐或分布。
- Phase 7 的 `ActiveSelection` 只允许整体移动，不开放集合缩放和旋转；单元素继续支持 Phase 6 的移动、缩放和旋转。

## 3. 图层与作用域

- `layer.elementIds[0]` 是最底层，末项是最顶层；图层面板反向显示。
- 支持前移、后移、置顶、置底、显隐、锁定和移动到 Workspace/Frame。
- 不存在 Frame 间的全局 z-order，因此不承诺跨 scope 的全局堆叠。
- 跨作用域移动以一个 atomic batch 提交：先 `move-elements`，再为每个元素提交 `update-transform`，确保场景位置不变。
- locked 元素必须保持在原图层索引；未锁定元素只有在不间接移动 locked 元素时才可重排。

## 4. 对齐、分布和吸附

- 对齐：左、水平居中、右、顶、垂直居中、底。
- 分布：水平或垂直等距，至少三个元素。
- 多选以所有对象旋转后的视觉 AABB 为基准；单个 Frame 子元素可对齐到所属 Frame。
- 排版命令只生成一个 atomic `update-transform[]`，不新增 Schema Op。
- 吸附阈值固定为 8 屏幕像素，并按当前 zoom 换算为场景单位。
- 候选仅包含同 scope 的可见兄弟元素，以及所属 Frame 的边缘和中心。
- 辅助线只存在于 Fabric runtime；手势结束提交 typed transform Op。多选仅对整体位移吸附。

## 5. Undo/Redo

- Store 最多保存 50 条 `{ before, after, label }` 只读运行时快照；快照不是可写真源。
- 普通语义 dispatch 成功后记录历史并清空 redo；viewport 等运行时操作传入 `history: "ignore"`。
- Undo/Redo 将当前文档到目标快照的差异编译为 typed Ops，以新 batch 持久化；Undo/Redo batch 自身不再入栈。
- 创建、删除、属性、层级、作用域迁移和 annotation 恢复必须可编译。现有协议无法表达的资源删除或不可变字段变更必须显式拒绝，不允许悄悄覆盖文档。
- load、hydrate、显式 reload 清空两栈；error/conflict/not-found/loading 时禁用 Undo/Redo。
- 快捷键：`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 或 `Ctrl/Cmd+Y` 重做。

## 6. Gate

1. 纯模型测试覆盖旋转 AABB、对齐/分布、图层重排、跨 scope 坐标保持和历史往返。
2. Store 测试证明历史 batch 仍串行进入 FIFO，失败/冲突不丢草稿，reload 清空历史。
3. Fabric 测试证明同 scope 多选、整体移动 intent 和 runtime guides 不修改文档。
4. 前端 build、真实浏览器关键路径、Docker 3000 readiness 与进程健康全部通过。
