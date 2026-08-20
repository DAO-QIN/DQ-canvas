# Phase 4 Gate Report：独立入口、项目库与编辑器 Shell

日期：2026-08-11（Asia/Shanghai）
结论：PASS WITH KNOWN DEVIATION
下一阶段：停在 Phase 5 门前，未进入正式编辑内核

## 1. 交付范围

- 新增正式 `/design` 项目库，以及桌面/移动导航共用的“我的画板”入口；原 `/canvas`“我的画布”保留。
- 新增 typed Design Project API client，支持分页列表、读取、创建和携带 `expectedRevision` 的删除。
- `/design` 覆盖加载、空态、错误、分页、创建、打开、删除和 `409` 冲突刷新提示。
- `/design/[id]` 使用独立全屏 Shell，覆盖加载、404、一般错误、项目展示、检查器、删除和冲突重新读取。
- Shell 只读取服务端 Design Document 快照；未引入 Fabric 正式编辑、第二份可写元素状态、自动保存、AI 或积分消费。
- 将本地阶段 4 源码构建为 `dq-new:phase4`，通过现有 Compose 的 PostgreSQL、rembg、媒体卷和 generation worker 接管 `127.0.0.1:3000`。

## 2. Gate 结果

| Gate                 | 结果 | 证据                                                                                                       |
| -------------------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| G1 独立入口          | PASS | 导航中“我的画板” `/design` 与“我的画布” `/canvas` 并存，路径高亮由同一常量派生                             |
| G2 项目 API 闭环     | PASS | 列表/创建/读取/删除均调用 Phase 3 Route；客户端 API 单测覆盖请求结构和错误语义                             |
| G3 revision 冲突保护 | PASS | 删除携带服务端 revision；列表和编辑器遇到 `409` 均保留数据并重新读取，不做覆盖式重试                       |
| G4 Shell 状态边界    | PASS | Shell 只持有服务器项目快照作展示；编辑、自动保存、Fabric、AI、导出入口均未启用                             |
| G5 状态完整性        | PASS | 加载、空态、一般错误、404、删除确认、创建/删除 loading 与重试均有明确界面                                  |
| G6 自动化验证        | PASS | Design/Phase 4 定向 12 files / 61 tests；相邻回归 488 files / 2245 tests（另有原有跳过项）                 |
| G7 静态质量          | PASS | TypeScript strict、定向 ESLint、定向 Prettier、`git diff --check` 通过                                     |
| G8 production build  | PASS | 宿主机 Next 16.2.12 production build 通过；Docker Node 22 镜像内 typecheck + production build 再次通过     |
| G9 浏览器验收        | PASS | 登录态在同一阶段 4 构建的 3100 和临时 3000 完成创建→进入 Shell→返回列表→删除；应用控制台无错误             |
| G10 3000 替换        | PASS | Compose `dq`/worker 运行镜像 ID `sha256:2c3b9a...`，live/ready=200，ready provider=`postgres`，worker 健康 |
| G11 旧版移除         | PASS | 旧 app/worker 容器删除；旧 `ghcr.io/dao-qin/dq:latest` 镜像标签及本地镜像删除；PostgreSQL/rembg/数据卷保留 |

## 3. 端口与部署状态

- `127.0.0.1:3000` 当前由 Docker Compose 容器 `dq` 暴露。
- `dq` 与 `dq-generation-worker` 均使用本地镜像 `dq-new:phase4`，镜像 ID 为 `sha256:2c3b9a3968ebc1032a7388b3d39a1ac536efb8fa55600962b4f2c0d3453344a0`。
- `.env` 的 `DQ_IMAGE` 已固定为 `dq-new:phase4`，因此后续 `docker compose up` 不会自动恢复远程旧版。
- `/api/health/live` 返回 200；`/api/health/ready` 返回 200、`provider=postgres`、schema/encryption/worker 均 ready。
- 保留了 `dq-new_dq-postgres` 与 `dq-new_dq-data` 数据卷；没有执行 `docker compose down -v`，没有删除 PostgreSQL 或共享媒体。

