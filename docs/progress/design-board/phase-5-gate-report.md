# Phase 5 Gate Report：编辑器内核、保存与恢复

日期：2026-08-11（Asia/Shanghai）
结论：PASS WITH KNOWN DEVIATIONS
下一阶段：停在 Phase 6 门前，未开放 Frame 与元素编辑

## 1. 交付范围

- 项目级 Zustand vanilla Store 持有唯一可写 `DesignProject.document`；React 仅订阅快照，Fabric.js 7.4.0 只读投影。
- 新增正式 typed Design Op `update-workspace`，支持 Workspace 背景与 viewport 的 strict parse、纯执行器乐观应用、服务端 Ops 持久化和 revision 递增。
- 保存队列使用项目级 FIFO；同一时刻最多一个请求在途。网络失败保留原 batchId，用户重试可接受服务端 `replayed` receipt。
- `409` 停止队列并保留本地草稿，另行读取服务端快照；不自动覆盖、不自动合并，只允许用户显式载入服务端版本。
- 正式 Fabric 工作区投影现有 Frame、文本、形状、线、箭头和图片安全占位符；Frame 子元素采用 Frame 局部坐标，Workspace 元素采用绝对坐标。
- 开放滚轮缩放、Alt/中键平移、缩放按钮和适应内容；每次手势最终只提交一个 `update-workspace` Op。
- 顶栏与错误条覆盖 `loading / saved / dirty / saving / error / conflict / not-found`；未保存、保存中、错误和冲突状态注册离开保护。
- Frame/元素创建编辑、图层、裁剪、素材读取、导出、Undo/Redo、AI 和积分消费继续禁用。
- 本地镜像 `dq-new:phase5` 已通过原 Compose 的 PostgreSQL、rembg、持久卷和 generation worker 接管 `127.0.0.1:3000`；Phase 4 镜像保留用于快速回滚。

## 2. Gate 结果

| Gate | 结果 | 证据 |
| --- | --- | --- |
| G1 单一状态真源 | PASS | 每个编辑页创建独立 vanilla Store；文档只由 `hydrate` 与 typed Ops 更新，路由页为薄控制器 |
| G2 Fabric 投影边界 | PASS | Adapter 只提供 `project / previewViewport / resize / fitViewport / destroy`；源码无 `exportDocument`、`toJSON`、fetch 或项目 PATCH |
| G3 Workspace Ops | PASS | `update-workspace` 已接入 strict parser、executor、API client 与正式 Store；单次操作只升一个 revision |
| G4 串行保存与重试 | PASS | Store 单测覆盖连续 FIFO、旧响应不覆盖新草稿、失败保留同 batchId、接受 replay、destroy 忽略迟到响应 |
| G5 冲突保护 | PASS | Store 单测与双标签浏览器验证均证明 409 保留本地草稿和远端快照，只有显式操作才载入服务端版本 |
| G6 刷新恢复 | PASS | 浏览器由 r0/100% 放大至 r1/120%，保存后刷新仍为 r1/120% |
| G7 Fabric Schema 投影 | PASS | Frame/基础元素按显式 layer 顺序投影；图片在 Phase 8 前仅显示安全占位符，不解析受保护 locator |
| G8 自动化回归 | PASS | 全套 Vitest：490 files passed、2 skipped；2257 tests passed、3 skipped；Canvas 专项 13 tests passed |
| G9 静态与构建 | PASS | TypeScript strict、定向 ESLint/Prettier、`git diff --check` 通过；宿主机与 Docker Node 22 production build 均通过 |
| G10 浏览器关键路径 | PASS | 隔离文件 Provider 登录态完成创建、保存、刷新、双标签冲突、显式载入与测试项目清理；应用自身无控制台错误 |
| G11 3000 部署 | PASS | `ready=true`、provider=`postgres`、database/schema/encryption/worker healthy；app/worker 为 phase5 且 restart=0 |

## 3. 浏览器验收证据

同一 Phase 5 production 构建在隔离的 3100 文件 Provider 登录态完成：

