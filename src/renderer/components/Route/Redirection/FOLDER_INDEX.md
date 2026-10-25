

## 架构与数据管理重构（2026-10-24）

- [ModelRedirectionTab.tsx](ModelRedirectionTab.tsx): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [model-redirection-view.ts](model-redirection-view.ts): 重定向分组、筛选、优先级及草稿纯计算
- [ModelRedirectionParts.tsx](ModelRedirectionParts.tsx): 模型优先级列表、会话点和状态展示
- [useModelRedirectionController.tsx](useModelRedirectionController.tsx): 模型数据加载、草稿、分组选择和提交控制
