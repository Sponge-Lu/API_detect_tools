# brainstorm: CLI可用性页测试时长与多账户覆盖

## Goal

调整 CLI 可用性与站点管理中的 CLI 测试展示与数据来源，使页面展示的耗时明确对应“从测试开始到得到返回信息的总对话时间”，失败结果优先展示错误码，并把账户粒度从“每站点单账户”扩展为“站点下全部账户分别测试、分别展示/投影”。

## What I already know

* CLI 可用性页位于 `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`。
* 页面当前模型行里有两类时间信息：
* `model.testedAt` 以日期时间形式显示在模型名后，表示测试发生时间。
* `model.totalLatencyMs` 以 `ms/s` 形式显示，当前用于耗时颜色和耗时文本。
* CLI 可用性页的 tooltip 文案已把 `sample.totalLatencyMs` 标为“对话时间”，见 `formatProbeResult()`。
* 后端 probe 执行在 `src/main/route-cli-probe-service.ts`，`totalLatencyMs` 当前由 `Date.now() - startTime` 计算，覆盖 probe 开始到 CLI wrapper 返回结果的总时长；另有 `endpointPingMs`，但 UI 当前未作为主要耗时展示。
* 当前 probe 执行和 probe 视图都只会为每个站点选择一个账户：
* 账户选择逻辑在 `resolveProbeAccountForSite()`，优先名为“默认账户”，否则回退到首个可用账户。
* `runCliProbeNow()` 与 `getCliProbeView()` 都依赖这套“单账户选择”逻辑。
* 站点管理中的 CLI 图标 tooltip 位于 `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx` + `cliCompatibilityMeta.ts`。
* 当前站点页的 CLI 兼容性投影 `projectCliCompatibilityMap()` 会把“站点级最新 probe 结果”复制到该站点所有账户卡片，这与“按账户分别测试并分别显示”目标冲突。
* 现有 `RouteCliProbeSample` 类型有 `statusCode?: number` 字段，但当前 `route-cli-probe-service.ts` probe 执行路径基本没有填充它；失败时主要只保存 `error` 文本。
* CLI wrapper 失败信息当前来自 `cli-wrapper-compat-service.ts` 的 `buildFailureMessage()`，通常是超时、启动失败、stderr、stdout 或 fallback 文本，不含结构化错误码。
* 相关现有测试已存在：
* `src/__tests__/cli-usability-tab.test.tsx`
* `src/__tests__/cli-compat-projection.test.ts`
* `src/__tests__/route-cli-probe-service.test.ts`
* `src/__tests__/custom-cli-compatibility-meta.test.ts`

## Assumptions (temporary)

* “对话时间”定义为一次 CLI probe 从开始执行到拿到最终 stdout/stderr/退出结果的总耗时，而不是单独的 `HEAD /v1/models` ping 延迟。
* 站点管理页 tooltip 与 CLI 可用性页 tooltip 都应展示账户粒度的结果，不再混用站点级汇总结果。
* CLI 可用性页的表格布局仍维持“一站点一行，三个 CLI 列”的主结构，只是在每个 CLI 单元内体现账户粒度。

## Requirements (evolving)

* CLI 可用性页中，模型名后不再让用户误解为“耗时”；需要明确区分“测试时间”和“对话时间”。
* CLI 可用性页中，模型后的“测试发生时间”使用 24 小时制显示，不显示 AM/PM。
* CLI 可用性页使用对话时间作为耗时展示，定义为测试开始到得到返回信息的总耗时。
* CLI 测试失败时，优先显示错误码；没有错误码时显示简短错误信息。
* 失败摘要需要在两个位置可见：
* 站点管理页：显示在 CLI 图标 tooltip 中。
* CLI 可用性页：显示在测试结果 tooltip 中。
* CLI 可用性页中，站点列宽需要降低。
* CLI 可用性页中，站点列缩窄后，三个 CLI 列中的 history 条形图区域需要相应放宽，并保持每个条形宽度一致。
* CLI 可用性测试不再只测试默认账户；站点中的所有账户都要测试，并使用各账户自己的 API key。
* 账户粒度的 probe 结果、历史、最新快照、页面视图、站点管理投影需要保持一致的数据语义。
* 当一个站点有多个账户时，CLI 可用性页按“站点-账户”粒度拆成多行展示，而不是在单元格内部再嵌套账户分组。

