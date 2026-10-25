

## 架构与数据管理重构（2026-10-24）

- [api-key-policy.ts](api-key-policy.ts): 纯 API key 规范化、掩码保留和认证失败判定
- [api-keys-operations.ts](api-keys-operations.ts): 上游 API key 查询、创建、删除及真实 key 补全
- [authentication-operations.ts](authentication-operations.ts): 站点账户初始化与浏览器认证获取
- [checkin-operations.ts](checkin-operations.ts): 签到支持、状态、执行和浏览器回退
- [detection-operations.ts](detection-operations.ts): 账户数据、分组和模型价格刷新
- [token-contracts.ts](token-contracts.ts): Token 操作上下文中的共享参数类型