## 4. 工作审视报告

### 原定目标

完成阶段 4 的独立入口、项目列表与编辑器 Shell，并把新版迁移到 3000、移除旧版，同时保持既有数据和 `/canvas` 隔离。

### 完成情况

- [x] 已完成：代码、契约、测试、生产构建、浏览器关键路径和 3000 Docker 部署。
- [x] 已完成：旧版容器与旧应用镜像清理；数据库、rembg 与持久卷保留。
- [ ] 未完成：最终 PostgreSQL 登录用户的浏览器创建/删除复测。原因是切回原 PostgreSQL 后，之前文件 Provider 的浏览器会话按预期失效；没有读取、猜测或重置用户凭据。

### 发现的问题

| 严重程度 | 问题描述                                                                                              | 根本原因                                                                        | 改正                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 必须改正 | 初次把阶段 4 临时 standalone 运行在 3000，但使用文件 Provider，未立即接回原 Compose PostgreSQL/媒体卷 | 只把“3000 接管”理解为端口和进程替换，没有同时把部署拓扑与数据连续性作为完成条件 | 构建本地 Node 22 Docker 镜像，并由原 Compose 的 PostgreSQL、rembg、数据卷和 worker 完整接管 |
| 应当改正 | Shell 顶栏初稿写“已同步”，可能让用户误以为已有自动保存                                                | 展示语言没有完全服从阶段边界                                                    | 改为“快照已载入”，并在检查器明确本阶段只读                                                  |
| 应当改正 | 备用端口浏览器删除确认第一次定位错了卡片按钮与确认按钮                                                | 对 Ant Design 中文确认按钮的可访问名称预判不准确                                | 读取新 DOM 后使用可见名称“删 除”完成，且 3100/临时 3000 均清理测试项目                      |
| 建议改进 | 首轮 Docker build 下载依赖较慢并出现可恢复 socket timeout                                             | 本机首次构建缺少完整 pnpm/Docker layer 缓存                                     | 镜像已成功构建；后续保留 BuildKit/pnpm 缓存，避免无必要重建基础层                           |

### 做得好的地方

- 在停止旧 3000 前先确认 PID、Docker 容器、镜像、端口映射与 readiness，并先在备用端口验证。
- 以 Phase 3 API 为唯一写入边界，没有复用 Canvas Store 或提前引入 Fabric/AI。
- production build 的 `tsconfig.json` / `next-env.d.ts` 副作用按构建前 SHA-256 精确恢复。
- 自审发现临时文件 Provider 不满足数据连续性后，没有把“能打开页面”伪装成部署完成，而是回到 Compose/PostgreSQL 完成纠正。

### 下次重点关注

- Phase 5 必须先定义单一编辑器 Store 与 Fabric 投影边界，再接入加载、保存和恢复；不能把当前 React 项目快照扩展成第二份可写文档。
- 正式自动保存必须串行化，并以 `expectedRevision` 显式处理 `409`，不能覆盖服务端更新。
- 在可安全获得登录会话后，补一次 PostgreSQL 部署上的浏览器项目闭环；这不阻塞已由 Route/集成测试覆盖的阶段 4 Gate，但属于部署验收补证。

## 5. 已知偏差

### D1：最终 PostgreSQL 浏览器闭环缺少登录态

- 事实：相同阶段 4 镜像/构建已在文件 Provider 登录态完成两次创建→打开→删除；最终 Compose 使用原 PostgreSQL 后，浏览器被重定向 `/login`。
- 原因：Provider/数据库切换后原文件会话不属于 PostgreSQL 用户；没有用户授权的明文凭据，不能绕过或重置认证。
- 隔离证据：最终 `/api/health/ready` 明确返回 PostgreSQL、schema ready、worker healthy；Phase 3 PostgreSQL 真实 integration 通过；未登录 `/design` 正确重定向登录。
- 结论：记录为部署补证偏差，不伪造最终登录验收。阶段 4 代码与服务端持久化 Gate 仍通过，结论为 `PASS WITH KNOWN DEVIATION`。
