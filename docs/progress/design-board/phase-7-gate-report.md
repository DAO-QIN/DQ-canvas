# Phase 7 Gate Report：图层、排版、吸附与历史

日期：2026-08-11（Asia/Shanghai）
结论：PASS WITH KNOWN DEVIATION
下一阶段：停在 Phase 8 门前，未开放真实素材解析、裁剪或归属校验

## 1. 交付范围

- Store 选择协议升级为 Frame 或同作用域元素集合；Shift 追加/移除，跨作用域替换。locked 元素可单选查看，含 locked 的集合不可批量变换。
- Fabric 7 `ActiveSelection` 只开放整体移动，不开放集合缩放/旋转；手势结束生成一个原子 `update-transform[]`，不从 Fabric 导出文档。
- 实时吸附使用 8 屏幕像素阈值，按 zoom 转为场景距离；候选是同作用域可见兄弟与所属 Frame 的边/中心，辅助线只存在于 runtime 顶层上下文。
- 右侧图层面板以 `DesignDocument.layers` 为唯一真源并反向显示 z-order，支持前移、后移、置顶、置底、显隐、锁定和 Workspace/Frame 作用域迁移。
- locked 元素保持原图层索引；未锁定元素可在不挤动 locked 索引的前提下重排。
- 对齐支持左、水平居中、右、顶、垂直居中、底；分布支持水平/垂直等距。命令使用旋转后的视觉 AABB，并只生成原子 typed transform Ops。
- 跨作用域移动以 `move-elements + update-transform[]` 单批次保存，坐标转换保持场景位置。
- Store 维护最多 50 条 `{before, after, label}` 只读运行时历史；Undo/Redo 把目标差异重新编译成既有 typed Ops，以新批次进入同一 FIFO 并产生新 revision。
- 历史覆盖创建、删除、transform/style、层级、作用域和 annotation 恢复；协议无法表达的资源删除显式拒绝。视口不进入历史，Undo/Redo 保留后来调整的视口；hydrate/reload 清空历史。
- 快捷键开放 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`、`Ctrl/Cmd+Y`，error/conflict 状态禁用历史。

## 2. Gate 结果

| Gate               | 结果 | 证据                                                                                                               |
| ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| G1 单一状态真源    | PASS | 图层只读 `DesignDocument.layers`；Fabric ActiveSelection、吸附线和历史快照均为 runtime 投影                        |
| G2 typed 历史      | PASS | 删除元素/annotation 恢复、属性、重排、跨 scope、locked 往返由现有 Ops 编译；无 replace-document                    |
| G3 多选边界        | PASS | Store 校验 ID 唯一且同 frameId；浏览器三元素 Shift 多选稳定，分布入口启用                                          |
| G4 对齐与分布      | PASS | 纯测试覆盖旋转 AABB、视觉对齐和三对象等距；浏览器水平分布保存到新 revision                                         |
| G5 图层与作用域    | PASS | locked 固定索引测试通过；浏览器矩形置顶、Undo/Redo 顺序往返、移至 Workspace 刷新恢复                               |
| G6 吸附边界        | PASS | 阈值函数、同 scope 候选和 runtime-only 源码边界测试通过；无 Fabric JSON 导出路径                                   |
| G7 保存与历史      | PASS | Store 测试证明普通/Undo/Redo 三批 FIFO、reload 清栈、viewport ignore 且不被历史覆盖                                |
| G8 自动化回归      | PASS | 最终全套 Vitest：493 files passed、2 skipped；2286 tests passed、3 skipped；design-editor 相关 36 tests passed     |
| G9 静态与构建      | PASS | TypeScript strict、定向 ESLint/Prettier、diff check、宿主 production build、Docker Node 22 typecheck/build 通过    |
| G10 浏览器关键路径 | PASS | 创建 Frame/3 元素、多选、分布、图层、Undo/Redo、跨作用域、保存刷新及测试项目清理完成                               |
| G11 3000 部署      | PASS | `dq-new:phase7-perf` 接管 app/worker；live=200、ready=true、PostgreSQL/schema/encryption/worker healthy，restart=0 |
| G12 部署冒烟       | PASS | 正式 3000 的 live、ready、session、静态资源、首页/login/register/gallery/design 共 11 项全为 200                   |

## 3. 浏览器验收证据

Phase 7 production 构建在隔离 3100 文件 Provider 登录态完成；随后只补充 Undo/Redo 保留当前 viewport 的 Store 边界，该补丁另由定向测试、类型检查和最终 Docker Node 22 build 验证：

1. 创建 `Phase 7 Gate 20260811`，创建 1 Frame、矩形、文字和椭圆，保存到 r4。
2. 首轮三元素 Shift 多选暴露程序化 `setSelection` 触发 `selection:cleared` 的反向清空缺陷；修正投影期事件抑制后重建并复验，三层同时保持选中且分布按钮启用。
3. 执行水平等距分布并保存为 r5。
4. 单选矩形置顶后面板顺序为 `矩形、椭圆、文字`；Undo 恢复为 `椭圆、文字、矩形`；Redo 再次回到置顶顺序，均保存完成。
5. 把矩形从 Frame 移到 Workspace，刷新后 Workspace 图层仍包含矩形；刷新后撤销按钮按协议禁用。
6. 删除验收项目，项目列表恢复 0；没有留下测试业务数据。
7. 浏览器没有 DQ 自身 warn/error；仅记录用户安装的 Immersive Translate 扩展动态翻译版本不匹配错误。

### 拖动性能补充验收

1. 在同一最终 production 构建的隔离 3100 中创建 `拖动性能验收 20260811`，构造 1 个 Frame 与 39 个文字/形状子对象。
2. 单对象连续曲线拖动时，吸附辅助线正常出现且没有阈值边缘反复跳动；手势结束只产生一个新 revision。
3. 两个同 Frame 元素 Shift 多选后整体拖动，选区保持完整并只产生一个批量 transform revision。
4. 拖动含 39 个子对象的 Frame，子对象视觉同步；松手保存后刷新仍为 r42，Frame 与子对象没有漂移。
5. 页面没有 DQ 自身 warn/error；验收项目已删除，隔离 3100 已停止。
6. 本次验收确认真实 pointer/Fabric/保存链路行为，但尚未建立浏览器 FPS、长任务或 P95 帧耗时自动基线；后续应补 PerformanceObserver 或专用 trace 基准，避免只依赖人工手感。

## 4. 部署状态

- `.env` 的 `DQ_IMAGE=dq-new:phase7-perf`。
- 性能修复镜像 ID：`sha256:dcca142ad69984166fee46cd140e4017d9750ea6906018f1295c7dcda48bc4f5`。
- 性能修复前 Phase 7 回滚镜像保留：`sha256:0f2a92c2ac6dad7df1da3f426fbc3eb7ee55a5412c889bbbe5f58dbe1ff83cfb`。
- Phase 6 回滚镜像保留：`sha256:0281304342e98498f4e518fc5b935d63fd262c408ac143b5845a5429d1e48330`。
- `dq` 与 `dq-generation-worker` 使用 `dq-new:phase7-perf`，restart count 均为 0。
- readiness：ready=true，provider=postgres，database/schema/encryption/generation worker 全部健康。
- 只使用 `--no-deps --force-recreate` 重建 app/worker；`dq-postgres` 与 `dq-rembg` 的容器 ID、启动时间、restart count 未变化，`dq-new_dq-postgres` 与 `dq-new_dq-data` 卷保持原位。

## 5. 已知偏差

### D1：正式 PostgreSQL 浏览器仍缺少登录态

- 正式 3000 已使用 PostgreSQL 且 readiness/部署冒烟全绿，但现有 Chrome 标签位于 `/login`，没有可复用正式登录态。
- 未读取、猜测或重置用户密码，也未绕过认证。
- 同一最终 Phase 7 production 产物已在隔离文件 Provider 登录态完成完整 UI 路径；正式 3000 通过 PostgreSQL readiness、部署冒烟和既有 Ops/PostgreSQL 集成测试。
- 这是 Phase 4 延续的部署补证偏差，不是 Phase 7 新引入的功能缺陷。

## 6. 工作审视

- 做对：先用 typed history compiler 证明删除、annotation、scope 和 locked 往返可表达，再接 UI，避免增加第二写入口。
- 做对：把视口排除出历史，并在最终审视中补上 Undo/Redo 保留后来视口的测试，避免 runtime 状态被旧快照覆盖。
- 做对：真实浏览器捕获 ActiveSelection 程序化切换的事件回流缺陷，修复后重新生产构建并复验，没有把它降级成偏差。
- 改进点：吸附纯算法和 runtime 边界已有测试，但浏览器验收没有稳定读取 Fabric 顶层辅助线像素；Phase 8 后若引入截图基准，应补视觉回归。
- 后续重点：Phase 8 的真实图片必须继续遵守稳定资源 locator、所有权校验和代理加载边界，不能让 Fabric 直接持有可过期签名 URL 作为文档状态。
