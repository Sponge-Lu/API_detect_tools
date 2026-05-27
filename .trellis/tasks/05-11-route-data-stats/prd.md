---
name: 路由数据页重构展示模块
description: 用模型热力分布 + 通道健康矩阵替换异常摘要与最近异常，并将"响应体验"指标换成 P90/P99 延迟
type: project
---

# 路由数据页展示模块重构

## Goal

去掉路由数据页底部的"异常摘要"和"最近异常"两个区块（内容可在日志页查看），用两个信息密度更高、视角互补的卡片替代；同时将顶部第四张指标卡从估算粗糙的"慢请求占比"升级为准确的 P90/P99 延迟分位数，让页面在默认尺寸下无大片空白、信息密度均衡。

## Requirements

### 顶部指标卡（4 张，布局不变）

1. 路由请求量（保持）
2. 路由成功率（保持）
3. Token 消耗（保持）
4. **响应体验 → 延迟分位数**
   - 主值显示 P99 延迟（单位 ms / s 自动格式化）
   - 副行显示 P90
   - chip 显示相对上一窗口的变化方向与百分比（复用 `formatTrendDeltaBadge`）
   - 数据来源：对窗口内所有 `RouteAnalyticsBucket.latencyHistogram` 桶做权重累加后求分位数
   - 当样本量 < 20 时主值显示"样本不足"，避免分位数误导

### 中间区域（保持现状）

- 运营趋势 Hero 图（请求 / 成功率 / token 三条 sparkline）
- 活跃对象（按站点 / 账户 / API Key 聚合）

### 底部区域（替换异常摘要 + 最近异常 → 方案 A 左右分栏）

**左：模型热力分布**
- 按 `canonicalModel` 聚合窗口内请求（来源：`RouteAnalyticsBucket`）
- Top 6~8 模型，按请求量倒序
- 每行：模型名 + CLI 来源 chip + 请求量横条（占 60%）+ token 量 chip（右侧）
- 失败数 > 0 时条形色 = danger，否则 = accent（复用 `RouteObjectStatsList` 的视觉规则）
- 空态："当前时间窗口暂无模型调用"

**右：通道健康矩阵**
- 数据源：`RoutePathState`（主进程 IPC 已有 `route.getPathStates` 或类似接口，若没有需补）
- Top 6~8 活跃通道，按 `windowRequestCount` 倒序
- 每行：通道标签（routeRule / site / account / apiKey 四元组紧凑展示）+ 成功率条 + 连续失败计数 + 禁用状态 pill（若 `disabledUntil > now`）
- 空态："暂无活跃通道"

### 高度与布局约束（关键）

- 默认尺寸下（Electron 窗口典型 1280×800，主内容区约 1040×620）整页**不出现主滚动条**，或滚动条仅出现在卡片内部列表
- 底部两张卡片固定高度 = **216px**（与原异常摘要/最近异常一致），确保整页总高度不变
- 两列网格比例沿用现有：`xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]`
- 左右卡片内的列表项使用内部 overflow-y-auto，不向外撑开
- 最小视口（xl 以下）自动堆叠，不要求同行

## Acceptance Criteria

- [ ] 顶部第 4 张卡显示 P99 主值 + P90 副行，并在样本不足时显示"样本不足"
- [ ] P90/P99 在单元测试中能对固定桶 histogram 得到预期分位数（允许 ±5% 误差）
- [ ] 底部左卡：模型热力分布渲染正确，支持 Top 8，失败>0 行用 danger 色
- [ ] 底部右卡：通道健康矩阵渲染正确，禁用中的通道有醒目标识
- [ ] 原 `SectionTitle icon={ShieldAlert} title="异常摘要"` 和 `SectionTitle icon={AlertTriangle} title="最近异常"` 区块及相关辅助组件被移除（`RouteFailureRuleMetricsList`、`RouteFailureList`、`DistributionList` 若不再被使用则删除）
- [ ] 默认尺寸（1280×800 Electron 窗口）下页面底部无大片空白、整页不出现主滚动条
- [ ] 单元测试覆盖分位数计算与模型聚合逻辑
- [ ] 现有 `data-overview-page.test.tsx` 更新通过

## Definition of Done

