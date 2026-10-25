# 存储 schema 与字段归属

日期：2026-10-24。当前 schema=3；应用配置版本仍为 3.0.6，配置卡片格式=4。三者独立演进。

## 唯一来源与物理布局

应用在窗口创建前显式打开 Electron userData/storage/app.db。迁移完成后，以下 JSON 路径只标识旧输入和逻辑交换文档；正常业务读写由 ApplicationStorage 路由到数据库。已迁移的旧文件即使随后变化或损坏，也不会重新导入。数据库不可读时启动报错，不回退 JSON。

| 逻辑域 / 旧路径 | 当前实体表 | 键与细分规则 |
|---|---|---|
| config.json: siteGroups/sites/accounts | site_groups / sites / accounts | 原 ID、group_id/site_id、顺序、enabled；非索引字段进入各自 payload |
| accounts.local_api_keys | account_keys | account_id + source + key_id；保留顺序与缺失/空列表区别 |
| routing.rules | route_rules / rule_sites / rule_accounts | 原 rule ID；限制名单独立关联和排序；声明为空与未声明保留区别 |
| routing.modelRegistry.displayItems | model_redirects / model_exclusions | 展示项 ID、顺序；自动收集排除项独立记录，其他优先级/模式保留 |
| routing.clientRouting | client_routing | client_id；mode/pinned 显式列；modelId/reasoningEffort 保留 |
| sessionRouting.instances | session_choices | 实例 ID、profile、parent、pin；其余实例字段逐实体保留 |
| sessionRouting.rules/overrides/currentRouteBySlot；model overrides | document_records | document_id + collection + record_key，保留数组顺序或 map 键 |
| config 根字段、settings、server、CLI model/thinking selections、analytics.config 等剩余小字段 | app_preferences | domain=逻辑文档 ID；key=JSON 编码的字段路径；按叶子加密，不保存整个配置副本 |
| runtime-cache.json 三个实体缓存 map | detection_cache | owner_kind + owner_id；包含 API key 的缓存也加密 |
| site_daily_snapshots_by_site_id | site_daily_snapshots | site_id + snapshot_date；读回按时间排序 |
| state/route-runtime.json | route_runtime | kind + 原 record_key；stats/path/capability/health 分开 |
| state/route-analytics.json | route_analytics_buckets | bucket_key；时间、站点、账户、CLI、协议、端点、规则、模型、key、计数和 token 独立列 |
| state/route-model-sources.json | route_model_sources + document_records | 来源键由既有 sourceKey 与 originalModel 组合编码；保留 sourceKey 原语义；派生 entries 逐项保存 |
| state/route-endpoint-tests.json | document_records | targets map 每个业务键一行 |
| state/route-session-activity.json | session_activity | instance_id；last_request_at 显式列 |
| state/route-session-bindings.json | session_bindings | 原 binding_key；12 小时/5000 条/250ms 合并刷盘策略保留 |
| state/route-state-affinity.json | response_affinity | namespace + resource_id；profile/精确通道及过期字段保留 |
| custom-cli-configs.json | custom_cli_configs / custom_cli_keys + app_preferences | 每个配置与 key 单独记录；activeConfigId、认证、价格、notes 等保留 |
| config-file-profiles.json | config_file_profiles / profile_files | profile ID/revision/顺序；文件模板、路径、认证、DSH、lastApplied 保留 |
| theme/close-behavior/update settings | app_preferences | 各自独立 domain，不借启动配置建立第二份可写真相 |

每个逻辑文档在 document_metadata 中只有存在性/格式标记。document_records 用于没有额外索引需求的逐实体集合，不承担整个应用配置 blob。所有未索引扩展保存在所属实体的加密 payload，未知扩展不静默丢弃。

## 约束与更新

- 外键始终开启；站点删除级联账户和 key 关联，规则关联受约束。删除受限规则的最后一个目标时禁用该规则，避免变成无限制路由。历史统计不设置面向当前实体的级联外键。
- site_defaults 与归属触发器支持显式默认账户关系；兼容 facade 的默认账户仍沿用账户稳定顺序，不凭空替换现有选择。
- 更新采用 INSERT ... ON CONFLICT DO UPDATE 和按键删除；不使用 REPLACE。写入器比较原解密载荷和列值，跳过未变更行。
- 分析统计热路径只合并脏桶；flush 用 upsertCollection，不扫描/重写历史桶。时间范围查询走 analytics_time，TTL/max-items 清理使用 updated_at 索引，默认 30 天/50000 桶。
- 稳定修改使用 generation + scope + revision。app-config、custom-cli-configs、config-file-profiles 为独立 scope；纯缓存/统计/派生来源刷新不推进 app-config revision、不触发配置自动备份。
- 跨域恢复及卡片删除与其亲和/会话清理在一个数据库事务中完成；成功提交后才发布稳定配置投影。

## schema 迁移

| 版本 | 变化 |
|---|---|
| 1 | 业务实体、关联、偏好、运行态、统计、来源、亲和、操作日志、scope revisions 和索引 |
| 2 | document_metadata 存在标记；document_records 逐实体扩展集合 |
| 3 | 名单/来源的 sort_order；analytics_updated 清理索引 |

schema_migrations 保存每次 SQL 的 SHA-256 和时间；已应用 SQL 不允许改写。现有库升级前通过 SQLite online backup 创建完整性验证快照，再在单事务内执行后续迁移。未来版本、外来 application_id、迁移校验和不一致均拒绝写入。应用标识为 0x41504842。

## 加密边界

payload-codec 使用项目既有 encrypted:v1 对各实体扩展、偏好叶子、模板和 journal 原始正文先加密再交给 SQLite，保护新写入的页/WAL/在线快照。身份、关系、排序和统计查询列仍可读；这不是整库加密，也不是新增 OS 密钥托管。

旧 JSON 迁移先按字段解开旧密文，再写新载荷，避免嵌套加密。迁移备份有意保留原始字节，因此可能保留旧明文；历史日志/旧外部文件也不会被自动擦写。固定密钥的既有限制见 STORAGE_OPERATIONS.md。

## 数据库之外

model-metadata.json 是可重建公共缓存；CLI/DSH 实际文件、浏览器 Profile、日志、下载和外部认证文件继续由原所有者管理。CLI 新备份正文带 api-hub-cli-backup:v1 前缀并加密；原始备份和导入历史不参与十份滚动快照删除。AppStorageManifest 同时登记物理 DB、逻辑文档到表的映射及这些保留文件。

实现位置：src/main/storage/database/schema.ts、repositories/document-mapping.ts、document-store.ts；运维与恢复见 STORAGE_OPERATIONS.md。验收证据见 ARCHITECTURE_REFACTOR_PROGRESS.md。
