# src/shared/utils/ - 共享工具函数

## 架构说明

**职责**: 提供主进程和渲染进程共享的纯工具函数。

**特点**:
- 不依赖 Electron 或 React
- 只承载跨层复用的小型纯函数
- 被 `main/`、`renderer/` 和测试直接导入

---

## 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **customCliRouteId.ts** | 自定义 CLI 路由通道合成 ID（site/account/apiKey）跨进程命名约定 | `buildCustomCliRouteSiteId()`, `buildCustomCliRouteAccountId()`, `buildCustomCliRouteApiKeyId()`, `parseCustomCliRouteConfigId()`, `isCustomCliRouteSiteId()`, `isCustomCliRouteChannel()` |
| **headers.ts** | 生成兼容不同中转站大小写习惯的用户 ID 请求头 | `getAllUserIdHeaders()` |
| **log-filter.ts** | 判断模型调用日志并聚合 usage / quota 指标 | `isModelLog()`, `aggregateUsageData()`, `filterAndAggregateUsageData()` |

---

## 关键契约

### headers.ts

`getAllUserIdHeaders(userId)` 会返回一组不同命名约定的用户 ID 请求头：

```typescript
getAllUserIdHeaders('123');
// {
//   'New-API-User': '123',
//   'Veloera-User': '123',
//   'User-id': '123',
//   'voapi-user': '123',
//   'X-User-Id': '123'
// }
```

注意：不要同时生成同名不同大小写的重复 header。Node/Electron/Fetch 可能折叠或覆盖这类 header，导致实际发出的大小写不可控。

### log-filter.ts

`isModelLog(item)` 只把存在非空 `model_name` 的日志视为模型调用日志。统计消费和 token 时应通过 `filterAndAggregateUsageData(items)` 先过滤再聚合，避免系统日志或管理操作污染模型调用统计。

```typescript
filterAndAggregateUsageData([
  { model_name: 'gpt-4.1', quota: 10, prompt_tokens: 4, completion_tokens: 6 },
  { quota: 100 },
]);
// { quota: 10, promptTokens: 4, completionTokens: 6, requestCount: 1 }
```

### customCliRouteId.ts

自定义 CLI 进入路由统计时没有真实站点/账户/API Key 层级，因此使用合成 ID：

- `custom-cli-site-{encodedConfigId}`
- `custom-cli-account-{encodedConfigId}`
- `custom-cli-key-{encodedConfigId}`

所有跨进程代码必须通过本文件的 helper 生成或解析这些 ID，不要手写前缀。

---

## 自指

当此文件夹中的文件变化时，更新本索引、`src/shared/FOLDER_INDEX.md` 和 `PROJECT_INDEX.md`。

---

**版本**: 3.0.3
**更新日期**: 2026-05-27