1. 创建 `Phase 5 Gate 20260811`，进入编辑器显示 r0、100%、已保存。
2. 点击放大后即时显示“未保存”，自动保存后为 r1、120%、已保存。
3. 刷新页面后仍为 r1、120%、已保存，证明服务端恢复生效。
4. 双标签同时从 r1/120% 打开；A 保存为 r2/144%。
5. B 从旧 r1 缩小产生本地 r2/100%，保存返回 409；界面显示“版本冲突”，本地草稿仍为 100%，远端快照为 r2。
6. B 显式选择“放弃本地草稿并载入服务端版本”后恢复为 r2/144%、已保存。
7. 删除验收项目，列表回到 0 个项目。

浏览器控制台没有应用自身的 warn/error；仅记录到用户已安装的 Immersive Translate 扩展版本不匹配报错，来源为 `chrome-extension://...`，与 DQ 无关。

## 4. 部署状态

- `DQ_IMAGE=dq-new:phase5`。
- phase5 镜像 ID：`sha256:bc10494e55d05ac4869c05a741fcddcb2acf72e3f21143cbe2ddb43c42c2a640`。
- Phase 4 回滚镜像仍保留：`sha256:2c3b9a3968ebc1032a7388b3d39a1ac536efb8fa55600962b4f2c0d3453344a0`。
- `dq` 与 `dq-generation-worker` 均使用 phase5；restart count 为 0。
- `dq-postgres` 容器 ID、启动时间和 `dq-new_dq-postgres` 卷均未改变；数据库/schema ready。
- `dq-new_dq-data` 仍挂载到 app，未删除或迁移。
- Compose 由于依赖配置哈希重建了 `dq-rembg` 容器；镜像保持原 ID，重建后健康，未涉及持久数据库或媒体卷删除。

## 5. 已知偏差

### D1：最终 PostgreSQL 浏览器仍缺少登录态

- 事实：正式 3000 已明确使用 PostgreSQL，ready/schema/worker 均健康；浏览器登录态属于隔离文件 Provider，切换到 PostgreSQL 后不能复用。
- 约束：未读取、猜测或重置用户密码，未绕过认证。
- 隔离证据：相同 phase5 production 产物已完成完整 UI 路径；正式 3000 通过 PostgreSQL readiness，Phase 3 已完成真实 PostgreSQL Ops integration。
- 结论：属于阶段 4 延续的部署补证偏差，不是 Phase 5 新引入的功能缺陷。

### D2：本轮未重复执行宿主机 PostgreSQL integration

- 事实：PostgreSQL 容器只在 Compose 网络暴露 5432，没有发布到宿主机；宿主 Vitest 直连得到 `ECONNREFUSED`。
- 处理：没有为了测试降低数据库网络隔离，也没有修改 Compose 安全拓扑。
- 隔离证据：容器内 `pg_isready` 成功；正式应用通过相同数据库连接返回 `provider=postgres`、database/schema healthy；Phase 3 的 PostgreSQL integration 已验证 Ops receipt/replay/conflict 和级联；本阶段新增 Op 走同一执行/存储通道，并由 54 项定向测试及文件 Provider 浏览器端到端覆盖。

## 6. 工作审视

- 做对：先冻结单一真源和冲突协议，再接 Fabric；没有沿用 PoC 的反向文档导出。
- 做对：测试先证明 Store 队列，再接 UI，避免把竞态问题藏在浏览器交互里。
- 纠正：浏览器验收发现 `/design` 空态仍写“下一阶段接入编辑内核”，已更新为当前能力说明。
- 必须改正（已完成）：自审发现 Store 原先只核对服务端 revision，未同时核对 batchId、base/result revision 和 project/document revision；异常回执存在被误确认的理论风险。现已实施全字段一致性校验并补回归测试。
- 纠正：首次 Compose `up app generation-worker` 仍因依赖配置哈希重建 rembg；最终自审镜像部署已改用 `--no-deps`，数据库和 rembg 未再次重启。
- 后续重点：Phase 6 必须继续让 Fabric 只表达瞬时手势和渲染，Frame/元素正式修改统一经 typed Ops；不得提前引入图层、素材、AI 或导出。
