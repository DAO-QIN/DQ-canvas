# Phase 1 Gate Report

日期：2026-08-11（Asia/Shanghai）
结论：**PASS**
选型：**Fabric.js 7.4.0**
tldraw 结论：**TECHNICAL PASS / BLOCKED BY LICENSE**
下一步：停止在 Phase 1，等待用户确认后才进入 Phase 2；不得创建 `design_projects`、正式导航或真实 AI 调用。

## 范围与产物

已交付：

- 仅在 `DQ_DESIGN_POC_ENABLED=1` 时可访问的 `/design-poc` 隔离页；未加入导航、站点地图或正式产品入口。
- 统一 `DesignPocDocument`、7 个 Design Ops、非法 Ops 回执、4 Frame / 28 元素基础夹具、200 元素性能夹具和无版权测试素材。
- tldraw 5.2.5 与 Fabric 7.4.0 两个单引擎 adapter；页面一次只挂载一个候选。
- 10 次文档往返、7 Undo/Redo、稳定选择与 ID、PNG/JPEG 1x/2x、crop/Frame 像素探针、10 次引擎销毁/初始化和 CDP heap 采样。
- Node 22 生产构建、Playwright 专项、截图、测量 JSON、许可证与 npm/upstream 指纹、评分表、ADR 与复用登记。

未进入范围：数据库、文件 Provider、正式 `/design` 路由、导航、用户项目持久化、积分、Agent、真实生成和线上部署。

## Gate 结果

| Gate            | tldraw 5.2.5 | Fabric 7.4.0 | 证据                                                                                                              |
| --------------- | ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| G1 生产许可     | **FAIL**     | PASS         | tldraw 默认许可证禁止 Production Environment，当前无商业协议/Key；Fabric MIT                                      |
| G2 单引擎       | PASS         | PASS         | 每个 adapter 单独完成裁剪、文本、Frame 与导出，无嵌套第二引擎                                                     |
| G3 单一真源     | PASS         | PASS         | 文档只由当前 adapter Store 写入，React 只保留 Shell 状态                                                          |
| G4 文档恢复     | PASS         | PASS         | 每轮 10/10 往返，三轮一致，文档均为 10590 B                                                                       |
| G5 精确导出     | PASS         | PASS         | 2000×2000 PNG/JPEG、4000×4000 PNG；像素 crop/Frame 边缘探针三轮通过                                               |
| G6 资源安全     | PASS         | PASS         | 文档只保存 `/design-poc/*` 稳定引用，无 `data:`、`blob:`、对象 Key 或签名 URL                                     |
| G7 历史一致性   | PASS         | PASS         | 每轮 7 Undo 与 7 Redo 语义一致                                                                                    |
| G8 稳定对象引用 | PASS         | PASS         | 选择、层级、属性与 Ops 使用同一稳定元素 ID                                                                        |
| G9 生命周期     | PASS         | PASS         | 10 次切换，CDP heap 18.1–19.0 MB 有界锯齿，无单向失控；owner 竞态已修正                                           |
| G10 DQ 回归     | PASS         | PASS         | Node 22 TypeScript/生产 build、PoC 4/4、Chromium 全套 56 pass / 1 条 PostgreSQL 条件用例 skip；最终定向验证见下文 |

因此：Fabric 是至少一个完整通过 G1–G10 的候选；tldraw 不能凭技术通过绕过 G1。

## 浏览器证据

最终专项环境：Node 22.23.2、pnpm 10.34.5、Chromium 151.0.7922.34、1280×720、Next 生产构建 `.next-phase1`。

- Playwright：4/4 通过（3 条安装前置 + 1 条双候选专项）；每个候选 3 轮 Gate 和 200 元素测量。
- crop 采样：网格 `[176,187,203,255]`（水平样本蓝色为 202）与背景 `[249,250,252,255]` 可区分。
- Frame 边缘内侧 `[37,99,234,255]`；tldraw 外侧 `[236,238,240,255]`，Fabric 外侧 `[255,255,255,255]`，均证明边界裁剪成立。
- 截图：`web/.e2e-artifacts/design-engine-poc-compares-c1d6c-he-same-product-design-gate-chromium/tldraw-workbench.png` 与 `fabric-workbench.png`。
- 原始 JSON：同目录 `phase-1-measurements.json`；汇总和原始数组见 `phase-1-scorecard.md`。
- 资源：最终 Fabric 增量动态块 288495 B raw / 89129 B encoded / 89429 B transfer；构建 gzip 88817 B。tldraw loadable chunks 1713204 B raw / 506401 B gzip。

## 许可证与补丁

### tldraw

- `tldraw@5.2.5` 与 `@tldraw/editor@5.2.5` 的 npm `gitHead` 均为 `32f526615477f3554b62ead28d26d0fd374fb346`；tag `v5.2.5` peeled 到同一 commit。
- 包元数据是 `SEE LICENSE IN LICENSE.md`，文件指向独立 tldraw License。默认许可只允许 Development Environment；生产需要 trial/commercial agreement 和 License Key。
- 当前 `.env` / `.env.example` 的 `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` 未配置，因此不能作为新画板生产引擎。
- DQ 的 `web/patches/@tldraw__editor@5.2.5.patch` 修改字体异步加载后的 dispose 竞态，并调用 `__unsafe__getWithoutCapture` 内部 API；技术回归通过，但会增加升级/支持风险，不能改善许可证状态。
- 默认 tldraw Shape 只能直接表达离散字体、字号和颜色 token；PoC 通过 metadata 保留精确文档语义，但视觉精确度仍需自定义 Shape，因此评分扣分。

### Fabric

