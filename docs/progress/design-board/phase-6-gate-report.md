# Phase 6 Gate Report：Frame 与基础元素

日期：2026-08-11（Asia/Shanghai）
结论：PASS WITH KNOWN DEVIATION
下一阶段：停在 Phase 7 门前，未开放图层、排版、对齐、吸附或历史

## 1. 交付范围

- Store 新增单选 `selection` 运行时状态；它不进入 Design Document、不保存，hydrate、服务端回执和删除后均校验悬空引用。
- 工具栏开放 Frame、文字、矩形、椭圆、线条和箭头的按钮创建；默认值和作用域选择冻结在纯命令工厂并由完整 Schema/Executor 校验。
- Fabric 对象带运行时 identity 和变换基线，开放单对象选择、移动、缩放以及元素旋转；手势结束只提交一个 `update-frame` 或 `update-transform` typed Op。
- Frame 子元素的场景坐标在提交时转回 Frame 局部坐标；Text、Line 与 Arrow 使用相对初始 Fabric scale 计算文档尺寸，不依赖内部包围盒。
- locked 对象可选择查看但不能移动、缩放、旋转或删除；检查器提供显式解锁。Frame 没有 rotation Schema 字段，因此只开放移动和缩放。
- 检查器开放 Frame 公共属性、元素公共变换/透明度以及文字、形状、线条、箭头的基础样式。字段以 draft 编辑，在 blur/Enter 时生成一个 Op。
- 新增 `update-shape`、`update-line`、`update-arrow` typed Ops，继续复用 parser、executor、receipt、API、文件/PostgreSQL provider 和 FIFO 保存协议。
- Escape 清空选择；Delete/Backspace 删除未锁定元素或空 Frame。含子元素 Frame 不静默级联删除；输入控件聚焦时不响应快捷键。
- 图片继续仅安全占位，不开放创建或资源解析；多选、图层、Undo/Redo、裁剪、导出和 AI 继续禁用。

## 2. Gate 结果

| Gate               | 结果 | 证据                                                                                                                 |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------- |
| G1 单一状态真源    | PASS | Document 只由 Store hydrate 与 typed Ops 更新；selection 只在同一 Store 中作为不持久化运行时状态                     |
| G2 创建协议        | PASS | Frame 与五类基础元素工厂通过 Schema/Executor；Frame layer、目标 scope 与末尾插入均由执行器保证                       |
| G3 Fabric 意图边界 | PASS | Adapter 只读取单目标瞬时值并发出 transform intent；源码无 `exportDocument`、`toJSON`、fetch 或 PATCH                 |
| G4 坐标与尺寸      | PASS | 纯测试覆盖 Frame 变换、Frame 局部坐标、Text 非 1 初始 scale；浏览器真实验证 Frame 与元素的拖动和控制柄缩放均持久化   |
| G5 locked 与删除   | PASS | locked 时字段禁用且真实拖动不改变 X；解锁后 Delete 删除元素；含子元素 Frame 不允许隐式级联                           |
| G6 属性编辑        | PASS | 文本、形状、线、箭头均有 typed 属性 Op；浏览器修改 Arrow rotation/strokeWidth，保存并刷新恢复                        |
| G7 保存恢复        | PASS | 隔离 production 文件 Provider 从 r0 创建到 r13；刷新恢复 1 Frame/5 元素及属性，删除后列表回到 0                      |
| G8 自动化回归      | PASS | 全套 Vitest：492 files passed、2 skipped；2269 tests passed、3 skipped；Phase 6 定向 32 tests passed                 |
| G9 静态与构建      | PASS | TypeScript strict、定向 ESLint、Prettier、`git diff --check`、宿主 production build 和 Docker Node 22 build 通过     |
| G10 浏览器关键路径 | PASS | 创建五类元素、Canvas 选择/拖动/缩放、属性、锁定/解锁、快捷删除、保存刷新与清理完成；应用无控制台错误                 |
| G11 3000 部署      | PASS | `dq-new:phase6` 接管 app/worker；ready=true、provider=postgres、database/schema/encryption/worker healthy，restart=0 |

