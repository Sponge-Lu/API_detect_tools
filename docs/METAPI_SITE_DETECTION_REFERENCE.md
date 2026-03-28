# metapi 站点检测、路由与可视化实现参考

## 文档目的

本文基于 `D:\2_Github_Repository\metapi` 的当前实现整理，聚焦四件事：

1. 站点类型检测是怎么做的。
2. 不同类型站点使用了哪些管理 API 端点。
3. `sub2api` 类型站点具体用了哪些端点。
4. 全站路由和数据可视化页面是怎么实现的。

## 关键文件

- 站点检测入口：`D:\2_Github_Repository\metapi\src\server\services\siteDetector.ts`
- 平台注册与检测顺序：`D:\2_Github_Repository\metapi\src\server\services\platforms\index.ts`
- 标题探测：`D:\2_Github_Repository\metapi\src\server\services\platforms\titleHint.ts`
- 站点管理接口：`D:\2_Github_Repository\metapi\src\server\routes\api\sites.ts`
- 自动路由重建：`D:\2_Github_Repository\metapi\src\server\services\modelService.ts`
- 路由选择器：`D:\2_Github_Repository\metapi\src\server\services\tokenRouter.ts`
- 代理路由注册：`D:\2_Github_Repository\metapi\src\server\routes\proxy\router.ts`
- 聊天/Responses 上游端点决策：`D:\2_Github_Repository\metapi\src\server\routes\proxy\upstreamEndpoint.ts`
- 路由管理接口：`D:\2_Github_Repository\metapi\src\server\routes\api\tokens.ts`
- 仪表盘统计接口：`D:\2_Github_Repository\metapi\src\server\routes\api\stats.ts`
- 前端总路由：`D:\2_Github_Repository\metapi\src\web\App.tsx`
- 站点页：`D:\2_Github_Repository\metapi\src\web\pages\Sites.tsx`
- 路由页：`D:\2_Github_Repository\metapi\src\web\pages\TokenRoutes.tsx`
- 仪表盘：`D:\2_Github_Repository\metapi\src\web\pages\Dashboard.tsx`
- 监控页：`D:\2_Github_Repository\metapi\src\web\pages\Monitors.tsx`
- 图表组件：`D:\2_Github_Repository\metapi\src\web\components\charts\SiteDistributionChart.tsx`、`D:\2_Github_Repository\metapi\src\web\components\charts\SiteTrendChart.tsx`、`D:\2_Github_Repository\metapi\src\web\components\ModelAnalysisPanel.tsx`

## 1. 站点类型检测是怎么实现的

### 1.1 检测入口

`metapi` 的站点识别链路很短：

- `detectSite(url)` 只做 URL 规范化，然后调用 `detectPlatform(url)`。
- `POST /api/sites/detect` 暴露手动探测接口。
- `POST /api/sites` 在用户没有手填 `platform` 时，也会先跑一次自动检测。

也就是说，站点类型不是前端写死判断，而是后端在保存站点前统一判断。

### 1.2 检测顺序

`platforms/index.ts` 里把适配器按下面顺序注册：

| 顺序 | 平台 |
| --- | --- |
| 1 | `openai` |
| 2 | `claude` |
| 3 | `gemini` |
| 4 | `cliproxyapi` |
| 5 | `anyrouter` |
| 6 | `done-hub` |
| 7 | `one-hub` |
| 8 | `veloera` |
| 9 | `new-api` |
| 10 | `sub2api` |
| 11 | `one-api` |

这样做的原因很明确：先识别“特化实现”，最后再回落到通用实现，避免 `new-api` 抢先把 `anyrouter`、`one-hub`、`done-hub`、`veloera` 这种分支误判掉。

### 1.3 检测信号分三层

#### 第一层：URL 关键字快速命中

`detectPlatformByUrlHint()` 先看 URL：

| 信号 | 识别结果 |
| --- | --- |
| `api.openai.com` | `openai` |
| `api.anthropic.com` / `anthropic.com/v1` | `claude` |
| `generativelanguage.googleapis.com` / `googleapis.com/v1beta/openai` / `gemini.google.com` | `gemini` |
| 包含 `anyrouter` | `anyrouter` |
| 包含 `donehub` / `done-hub` | `done-hub` |
| 包含 `onehub` / `one-hub` | `one-hub` |
| 包含 `veloera` | `veloera` |
| 包含 `sub2api` | `sub2api` |
| `127.0.0.1:8317` / `localhost:8317` | `cliproxyapi` |

