# Database storage

- schema.ts: immutable numbered SQLite migrations, relationships and query indexes.
- app-database.ts: injected-path connections, ownership/version checks, synchronous transactions and verified online snapshots. No database opens at import time.
- storage-coordinator.ts: serialized versioned mutations, independent scope revisions and maintenance/generation barriers.
- payload-codec.ts: existing encrypted:v1 protection for per-entity unindexed extensions/templates before SQLite sees their contents.

Production storage is not switched until migration and restore acceptance gates pass.

## 架构与数据管理重构（2026-10-24）

- [app-database.ts](app-database.ts): 受控 SQLite 连接、同步事务、升级校验及在线快照
- [payload-codec.ts](payload-codec.ts): 逐实体/叶子载荷的 encrypted:v1 编解码
- [schema.ts](schema.ts): 不可变的编号 schema 迁移、约束与索引
- [storage-coordinator.ts](storage-coordinator.ts): 跨 scope 排队、revision、generation 和维护状态