## 3. 浏览器验收证据

同一 Phase 6 production 构建在隔离的 3100 文件 Provider 登录态完成：

1. 创建 `Phase 6 Gate 20260811`，进入编辑器显示 r0、已保存。
2. 创建 Frame、文字、矩形、椭圆、线条、箭头；检查器按类型显示对应字段。
3. 修改 Arrow rotation 为 27、strokeWidth 为 9，保存后达到 r8；刷新仍恢复 1 Frame / 5 元素。
4. 在 Fabric Canvas 中真实拖动 Arrow，X 从 516 变为 595.98 并保存为 r9。
5. 拖动右下控制柄，宽高从 360 × 120 变为 438.612 × 146.204，并保存为 r10。
6. 锁定后所有可变字段与删除按钮禁用，真实拖动后 X 保持 595.98；显式解锁后按 Delete，保存为 r13，元素数降为 4。
7. 删除验收项目，列表回到 0 个项目；没有保留测试业务数据。
8. 另建空白 Frame 补验项目：真实拖动将 x/y 从 81.5/-179 改为 141.485/-134 并保存为 r2；侧边控制柄将宽从 1200 改为 1139 并保存为 r3；随后删除项目，列表再次回到 0。

浏览器验收期间发现 Ant Design Dropdown 在当前真实交互中菜单项点击不可靠，已替换为编辑器内部显式菜单并重新构建复验。浏览器控制台没有 DQ 自身 warn/error；仅有用户安装的 Immersive Translate 扩展版本不匹配错误，来源为 `chrome-extension://...`。

## 4. 部署状态

- `.env` 的 `DQ_IMAGE=dq-new:phase6`。
- Phase 6 镜像 ID：`sha256:0281304342e98498f4e518fc5b935d63fd262c408ac143b5845a5429d1e48330`。
- Phase 5 回滚镜像保留：`sha256:bc10494e55d05ac4869c05a741fcddcb2acf72e3f21143cbe2ddb43c42c2a640`。
- `dq` 与 `dq-generation-worker` 使用 Phase 6，restart count 均为 0。
- `ready=true`、provider=`postgres`、database/schema/encryption/generation worker 全部健康。
- 本次只用 `--no-deps --force-recreate` 接管 app/worker；`dq-postgres` 与 `dq-rembg` 未重启，`dq-new_dq-postgres` 与 `dq-new_dq-data` 卷保持原位。

## 5. 已知偏差

### D1：最终 PostgreSQL 浏览器仍缺少登录态

- 正式 3000 已使用 PostgreSQL 且 readiness 全绿，但浏览器访问 `/design` 被正常认证重定向到登录页。
- 未读取、猜测或重置用户密码，也未绕过认证。
- 相同 Phase 6 production 产物已在隔离文件 Provider 登录态完成完整 UI 路径；正式 3000 通过 PostgreSQL readiness；Phase 3 已完成真实 PostgreSQL Ops integration。
- 这是阶段 4 延续的部署补证偏差，不是 Phase 6 新引入的编辑缺陷。

## 6. 工作审视

- 做对：先冻结 Schema 能表达的边界，明确 Frame 不支持旋转，避免在 Fabric 中制造无法持久化的状态。
- 做对：把 selection 放回项目级 Store，并把表单 draft 与 Design Document 区分开，没有形成第二份文档真源。
- 做对：为 Text/Line/Arrow 使用相对初始 scale，而不是把 Fabric 内部 bounds 当作文档宽高。
- 纠正：浏览器验收捕获形状 Dropdown 的实际点击缺陷，替换后重新执行生产构建、定向测试和浏览器复验。
- 后续重点：Phase 7 必须围绕图层顺序、多选事务、对齐/吸附和历史原子性重新冻结协议；不能让 ActiveSelection 或 Fabric stacking 成为持久状态源。