#### 第二层：HTML `<title>` 提示

`titleHint.ts` 会请求根路径 `/`，取 HTML `<title>` 做正则匹配：

| 标题关键字 | 识别结果 |
| --- | --- |
| `Any Router` | `anyrouter` |
| `Done Hub` | `done-hub` |
| `One Hub` | `one-hub` |
| `Veloera` | `veloera` |
| `Sub2API` | `sub2api` |
| `New API` / `vo-api` / `super-api` / `rix-api` / `neo-api` / `Wong 公益站` | `new-api` |
| `One API` | `one-api` |

`index.ts` 里对 `anyrouter`、`done-hub`、`one-hub`、`veloera`、`sub2api` 这几个类型还设置了 title-first 优先级，也就是标题命中后可直接返回，不必继续跑通用探测。

#### 第三层：各平台自己的探测逻辑

这是最关键的一层。

| 平台 | 探测方式 |
| --- | --- |
| `new-api` | `GET /api/status`，要求 `success === true` 且 `data.system_name` 存在 |
| `one-api` | `GET /api/status`，要求 `success === true` 且 `data.system_name` 不存在 |
| `veloera` | `GET /api/status`，要求 `system_name` 或 `version` 中含 `veloera` |
| `cliproxyapi` | 先看端口 `8317` 或 hostname；否则请求 `GET /v0/management/openai-compatibility`，检查 `x-cpa-*` 响应头或 `openai-compatibility` payload |
| `sub2api` | 探测 `GET /api/v1/auth/me`、`GET /v1/models` 的未授权 JSON 包装；最后兜底检查首页标题是否是 `Sub2API` |
| `anyrouter` | 只做 URL 关键字识别，具体能力复用 `new-api` |
| `done-hub` | 只做 URL/title 识别，具体能力复用 `one-hub` |
| `one-hub` | 只做 URL/title 识别，具体能力复用 `one-api` 并补充 fallback |
| `openai` / `claude` / `gemini` | 官方域名匹配 |

## 2. 不同类型站点所用的管理 API 端点

这里说的是 `metapi` 在“站点管理、账号验证、模型发现、Token 管理”阶段直接调用的上游端点，不是代理转发时暴露给下游用户的 `/v1/*`。

### 2.1 总表

| 站点类型 | 用户/余额 | 登录/签到 | 模型拉取 | Token / 分组 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `new-api` | `/api/user/self` | `/api/user/login`、`/api/user/checkin`、回退 `/api/user/sign_in` | `/v1/models`，失败后 `/api/user/models` | `/api/token/?p=0&size=100`、`/api/token/`、`/api/token/{id}`、`/api/user_group_map`、`/api/user/self/groups` | 支持 Bearer、Session Cookie、`New-API-User` 等头 |
| `anyrouter` | 同 `new-api` | 同 `new-api` | 同 `new-api` | 同 `new-api` | 只是 `platformName = anyrouter`，实现继承 `NewApiAdapter` |
| `veloera` | `/api/user/self` | `/api/user/login`、`/api/user/checkin` | `/v1/models` | 无专门 token 管理实现 | 需要 `Veloera-User` / `New-API-User` / `User-id` 头 |
| `one-api` | `/api/user/self` | `/api/user/checkin` | `/v1/models` | `/api/token/?p=0&size=100`、`/api/token/`、`/api/token/{id}`、`/api/user_group_map`、`/api/user/self/groups` | 标准 One API 风格 |
| `one-hub` | 继承 `one-api` | 继承 `one-api` | 先 `/v1/models`，失败再 `/api/available_model` | 组信息优先 `/api/user_group_map` | `one-api` 的增强版 |
| `done-hub` | `/api/user/self` | 不支持签到 | 继承 `one-hub`，即 `/v1/models` + `/api/available_model` | 继承 `one-hub` | 余额换算规则与 `one-hub` 不同 |
| `sub2api` | `/api/v1/auth/me` | 不支持登录、不支持签到 | `/v1/models` 或 `/api/v1/models` | `/api/v1/keys`、`/api/v1/api-keys`、`/api/v1/groups*` | 详见下节 |
| `openai` | 无 | 不支持 | `/v1/models` 或 base 已带版本时的 `/models` | 无 | 官方上游模式 |
| `claude` | 无 | 不支持 | `/v1/models` 或 `/models` | 无 | 使用 `x-api-key` 和 `anthropic-version` |
| `gemini` | 无 | 不支持 | 原生 `.../v1beta/models?key=...` 或 OpenAI 兼容 `.../v1beta/openai/models` | 无 | 同时兼容 Gemini 原生和 OpenAI 兼容入口 |
| `cliproxyapi` | 无 | 不支持 | `/v1/models` | 探测端点 `/v0/management/openai-compatibility` | 本质是本地代理后端 |