- Tests added/updated（分位数工具 + 模型聚合 + 快照测试）
- `npm run lint` / `npm run test` 通过
- `PROJECT_INDEX.md` / 涉及目录的 `FOLDER_INDEX.md` / 文件头注释同步更新
- 无残留的未使用导入（`AlertTriangle`、`ShieldAlert` 若不再用需清理）

## Technical Approach

### 分位数计算

从 `RouteAnalyticsBucket.latencyHistogram` 求分位数：
- histogram key 形如 `"0-100ms"` / `"500-1000ms"` / `">5000ms"`，value = 落在该桶的请求数
- 做法：
  1. 按数值区间起点排序所有桶
  2. 每桶用区间中点近似（`>5000ms` 用 5000ms 作下界，向上取 1.5 倍即 7500ms）
  3. 按累计计数查找 P90 / P99 的位置
- 新增纯函数 `computeLatencyPercentiles(histogram: Record<string, number>): { p90, p99, sampleCount }`，位置：`src/shared/utils/routeLatency.ts`（新文件）或 `src/renderer/utils/routeLatency.ts`（仅前端用可放这里）

### 模型聚合

新增 `buildModelDistribution(buckets: RouteAnalyticsBucket[])`：按 `canonicalModel` 聚合 `requestCount` / `successCount` / `failureCount` / `totalTokens` / `cliType`（取出现次数最多的 cliType）。位置：与现有 `buildRouteTrendPoints` 同文件（`DataOverviewPage.tsx` 内部即可，除非复用需要）。

### 通道健康矩阵数据来源

先检查主进程是否已暴露 `RoutePathState` 查询 IPC：
- 已暴露 → 直接在 `loadOverview` 里并行调用
- 未暴露 → 需新增 `route.getPathStates()` handler + preload 桥接（最小实现）

### 组件复用

- 保留 `RouteObjectStatsList` 的视觉模式（左标签、右 chip、底下带条形），模型热力和通道矩阵复制其外观以保持一致
- 不要新增重量级库；SVG/div 条形图足够

## Decision (ADR-lite)

**Context**: 原"异常摘要 / 最近异常"两块与日志页信息重复，且"慢请求占比"用桶边界估算不够准确。

**Decision**:
1. 用"模型热力 + 通道健康"两个维度替代异常类展示，因为它们：与"活跃对象"视角互补（对象视角 vs 规则路径视角 vs 模型视角），且不与日志页重复。
2. 将"响应体验"指标卡改为 P90/P99 延迟，沿用已有 histogram 数据，不需要采集新字段。

**Consequences**:
- 好处：信息密度提升、不重复、默认尺寸无空白
- 代价：失去异常码分布的一瞥感（可在日志页过滤观察，或未来作为可选 tab 回归）
- 风险：样本量小时分位数不稳定 → 加"样本不足"兜底

## Out of Scope

- 模型维度的失败/成功明细下钻（模型热力仅显示总量与颜色提示）
- 通道健康矩阵的交互（点击跳转、强制启用等）
- 新增后端字段或持久化 schema 变化
- 状态码分布的独立可视化（日志页已有过滤）
- 响应式设计大改造

## Technical Notes

### 现有数据源（已确认）

- `RouteAnalyticsBucket.latencyHistogram` — 分位数来源
- `RouteAnalyticsBucket.canonicalModel` / `cliType` / `requestCount` / `successCount` / `failureCount` / `totalTokens` — 模型聚合来源
- `RoutePathState` — 通道健康来源（需确认 IPC 暴露情况）

### 涉及文件

- `src/renderer/pages/DataOverviewPage.tsx` — 主改动
- `src/renderer/utils/routeLatency.ts` — 新增分位数工具（或放 shared）
- `src/main/handlers/route-handlers.ts` — 若需补 `getPathStates` IPC
- `src/main/preload.ts` — 同上
- `src/__tests__/data-overview-page.test.tsx` — 更新
- 新增 `src/__tests__/route-latency.test.ts` — 分位数单测

### 布局约束复核

当前底部 `xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]` + `h-[216px]` 两张卡 = 整页在默认 1280×800 下恰好填满且无主滚动。新方案沿用该骨架，仅替换卡片内容，**布局骨架不动**，风险最小。
