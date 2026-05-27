# Research Index — Route Data Page Redundancy

PRD: `.trellis/tasks/05-15-route-data-page-redundancy/prd.md`

| # | 文件 | 摘要 |
|---|---|---|
| 01 | `01-bucket-coverage.md` | 所有进入 bucket 的请求都已带齐 siteId/accountId/apiKeyId/cliType；canonicalModel 可能为 undefined。前端 scope 过滤可纯靠 bucket 完成，无需查 routePathStates |
| 02 | `02-custom-cli-id-mapping.md` | 合成 id 由 `src/main/custom-cli-config-service.ts:50-60` 生成；bucket.cliType 永远是 claudeCode/codex/geminiCli（无 'custom'）；建议把 helper 抽到 `src/shared/utils/customCliRouteId.ts` 供两侧共用 |
| 03 | `03-svg-primitive-reusability.md` | 趋势图复用率 85%、散点 25%、Sankey 10%。需新增 `routeScatter / routeSankey / routeLogAxis / routeTtfb / routeScopeFilter` 五个工具文件 |
| 04 | `04-scatter-axes-and-labels.md` | 仓库无 log10 / leader-line 工具。给出固定 6-tick log 刻度与 greedy vertical-nudge 防重叠（O(N log N)），≤30 行可 inline |
| 05 | `05-sankey-implementation.md` | 现无任何图表库依赖。推荐自实现（150-210 行）而非引入 d3-sankey（≈18-22KB gzip 增量），与既有手写 SVG 风格一致 |
| 06 | `06-existing-test-coverage.md` | 7 个 it block 中保留 4 个、重写 2 个、改 1 个；必须新增 9 个用例覆盖 scope / selectedModel 联动 / Sankey 聚合 / log 轴 / TTFB 双值 |