### 2.2 New API / AnyRouter 这一支的特点

这一支是 `metapi` 里最复杂的适配器：

- 既支持 Bearer token，也支持 session cookie。
- 某些站点必须附带 `New-API-User`，适配器会从 JWT、cookie、gob payload、候选用户 ID 中自动猜。
- `verifyToken()` 先测 `/v1/models`，如果像 API key 就按 key 处理；否则再测 `/api/user/self` 和 cookie 回退链路。
- `getModels()` 优先 `/v1/models`，失败后走 `/api/user/models`，再不行用 cookie 再试。
- `checkin()` 先打 `/api/user/checkin`，失败后再用 cookie 打 `/api/user/sign_in` 和 `/api/user/checkin`。

### 2.3 One API / One Hub / Done Hub 这一支的特点

- `one-api` 是最标准的管理端模式，端点集中在 `/api/user/*`、`/api/token/*`、`/v1/models`。
- `one-hub` 在模型发现上多了 `/api/available_model` fallback。
- `done-hub` 复用 `one-hub` 的模型能力，但显式把签到标记为不支持。

### 2.4 官方上游这一支的特点

`openai`、`claude`、`gemini`、`cliproxyapi` 基本都属于“只负责模型枚举，不负责站内管理”的类型：

- 不做登录。
- 不做签到。
- 不做站内余额读取。
- 主要用于把“纯 API 上游”也纳入统一路由系统。

## 3. sub2api 类型站点的 API 端点

`sub2api` 是单独写了一个完整适配器的，逻辑比 One API 还独立。

### 3.1 认证方式

- 统一用 `Authorization: Bearer <token>`。
- 传入的 token 可以是 JWT，也可以是 API key。
- 内部会去掉用户可能带上的 `Bearer ` 前缀，再重新组装请求头。

### 3.2 端点清单

| 操作 | 端点 | 说明 |
| --- | --- | --- |
| 平台探测 | `GET /api/v1/auth/me` | 看未授权包裹是否符合 Sub2API 风格 |
| 平台探测 | `GET /v1/models` | 看未授权包裹是否符合 Sub2API 风格 |
| 平台探测兜底 | `GET /` | 检查首页 `<title>` 是否包含 `Sub2API` |
| 用户信息 | `GET /api/v1/auth/me` | 返回 `{ code, message, data }` 包裹 |
| 余额 | `GET /api/v1/auth/me` | 直接从 `data.balance` 读取 USD，再换算 |
| 模型列表 | `GET /v1/models` | 标准 OpenAI 兼容入口 |
| 模型列表回退 | `GET /api/v1/models` | 某些 Sub2API 变体走这个端点 |
| API Key 列表 | `GET /api/v1/keys?page=1&page_size=100` | 首选 |
| API Key 列表回退 | `GET /api/v1/api-keys?page=1&page_size=100` | 兼容别名 |
| 分组列表 | `GET /api/v1/groups/available` | 首选 |
| 分组列表回退 | `GET /api/v1/groups?page=1&page_size=100` | 兼容分页接口 |
| 分组列表回退 | `GET /api/v1/groups` | 兼容无分页接口 |
| 分组列表回退 | `GET /api/v1/group?page=1&page_size=100` | 兼容单数写法 |
| 分组列表回退 | `GET /api/v1/group` | 兼容单数无分页 |
| 创建 API Key | `POST /api/v1/keys` | 首选 |
| 创建 API Key 回退 | `POST /api/v1/api-keys` | 兼容别名 |
| 删除 API Key | `DELETE /api/v1/keys/{id}` | 首选 |
| 删除 API Key 回退 | `DELETE /api/v1/api-keys/{id}` | 兼容别名 |

