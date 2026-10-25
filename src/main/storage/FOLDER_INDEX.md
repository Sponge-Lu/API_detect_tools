# Storage

- database/: SQLite schema and connection infrastructure. Storage does not import application business managers.
- repositories/: typed domain row mapping, independent from IPC and browser services.

## 架构与数据管理重构（2026-10-24）

- [application-storage.ts](application-storage.ts): 生命周期组装、旧文件一次性迁移、按域逻辑快照、恢复屏障与 generation
- [cli-operation-journal.ts](cli-operation-journal.ts): 外部 CLI 文件 prepared/committed 日志和中断恢复
- [config-command-service.ts](config-command-service.ts): 按 ID 配置命令、字段白名单与版本校验
- [ipc-handler.ts](ipc-handler.ts): IPC 活动许可、维护拒绝、路由命令版本守卫及提交后副作用

## 职责子模块（2026-10-24）

- [database/](database/FOLDER_INDEX.md)
- [repositories/](repositories/FOLDER_INDEX.md)
