# Phase 0 Gate Report：工作区基线与安全边界

日期：2026-08-11
结论：**PASS WITH KNOWN DEVIATIONS**
下一步：等待用户确认；不得自动进入 Phase 1

## 本阶段实际完成

- 读取用户提供的工作区规则，并从 Git HEAD 读取当前已删除的仓库 `AGENTS.md` / `CONTRIBUTING.md`，没有恢复或覆盖它们。
- 确认仓库、分支、基线提交、依赖清单、锁文件、CI、TypeScript、Vitest 和生产构建入口。
- 审计所有已跟踪差异和未跟踪源码，建立 `/design` 新增路径与共享服务冲突边界。
- 确认现有 `/canvas` 的契约、Service/Store、PostgreSQL/JSON 双 Provider 与媒体删除边界。
- 核验研究仓库的具体 commit 与许可证文件，建立源码复用登记。
- 运行不改变外部状态、不触发真实模型和数据库迁移的基线检查。
- 只新增本目录的实施治理文档，没有修改业务代码、数据库、导航或环境变量。

## 可追溯基线

| 项目            | 结果                                                        |
| --------------- | ----------------------------------------------------------- |
| 分支            | `feature/qanvas-homepage-redesign`                          |
| HEAD            | `e4bae0f4ab4719479a14a33ae21157da215ff871`                  |
| 最后提交        | `Merge pull request #1 from DAO-QIN/feature/canvas-drawing` |
| 项目包管理器    | `pnpm@10.34.5`                                              |
| 锁文件          | `web/pnpm-lock.yaml`（已跟踪，真源）                        |
| 本机 Node       | `v24.16.0`                                                  |
| CI Node         | `22`                                                        |
| tldraw          | `5.2.5`，包含项目本地 editor 补丁                           |
| tldraw 生产 Key | `.env` / `.env.example` 均声明但为空                        |

阶段开始时已有 23 个已跟踪差异（2 个删除、21 个修改）及多项未跟踪源码/运行数据。本阶段未恢复、覆盖或格式化这些文件。

## 验证结果

在 `web/` 使用项目钉死的 Corepack pnpm 执行：

| 命令                                                                                 | 结果            | 证据摘要                                                                |
| ------------------------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------- |
| `corepack pnpm --version`                                                            | PASS            | `10.34.5`                                                               |
| `corepack pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts` | PASS            | frozen/offline 校验完成，锁文件未改写                                   |
| `corepack pnpm run typecheck`                                                        | PASS            | TypeScript 无错误                                                       |
| `corepack pnpm run lint`                                                             | PASS            | ESLint 无 error                                                         |
| `corepack pnpm test`                                                                 | PASS            | 475 files passed、1 skipped；2178 tests passed、2 skipped               |
| `corepack pnpm run format:check`                                                     | KNOWN DEVIATION | 14 个本轮前文件不符合 Prettier                                          |
| `corepack pnpm run build`                                                            | NOT RUN         | Next build 可能改写已有用户修改的 `web/next-env.d.ts`，Phase 0 不应触碰 |

格式偏差已归因：

- 7 个 `web/.data-3100/*.json` 本地运行数据。
- 7 个本轮前已修改或未跟踪源码：`creative-composer.tsx`、`create-home-layout.test.ts`、`create/page.tsx`、两个 voice input 文件、`canvas-skill-mentions.ts`、`creative-runtime-service.ts`。

这些文件不由 Phase 0 产生，因此没有执行全仓 `prettier --write`。后续阶段只对本阶段新增/修改文件做定向格式检查；最终发布 Gate 需要由相关改动负责人处理或明确排除本地数据后恢复全仓格式基线。

## Gate 判定

通过理由：

- 阶段 0 的目标是建立真实基线和保护边界，不要求修复无关用户改动。
- 类型、Lint、单测和 frozen lockfile 均通过。
- 格式失败与本阶段前状态完全对应，已有隔离措施，不阻止建立 Phase 1 的独立 PoC。
- 没有业务代码或外部状态变更。

已知偏差与硬阻断：

1. 最终 CI 工具链是 Node 22，本机当前为 Node 24；Phase 1/最终 Gate 必须补 Node 22 复现。
2. tldraw 生产许可证 Key 为空；在授权证据完成前，tldraw 只能作为隔离 PoC 候选，不能判定生产选型 PASS。
3. 全仓 Prettier 不是绿色；不得把后续新增格式问题混入现有 14 个偏差。
4. 工作区很脏；未来编辑共享文件前必须重新执行 `git status --short -- <target>` 并对比用户差异。

## Phase 1 进入条件

用户确认进入后，只执行引擎与许可证 PoC：

- 建立不挂正式导航、不写数据库的 `/design` 隔离测试夹具或开发入口。
- tldraw 与 Fabric.js 使用同一组多 Frame、裁剪、文字、层级、保存恢复、导出和 Design Ops 用例。
- 记录性能、包体、实现复杂度、DQ 补丁影响和许可证结论。
- 输出引擎评分表与 Phase 1 Gate；未解决 tldraw 许可时必须保留 Fabric 作为可落地路径。

Phase 1 不调用真实 AI、不消耗积分、不迁移数据库、不部署线上。