### 3.3 sub2api 的几个实现细节

#### 1. 响应包裹不是 One API 风格

它要求解析的是：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

`code === 0` 才算成功，其它都抛错。

#### 2. 余额不是 quota，而是美元值

`fetchAuthMe()` 从 `/api/v1/auth/me` 取到 `data.balance` 后，会按 `500000` 的比例换算成内部 quota 语义。

#### 3. Session JWT 不一定能直接访问 `/v1/models`

`getModels()` 的处理顺序是：

1. 先尝试当前 token 访问 `/v1/models` 或 `/api/v1/models`。
2. 如果当前 token 实际上是 session JWT，不能直接列模型，就先用 JWT 去列出用户 key。
3. 拿到某个启用中的 API key 后，再用这个 key 请求模型列表。

#### 4. 分组拉不到时会从 key 列表反推 group

`getUserGroups()` 先拉 group 接口；如果拿不到，再从 key 列表里的 `group_id`、`groupId`、`group_name` 等字段回推。

#### 5. 不支持登录和签到

这在适配器里是显式返回失败的，不是“请求失败”。

## 4. 全部站点路由是怎么实现的

这里的“路由”有两层含义：

- 一层是 `metapi` 自己暴露给下游调用方的代理路由。
- 一层是它内部的“模型到站点/账号/token”的选择路由。

### 4.1 代理层统一入口

`src/server/index.ts` 注册了：

- 管理接口：`/api/sites`、`/api/accounts`、`/api/routes`、`/api/stats/*` 等
- 代理接口：`proxyRoutes(app)`，也就是所有 `/v1/*` 和 Gemini 原生接口

`src/server/routes/proxy/router.ts` 统一挂载这些代理路由：

| 对外路径 | 实现文件 |
| --- | --- |
| `/v1/chat/completions`、`/v1/messages` | `chat.ts` |
| `/v1/completions` | `completions.ts` |
| `/v1/responses`、`/v1/responses/compact` | `responses.ts` |
| `/v1/models` | `models.ts` |
| `/v1/embeddings` | `embeddings.ts` |
| `/v1/search` | `search.ts` |
| `/v1/files*` | `files.ts` |
| `/v1/images/generations`、`/v1/images/edits` | `images.ts` |
| `/v1/videos*` | `videos.ts` |
| `/v1beta/models*`、`/gemini/:version/models*` | `gemini.ts` |

### 4.2 自动路由的核心不是 site.platform，而是模型可用性表

`modelService.ts` 的 `rebuildTokenRoutesFromAvailability()` 是自动路由的核心：

1. 从 `tokenModelAvailability` 找到“某个 token 能用哪些模型”。
2. 从 `modelAvailability` 找到“某个账号能用哪些模型”。
3. 把它们折叠成 `model -> [accountId, tokenId]` 候选表。
4. 每个精确模型名自动创建一条 `tokenRoutes`。
5. 每个候选账号/token 自动创建一条 `routeChannels`。
6. 过时的自动通道会删除，但 `manualOverride = true` 的人工通道会保留。
7. 已经没有任何候选模型的精确路由会被删掉。

这意味着：

- 路由不是手写配置清单驱动，而是“模型发现结果”驱动。
- 站点变多后，不需要为每个站点单独写转发规则。
- 路由页看到的“模型路由”本质上是聚合后的能力视图。

### 4.3 路由选择器 tokenRouter 负责真正选通道

`tokenRouter.ts` 的职责是：

- 读取所有启用的 `tokenRoutes`
- 按 `exact` / `wildcard` / `re:` regex 匹配模型
- 把 route 下的 channel 关联到 account、site、token
- 过滤掉禁用 site、禁用 account、禁用 token
- 结合最近失败记录做失败退避
- 按 `weighted` 或 `round_robin` 选一个最终通道
- 返回 `selected.site`、`selected.account`、`selected.tokenValue`、`selected.actualModel`