## Acceptance Criteria (evolving)

* [ ] CLI 可用性页中，模型后方“时间”不再被误读为站点延迟；页面明确展示测试时间与对话时间的不同角色。
* [ ] CLI 可用性页中，模型后的测试时间使用 24 小时制格式展示，不出现 AM/PM。
* [ ] 任一 probe 失败时，若存在错误码则 tooltip/结果中优先显示错误码；否则显示简短错误信息。
* [ ] 站点管理页的 CLI 图标 tooltip 能显示对应账户的最近失败摘要。
* [ ] CLI 可用性页的测试结果 tooltip 能显示对应账户/模型的失败摘要。
* [ ] 同一站点存在多个账户时，probe 会覆盖所有账户，而不是只选择默认账户或回退账户。
* [ ] 各账户 probe 使用该账户自己的 API key，而不是站点或其他账户的 key。
* [ ] CLI 可用性页的站点列宽下降后，三个 CLI 列中的 history 区域相应放宽，图中各条形宽度保持一致，不因列宽或内容变化而参差。
* [ ] 相关单元/组件测试更新，覆盖多账户 probe、账户级投影、tooltip 错误文案和 CLI 可用性页展示回归。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 重新设计整个路由工作台或站点管理页面布局
* 引入新的 CLI 兼容性测试协议或替换现有 CLI wrapper 测试框架
* 调整非 CLI probe 的站点检测逻辑

## Technical Notes

* Relevant files inspected:
* `src/main/route-cli-probe-service.ts`
* `src/main/handlers/cli-compat-handlers.ts`
* `src/main/cli-wrapper-compat-service.ts`
* `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`
* `src/renderer/components/CliCompatibilityIcons/CliCompatibilityIcons.tsx`
* `src/renderer/components/CliCompatibilityIcons/cliCompatibilityMeta.ts`
* `src/renderer/services/cli-compat-projection.ts`
* `src/shared/types/route-proxy.ts`
* Trellis frontend guidelines reviewed:
* `.trellis/spec/frontend/index.md`
* `.trellis/spec/frontend/component-guidelines.md`
* `.trellis/spec/frontend/quality-guidelines.md`
* `.trellis/spec/frontend/type-safety.md`
* `.trellis/spec/guides/index.md`
* Cross-layer risk:
* This task changes shared contracts and renderer/main projection semantics.
* `statusCode` currently exists in shared types but is not reliably populated by the route probe execution path.
* The site page currently projects site-wide latest probe state onto every account card; this likely needs an account-aware projection redesign.

## Decision (ADR-lite)

**Context**: 多账户 probe 从“每站点单账户”扩展为“每站点全部账户”后，CLI 可用性页需要选定一种账户展示方式，避免 tooltip、失败摘要、history 与账户归属发生歧义。

**Decision**: CLI 可用性页采用“站点-账户”粒度多行展示。每一行对应一个确定账户，站点列缩窄，账户信息并入站点列的次级文案。CLI 列继续保持三列结构。

**Consequences**:

* 优点：每行只对应一个账户，数据来源、错误摘要、history、tooltip 都能自然对齐到该账户。
* 代价：表格总行数增加，需要通过站点列缩窄、CLI 区域放宽和固定槽位宽度控制整体密度。
* 实现上需要把 `getCliProbeView()` 从“每站点一条 siteView”改成“每站点每账户一条 siteView / rowView”，并同步修正站点管理页账户级投影逻辑。