- `fabric@7.4.0` npm `gitHead=ce64f450bad811750cb5a75aa749fc1502c644be`；包内 MIT LICENSE 已核验。
- PoC 只调用 Fabric 公开 API；精确字体属性、字号、行高、字距与十六进制颜色可直接表达。
- 多 Frame Workspace、clip、历史与 Design Ops 是 DQ 自写职责，不把第三方示例的错误导出或状态模型照搬进正式架构。

## 已纠正问题

- 统一文档把坐标与样式数值归一到 0.001，消除引擎浮点噪声。
- Fabric Textbox 显式 `strokeWidth: 0`，修复默认描边造成的文本高度漂移。
- Fabric 所有对象显式采用左上原点，修复 7.x 默认中心原点造成的坐标漂移。
- 引擎切换用 adapter owner 校验清理，修复旧组件卸载覆盖新 adapter 的竞态。
- heap 从量化的 `performance.memory` 改为 CDP `Runtime.getHeapUsage`，避免伪装“精确不变”。
- Fabric 导出从易受主线程回调调度影响的 `HTMLCanvasElement.toBlob` 优先切换为 `OffscreenCanvas.convertToBlob`，保留无 OffscreenCanvas 时回退。新生产构建三轮最差为 PNG 1x 73.8 ms、PNG 2x 244.9 ms、JPEG 55.9 ms。

## 已知偏差与风险

1. **Fabric 导出长尾曾真实复现。** 修改前多个会话出现约 6.7–6.8 s 的 PNG/JPEG `toBlob` 回调延迟；OffscreenCanvas 路径在最终 Chromium 生产构建中三轮未复现。Phase 2 必须增加 Safari/Firefox、无 OffscreenCanvas、低端设备和更大素材的性能矩阵，不能把 Chromium 结果泛化为所有浏览器。
2. **生命周期样本有限。** 10 次 GC 后 heap 包络小于 0.9 MB、同引擎净增约 0.30 MB，足以通过 PoC Gate，但 Phase 2 仍需 100 次切换/长时编辑压力测试和 listener/worker 计数。
3. **全仓格式化污染已发生。** Phase 1 早期误执行全仓 Prettier，机械改写了用户源码和 `.data-3100`；工作区本来已有大量用户修改，无法安全自动回滚。本阶段之后只允许定向格式检查/格式化，报告不得把这些差异宣称为 Phase 1 功能改动。
4. **E2E 现有基线噪声。** 文件数据库登录前布局会触发 `/api/public/prompt-images` 的 502 日志，PoC 页面允许现有单条社区通知 409；专项断言仍要求 PoC 页面其余 HTTP/console 错误为空。全套 Chromium 的 PostgreSQL 专用支付用例因未提供数据库而正常 skip。
5. **临时构建目录。** `.next-phase1` 仅用于不干扰当前 3100 服务的 Node 22 生产验证，不是正式运行目录；`tsconfig.json` 被 Next 自动重写后已精确恢复至构建前内容。

## 工作审视报告

### 原定目标

用相同商品图夹具实测 tldraw 5.2.5 与 Fabric 7.4.0，完成许可证、自动化、性能、评分和单引擎 Gate；不越界进入 Phase 2。

### 完成情况

- [x] 双候选隔离 PoC、统一契约、素材与真实浏览器验证。
- [x] 生产许可、npm/upstream 指纹、本地 patch、包体和 DQ 集成核验。
- [x] 评分达到协议阈值：Fabric 86.5，领先 13.25。
- [x] ADR-004、源码复用登记、实施状态与 Gate 产物更新。
- [x] 未创建数据库、正式导航、真实 AI 或积分副作用。

### 发现的问题

| 严重程度           | 具体问题                                                          | 根本原因                                                | 改进                                         |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| 必须改正（已改）   | `fabric-poc-adapter.ts` 的 `toBlob` 在多个会话出现 6.8 s 回调长尾 | 把浏览器主线程编码回调当作稳定同步性能路径              | 优先 OffscreenCanvas 编码并在新生产构建重测  |
| 必须改正（已改）   | E2E heap 连续显示固定 24.5 MB                                     | 使用了 Chrome 量化的 `performance.memory`，证据强度不足 | 改用 CDP `Runtime.getHeapUsage`              |
| 应当改正（已限制） | 早期全仓 Prettier 改写用户文件                                    | 格式化范围未先收敛到阶段文件                            | 后续只用显式文件列表；本报告披露而不危险回滚 |
| 建议改进           | Chromium 单平台不足以覆盖 OffscreenCanvas 回退                    | Phase 1 Gate 有意限制为最小可比 PoC                     | Phase 2 增加跨浏览器和低端设备导出矩阵       |

### 做得好的地方

- 同一份领域契约与像素探针约束两个候选，未为某一引擎降低断言。
- 许可证硬门槛优先于技术偏好，没有把用户的复制授权冒充上游生产授权。
- 发现性能和证据问题后保留失败事实、修正实现并重新构建验证。

### 下一阶段重点

- 冻结 Fabric 单引擎的正式 Design Document / Design Ops，而不是复制 PoC adapter 为生产代码。
- 在架构冻结前明确 Workspace/Frame clip、历史、资源 resolver、自动保存与导出 worker/Offscreen 回退边界。
- 保持 `/canvas` 与 `/design` 的文档、历史和项目存储隔离；继续复用权限、素材、任务与 Agent 平台服务。

## Gate 判定

Fabric 通过全部硬门槛、评分超过 75 且领先超过 5；未产生正式产品、数据或计费副作用，现有 `/canvas` 回归通过。因此 Phase 1 为 **PASS**。

按阶段协议到此停止。只有用户明确确认“进入阶段 2”后，才开始架构与契约冻结。