同时它还能输出 `RouteDecisionExplanation`，给前端展示“为什么这条路由会选这个通道”。

### 4.4 聊天类请求的上游端点不是固定写死，而是动态决策

`chat.ts` 和 `responses.ts` 不直接把请求硬转发到某个固定路径，而是先调用：

- `resolveUpstreamEndpointCandidates()`
- `buildUpstreamEndpointRequest()`

这里会综合以下因素决定上游到底用哪个协议：

- 当前站点平台 `site.platform`
- 下游请求是 OpenAI Chat、Anthropic Messages、OpenAI Responses 还是 Gemini
- 模型名是不是 Claude 家族
- 是否包含文件输入
- 模型目录里声明的 `supportedEndpointTypes`

### 4.5 聊天/Responses 的上游端点映射

| 平台 | 候选策略 | 实际上游路径 |
| --- | --- | --- |
| `openai` | OpenAI 风格优先 | `/v1/chat/completions`、`/v1/responses`，必要时也可试 `/v1/messages` |
| `claude` | 只走 Claude 原生 | `/v1/messages` |
| `gemini` | 走 Gemini OpenAI 兼容层 | `.../v1beta/openai/chat/completions` 或 `.../v1beta/openai/responses`；如果 base 已带 `/openai`，则用 `/chat/completions` 或 `/responses` |
| `anyrouter` | 明显偏 `messages` / `responses` 优先 | `/v1/messages`、`/v1/responses`、`/v1/chat/completions` 三者择优 |
| `new-api`、`one-api`、`one-hub`、`done-hub`、`veloera`、`sub2api` | 视下游协议和模型族动态选择 | 默认在 `/v1/messages`、`/v1/responses`、`/v1/chat/completions` 三者中切换 |

可以把它理解成：`metapi` 并不是“一个下游协议只能连一个上游协议”，而是在中间做了一个协议适配层。

### 4.6 其它代理路由大多是直接拼接转发

以下路由基本都是 `selected.site.url + 固定路径`：

| 对外路由 | 上游路径 |
| --- | --- |
| `/v1/completions` | `/v1/completions` |
| `/v1/embeddings` | `/v1/embeddings` |
| `/v1/search` | `/v1/search` |
| `/v1/images/generations` | `/v1/images/generations` |
| `/v1/images/edits` | `/v1/images/edits` |
| `/v1/videos` | `/v1/videos` |

例外有两个：

- `/v1/models` 不是单站点透传，而是从本地 `modelAvailability` 和 `tokenRoutes.displayName` 聚合出来的。
- `/v1/files*` 是本地文件存储，不依赖任何站点上游。

### 4.7 Gemini 原生路由是单独处理的

`proxy/gemini.ts` 没有复用 `chat.ts` 的 OpenAI 兼容链路，而是直接：

- 通过 `tokenRouter` 选一个能跑 Gemini 模型的通道
- 用 `geminiGenerateContentTransformer` 解析 `/v1beta/models/*` 或 `/gemini/:version/models/*`
- 把模型名替换成实际选中的 `selected.actualModel`
- 请求真正的 Gemini 原生 URL

这让 `metapi` 同时能代理 OpenAI 兼容接口和 Gemini 原生接口。

## 5. 前端页面路由是怎么实现的

`src/web/App.tsx` 用 `react-router-dom` 管理页面路由，核心入口如下：

| 前端路由 | 页面 |
| --- | --- |
| `/` | `Dashboard` |
| `/sites` | `Sites` |
| `/accounts` | `Accounts` |
| `/tokens` | `Tokens` |
| `/checkin` | `CheckinLog` |
| `/routes` | `TokenRoutes` |
| `/logs` | `ProxyLogs` |
| `/monitor` | `Monitors` |
| `/settings` | `Settings` |
| `/settings/import-export` | `ImportExport` |
| `/settings/notify` | `NotificationSettings` |
| `/models` | `Models` |
| `/playground` | `ModelTester` |
| `/about` | `About` |

