# Storage integration checks

- sqlite-driver.integration.ts: real Electron ABI driver, transaction/foreign-key/busy/backup/reopen checks and synthetic durable workload measurements.
- packaged-smoke.ts: isolated packaged executable entry, backup validation and cross-restart persistence.
- app-database.integration.ts: schema upgrades/rollback, ownership/version protection, default-account relationships, stale writes, maintenance and actual interrupted-process recovery.
- sites-repository.integration.ts: same-name site identity, ordering, local-key round-trip and atomic allow-list cleanup.

Run through npm run test:storage; *.integration.ts is intentionally outside the host-Node Vitest glob.

## 架构与数据管理重构（2026-10-24）

- [app-database.integration.ts](app-database.integration.ts): 真实 Electron/SQLite 集成验收
- [application-storage.integration.ts](application-storage.integration.ts): 迁移、恢复、按域快照、原始备份、屏障、journal 和进程中断
- [packaged-smoke.ts](packaged-smoke.ts): 既有业务入口接入数据库/命令边界，保留兼容业务行为
- [product-smoke.ts](product-smoke.ts): 实际 ASAR 产品迁移/编辑/导出/恢复/重启夹具
- [sites-repository.integration.ts](sites-repository.integration.ts): 真实 Electron/SQLite 集成验收
- [sqlite-driver.integration.ts](sqlite-driver.integration.ts): 真实 Electron/SQLite 集成验收
- [analytics-repository.integration.ts](analytics-repository.integration.ts): 真实 SQLite 五万桶的增量更新与索引/保留测试
- [product-route-smoke.ts](product-route-smoke.ts): 真实打包产品三协议本地假上游与 CLI 假文件应用
