# Repositories

- sites-repository.ts: ordered groups/sites/accounts, encrypted per-entity extensions and local-key child rows; deleting an allow-list's last target disables the affected rule. No browser or IPC dependencies.

Repositories do not own optimistic version checks; callers must use StorageCoordinator for user commands.

## 架构与数据管理重构（2026-10-24）

- [document-mapping.ts](document-mapping.ts): 已迁移文档路径与字段到实体表的完整映射
- [document-store.ts](document-store.ts): 逻辑文档与逐实体行的重建、变更比较、增量桶更新
- [sites-repository.ts](sites-repository.ts): 按 ID 站点/账户仓储及关联删除约束