这部分是典型后台管理台的页面路由，不是 API 代理层的 `/v1/*` 路由。

## 6. 数据可视化和展示是怎么做的

### 6.1 Dashboard 页的数据来源

`Dashboard.tsx` 会并行请求：

- `GET /api/stats/dashboard`
- `GET /api/stats/site-distribution`
- `GET /api/stats/site-trend?days=n`
- `GET /api/sites`

后端统计主要在 `stats.ts` 里完成：

- `/api/stats/dashboard` 返回余额、今日消耗、签到情况、24h 代理成功率、TPM/RPM、站点可用性、模型分析
- `/api/stats/site-distribution` 返回按站点聚合的余额、消耗、账号数
- `/api/stats/site-trend` 返回按天聚合的站点消耗/调用次数
- `/api/models/token-candidates` 返回路由页需要的模型候选、缺 token 提示、endpoint type 提示

### 6.2 图表库

图表统一使用 `@visactor/react-vchart` 的 `VChart`。

### 6.3 站点分布图

`SiteDistributionChart.tsx` 的做法：

- 数据来自 `/api/stats/site-distribution`
- 视图切换：`balance` 和 `spend`
- 图表类型：环形饼图
- 每个切片显示站点占比
- 下方附带图例和站点明细

### 6.4 站点趋势图

`SiteTrendChart.tsx` 的做法：

- 数据来自 `/api/stats/site-trend`
- 视图切换：`spend` 和 `calls`
- 图表类型：折线图
- `seriesField = site`，所以每个站点一条线

### 6.5 模型分析面板

`ModelAnalysisPanel.tsx` 的做法：

- 数据直接来自 `/api/stats/dashboard` 的 `modelAnalysis`
- 通过 tab 分成四块：
  - 消耗分布：横向柱状图
  - 消耗趋势：面积图
  - 调用分布：饼图
  - 排行榜：表格

也就是说，仪表盘并不是只有“站点维度”，还叠了一层“模型维度”的可视化。

### 6.6 站点可用性不是图表组件，而是按小时桶聚合后的卡片

`stats.ts` 里用 `buildSiteAvailabilitySummaries()`：

- 以最近 24 个小时为桶
- 从 `proxyLogs` 聚合 `successCount`、`failedCount`、`latencyMs`
- 生成每个站点的 `availabilityPercent` 和 `averageLatencyMs`

`Dashboard.tsx` 再把这些结果渲染成站点可观测卡片，并支持跳到对应时间段日志。

### 6.7 监控页是 iframe + 反向代理，不是图表库

`Monitors.tsx` 主要负责嵌入外部监控页：

- 监控页列表是前端常量 `MONITOR_SITES`
- `GET /api/monitor/config` / `PUT /api/monitor/config` 管理 LDOH cookie
- `POST /api/monitor/session` 下发当前站点 HttpOnly cookie
- `/monitor-proxy/ldoh/*` 在后端做代理、重写 HTML/JS/CSS 内的资源路径

所以 `metapi` 的“数据展示”分成两种：

- 自己算的统计数据，用 VChart 画。
- 外部监控页面，用 iframe + proxy 内嵌。

## 7. 对本项目可复用的设计点

如果要把 `metapi` 的思路借到当前项目，最值得复用的是这几层拆分：

1. `siteDetector -> platform registry -> adapter`，把“识别”和“调用端点”解耦。
2. 用“模型可用性表”驱动自动路由，而不是为每个站点手写转发规则。
3. 聊天类请求加一层 `upstreamEndpoint` 选择器，让 OpenAI / Claude / Responses / Gemini 协议能互相适配。
4. 路由页不要只展示结果，还展示 `decision explanation`，这样用户能看懂为什么命中了某个通道。
5. 统计接口先在后端聚合，再交给前端图表组件，前端只做渲染和筛选。

## 8. 一句话总结

`metapi` 的核心不是“支持很多站点类型”，而是把这件事拆成了：

- 站点探测适配器
- 模型可用性采集
- 自动路由重建
- 代理协议适配
- 统计聚合与可视化

这也是它能同时覆盖 `new-api`、`one-api`、`sub2api`、官方 API、Gemini 原生接口和外部监控页的关键。
