# brainstorm: route site priority sync

## Goal

优化“站点优先级卡片”的交互与同步策略：优先级值修改后卡片应即时按优先级重排；移除多余说明文案；同时解决“新站点加入后模型重定向看不到增量变化，但显式重建又会覆盖用户手工修改规则”的冲突。

## What I already know

* 站点优先级弹窗与卡片渲染集中在 `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`。
* 当前优先级弹窗的数据来自 `buildVendorPrioritySiteGroups(section)`，它基于当前厂商的 `displayItems -> entry.sources` 聚合站点与 API key。
* 当前优先级卡片没有显式排序逻辑，渲染顺序主要继承 `section.displayItems` 与 `entry.sources` 的遍历顺序。
* 当前卡片里仍展示了说明文案“站点优先级越小越先尝试，默认 10”。
* 主进程 `rebuildModelRegistry(force)` 走 `rebuildModelRegistryInternal(force, 'reseed')`；这会调用 `buildDisplayItems(..., 'reseed')`，重新生成 seeded display items。
* `buildDisplayItems(..., 'reseed')` 会忽略之前的 seeded 项，只保留 manual 项，再根据检测结果重建每个厂商的 seeded 3 项；因此用户手工改过的 seeded 项会被显式重建覆盖。
* 日常编辑/新增/删除 display item 与 override 走的是 `rebuildModelRegistryInternal(true, 'preserve')`，这条路径会保留当前 displayItems，只重新裁剪无效 sourceKey。
* 这意味着当前实现存在两个对立行为：
  * `preserve` 不会覆盖用户手工规则，但也不会把新站点/新模型自动补入默认规则。
  * `reseed` 能看到新站点/新模型，但会覆盖 seeded display item 上的手工修改。

## Assumptions (temporary)

* “模型重定向中没有进行更新”指的是：新站点加入后，用户期望至少能在路由页看到新的来源已被同步，或者可用于后续编辑/新增，而不是必须手动重建且承受规则被覆盖的代价。
* 用户更重视“手工修改不被覆盖”，而不是每次都自动把新来源塞进已有默认重定向项。
* 当前 seeded display item 仍然代表“初始化/默认槽位”，但一旦被用户修改，就应视为用户资产而不是可被随意重建的系统推荐值。

## Open Questions

* 需要用户确认：新站点加入后，是否接受“只增量同步来源池与候选列表，不自动改写已有默认 3 个重定向卡片”这条规则。

## Requirements (evolving)

* 修改站点优先级后，优先级卡片应按最新优先级值排序。
* 不再显示“站点优先级越小越先尝试，默认 10”这条说明文案。
* 新站点加入后，模型重定向需要有不覆盖手工规则的同步方案。
* 已存在且被用户修改过的 seeded 重定向项，不应因同步新站点/新模型而被自动覆盖。
* 现有手工新增的 display item、override、originalModelOrder 不应因同步来源而丢失。

## Acceptance Criteria (evolving)

* [ ] 在站点优先级弹窗中修改任一站点优先级后，卡片顺序按新的优先级升序展示。
* [ ] 若优先级相同，排序仍保持稳定，不出现随机跳动。
* [ ] 站点优先级卡片内不再显示“站点优先级越小越先尝试，默认 10”。
* [ ] 新站点加入后，可以通过非 destructive 的同步方式让路由页感知到新来源。
* [ ] 执行该同步后，用户已手工修改的 seeded 规则不会被覆盖。
* [ ] 仍然保留一个显式的“重置/重建默认 3 项”入口，用于用户主动接受覆盖默认规则的场景。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* 不改动真实请求链路的优先级计算语义。
* 不重新设计整页路由布局。
* 不在这一轮改动里引入新的推荐模型算法。

## Technical Approach

当前问题实际分成两个层面：

1. UI 层：
   * 给优先级卡片加基于 `sitePriority` 的排序。
   * 删除多余说明文案。

2. 同步层：
   * 把“同步来源池”与“重建默认 3 项”拆开，避免同一个入口同时承担“发现新来源”和“覆盖默认规则”两个相互冲突的职责。

## Decision (ADR-lite)

**Context**: 当前 `reseed` 与 `preserve` 两种模式边界清晰，但 UI 只有一个“重建目录”入口，导致用户为了同步新来源不得不承担 seeded 规则被重置的风险。

**Decision candidates**:

推荐方向是把当前单一的“重建目录”拆成两个语义不同的动作：

* “同步来源”
  * 只重新扫描站点/账户模型，更新 `sources` 池，并对现有 `displayItems` 做 sourceKey 清理与 vendor 修正。
  * 不重算 seeded display items，不覆盖 canonicalName / sourceKeys / originalModelOrder。
  * 新站点模型会进入候选列表，供用户编辑或新增时使用。

* “重置默认重定向”
  * 显式 destructive 动作。
  * 重新按最新检测结果为每个厂商生成 seeded 3 项。
  * 明确告知会覆盖现有默认槽位。

可选备选方案：

* 方案 B：保留一个入口，但给 seeded item 增加 `userTouched` / `locked` 标记，重建时只改未触碰的 seeded 项。
  * 优点：入口少。
  * 缺点：规则更隐式，用户难以预期哪些项会被更新、哪些不会。

* 方案 C：同步时把新来源自动并入“同 canonicalName 的现有 seeded 项”。
  * 优点：新站点能更快参与现有路由。
  * 缺点：会悄悄改写用户的 `sourceKeys` / `originalModelOrder`，与“手工规则不被覆盖”的目标冲突。

**Current recommendation**: 采用方案 A，语义最清晰，也最符合当前 `preserve` / `reseed` 代码结构。

## Technical Notes

* 关键文件：
  * `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`
  * `src/main/route-model-registry-service.ts`
  * `src/main/unified-config-manager.ts`
* 代码证据：
  * `buildDisplayItems(..., mode)` 中，`mode === 'preserve'` 直接返回持久化 displayItems；`mode === 'reseed'` 则重建 seeded 项。
  * `rebuildModelRegistry(force)` 当前固定调用 `rebuildModelRegistryInternal(force, 'reseed')`。
  * `upsertModelMappingOverride` / `upsertModelDisplayItem` / `deleteModelDisplayItem` / `deleteModelMappingOverride` 都走 `preserve`，说明项目内部已经存在“保留用户资产”的正确路径。
* 风险：
  * 如果继续复用当前“重建目录”入口承担增量同步，用户会继续遇到 seeded 规则被覆盖的问题。
  * 如果完全不提供 destructive 重建入口，默认 3 项在长期运行后可能与最新厂商模型脱节。
