# brainstorm: app data storage and v2 migration

## Goal

重新设计 Electron 应用的本地配置、运行时缓存、日志、备份、临时文件和敏感数据存储结构，使职责边界清晰、文件不会重复膨胀，并提供从 v2.1.24 到当前版本配置文件的可验证迁移路径。该任务需要覆盖主进程持久化、渲染进程读取/展示、IPC 边界、备份恢复和回滚策略。

## What I Already Know

* 用户要求基于现有审查结果重新制定结构，前后端同步更改，并包含 v2.1.24 到当前版本的配置迁移脚本。
* 当前 `config.json` 与 `runtime-cache.json` 仍存在职责重叠：`cached_data` 会从 runtime cache hydrate 回 config，也会继续保存到 config。
* 当前 `config.json.routing` 同时保存稳定配置和运行态数据：`stats`、`routePathStates`、`health`、`cliProbe.history/latest`、`analytics.buckets`。
* 当前备份/恢复主要只处理 `config.json`，不覆盖 `runtime-cache.json`、`custom-cli-configs.json`、`credit-settings.json`、主题/关闭行为/更新设置、浏览器 profile 等。
* 当前 WebDAV/本地恢复 `config.json` 后，旧 `runtime-cache.json` 可能继续 hydrate 到恢复后的配置。
* 当前敏感数据包括 cookies、API key、CLI auth/config 文件；部分明文落盘且部分日志会打印 cookie 片段。
* 当前存在多个直接 `writeFile`/`writeFileSync` 路径，只有 `config.json` 与 `runtime-cache.json` 使用原子写。
* 当前真实 CLI 配置写入用户 home 目录是设计功能，但应与 app 内部数据存储边界区分。
* 本机实际检查显示，主数据目录是 `%APPDATA%/api-hub-management-tools`，本地备份目录是 `%USERPROFILE%/.api-hub-management-tools`，更新器目录是 `%LOCALAPPDATA%/api-hub-management-tools-updater`。
* 本机实际 `config.json` 为 17.72 MB；本地备份保留 10 份，合计 176.69 MB，且每份 config 备份约 18 MB。
* 本机实际 `config.json` 仍含 40 个 site `cached_data`、42 个 account `cached_data`、1183 条 CLI probe latest、8635 条 CLI probe history sample、2614 个 model registry source；`runtime-cache.json` 同时还有 40 个 site shared、42 个 account runtime、30 个 daily snapshot。
* 本机实际 `config.json` / `runtime-cache.json` 存在仅大小写不同的模型 key，例如普通 JSON 解析器会因 `Kimi-K2-Instruct` vs `kimi-k2-instruct`、`gpt-5` vs `GPT-5` 报冲突；模型索引持久化需要定义 canonical key 和显示名分离策略。
* 本机实际最大磁盘占用不是 JSON，而是浏览器/Chromium 数据：`browser-profiles` 779.76 MB，`Cache` 238.85 MB，`Code Cache` 116.86 MB，`browser-data` 70.76 MB，`chrome-profile` 46.83 MB。
* 本机实际 `%TEMP%` 下仍有 Chrome/profile 残留：`api-detector-chrome` 1151.37 MB、`api-detector-chrome-login` 272.51 MB、`api-detector-chrome-isolated-*` 合计约 197 MB，以及多批 `api-detect-*-wrapper-*` 目录。
* 本机实际 `custom-cli-configs.json` 有 5 条配置且都带 API key；`credit-settings.json` 含 cookies 与 cachedInfo；`logs` 目录约 2.16 MB。
* 用户明确要求：本轮不动浏览器相关文件，因为这些会影响站点多账户管理功能。
* 用户倾向：敏感数据本轮先不做加密/迁移，优先处理配置/cache/log/备份结构。
* 当前备份触发过于宽泛：`UnifiedConfigManager.saveConfig()` 每次都会自动备份 `config.json`，而 route stats、route health、route path state、CLI probe、analytics buckets 等运行态更新都会调用 `saveConfig()`。
* 本机备份目录显示数秒内可连续生成多份约 17.9 MB 的 `config_*.json`，证实自动备份存在高频 churn。
* 本机复核显示最近 10 份 `config_*.json` 在约 42 秒内生成，每份约 18 MB；当前实现没有节流、内容 hash 去重、事件分类或大小上限。
* 当前 `src/main/utils/logger.ts` 基于 `electron-log/main` 写入 `%APPDATA%/api-hub-management-tools/logs/main.log`，同时在开发环境输出到控制台；该 logger 入口目前没有统一脱敏。
* 当前 `src/main/credit-service.ts` 存在明确的 cookie 日志：输出 cookie 前 100 字符、cookie 名称/域名、保存的 cookie 前 100 字符。
* 本机日志扫描显示当前 `main.log` 未命中常见 token/cookie/key 模式，`main.old.log` 命中 3 条 `Authorization: Bearer ...` 形式的历史日志；未输出真实值。
* `src/shared/utils/log-filter.ts` 当前只包含模型日志过滤/聚合函数，文档里提到的 `maskSensitiveInfo()` 等脱敏函数没有实际实现。
* 用户明确决定：本轮不进行日志脱敏，不改 logger，不改现有 cookie/token 日志调用点。

## Assumptions

* 新结构优先兼容现有 Electron `app.getPath('userData')` 数据目录。
* v2.1.24 配置至少包含旧版 `sites`、站点级 `cached_data`、站点级 CLI 兼容缓存等，需要迁移到当前多账户和运行时缓存结构。
* 迁移脚本应可独立运行，也应能被应用启动迁移流程复用，避免脚本逻辑和运行时代码分叉。
* 迁移需要保留可回滚备份，不应静默覆盖用户现有配置。

## Open Questions

* 自动备份策略采用哪种触发/节流模型？

## Requirements (Evolving)

* 明确 app 内部数据 manifest：稳定配置、运行时缓存、统计/日志、敏感凭据、备份、临时文件分别归属到固定路径。
* 采用“干净存储 + 兼容门面”方案：内部落盘结构必须干净分层；对尚未迁移的前端调用，主进程可临时组装 hydrated view。
* 明确区分稳定配置 API 与兼容视图 API，避免新代码继续依赖旧 `cached_data` 投影。
* 本任务是存储结构和迁移重构，不得改变现有业务逻辑语义：站点检测、多账户管理、路由选路、CLI 配置/探测、积分功能、备份/恢复 UI 的用户可见行为应保持等价。
* 对现有前端调用必须提供兼容读模型；在前端未显式迁移到新 IPC/API 前，页面拿到的数据结构和关键字段不得缺失或改名。
* `config.json` 只保存稳定配置和用户意图，不保存高频运行态和可重建缓存。
* 本轮不得修改、迁移、删除或自动清理浏览器相关文件，包括 Chromium cache、持久 browser profiles、Temp Chrome profiles；仅允许在文档/manifest 中标注归属和默认备份排除。
* 默认备份不得包含 Chromium cache、Temp profile、更新安装包、可重建浏览器缓存；browser profile 备份不进入本轮 MVP。
* 运行时缓存从配置文件中剥离，避免 `config.json` 与 `runtime-cache.json` 双写相同内容。
* 路由统计、健康、探测历史、analytics bucket 从 `config.json.routing` 中拆出或明确分层。
* 本地备份与 WebDAV 备份/恢复要覆盖新的 manifest，恢复后不能被旧缓存回灌污染。
* 自动备份不得由运行态写入触发；运行态/统计/analytics/probe/cache 写入只更新 state 文件，不生成 config 备份。
* 自动备份必须从 `saveConfig()` 的无条件副作用中移出，改为显式事件触发，并具备节流、内容去重和手动强制备份路径，避免数秒内生成多份大文件。
* 备份触发事件至少区分：稳定配置变更、迁移前/恢复前安全点、手动备份、运行态/cache/statistics 写入；其中运行态/cache/statistics 写入不得触发自动备份。
* 采用分级备份策略：手动/迁移前/恢复前/导入前生成 full manifest bundle；稳定配置变更只生成 throttled + hash-deduped lightweight config snapshot；运行态/cache/statistics 写入永不触发备份。
* 主进程和渲染进程的读取、展示、刷新、清理逻辑同步适配新路径和新 IPC 契约。
* 提供 v2.1.24 到当前版本的配置迁移脚本，并配套测试夹具。
* 写入 JSON 文件统一使用原子写工具。
* 所有拆出的 state/cache/statistics 文件必须定义 owner、数据来源、是否可重建、保留策略、去重键和增长上限，避免把 `config.json` 的膨胀转移成新的大 JSON 文件。
* 运行态历史类数据必须有 TTL 或 max-items 上限：CLI probe history、analytics buckets、route request logs、daily snapshots、model registry sources 不能无界增长。
* `config.json` 大小只能随用户维护的稳定配置增长，不得随检测次数、路由请求次数、CLI 探测次数、analytics bucket 数量增长。

## Sensitive Data Classification

Sensitive data in this task means values that can authenticate as a user, access an upstream API, or unlock a remote backup. This classification is for storage/backup metadata decisions only; storage encryption/migration and log redaction remain out of scope.

* Authentication tokens: `access_token`, `system_token`, `auth_token`, `refresh_token`, Bearer token values, browser/localStorage tokens such as `token`, `api_token`, `bearer_token`.
* API keys: `UnifiedSite.api_key`, `DetectionCacheData.api_keys[].key/token`, `CustomCliConfig.apiKey`, route proxy `server.unifiedApiKey`, and request headers/query params such as `Authorization`, `x-api-key`, `x-goog-api-key`, `?key=...`.
* Cookies/session values: `credit-settings.json.cookies`, browser cookies, `Cookie` headers, Cloudflare/session cookie values. Cookie names and domains are lower risk than values, but log handling is not changed in this task.
* Remote-backup credentials: WebDAV password and any future remote backup secret.
* Not classified as sensitive by default: site names, site URLs, account display names, user IDs, model names, token counts, latency, status codes, API key IDs, API key display names, route rule names. These can be privacy-relevant, but they are not authentication secrets and are needed for diagnostics.

## Log Handling Decision

No log redaction will be implemented in this task. Existing logs, logger behavior, and existing cookie/token logging call sites remain unchanged unless they must be touched for a separate non-redaction reason.

The security trade-off is accepted for this iteration: this task focuses on storage layout, runtime/cache split, backup strategy, restore semantics, and v2.1.24 migration.

## Acceptance Criteria (Evolving)

* [ ] 从 v2.1.24 样例配置迁移后，站点、账户、CLI 配置、缓存、路由设置能按新结构落盘。
* [ ] 迁移前后，现有站点检测、多账户登录/切换、路由代理、CLI 配置应用、积分缓存展示、备份列表/恢复入口的业务行为保持等价。
* [ ] `config.json` 不再包含运行态 `cached_data`、路由统计历史、analytics buckets 或 CLI 探测历史。
* [ ] 恢复备份后，旧 runtime cache 不会重新污染恢复后的配置。
* [ ] 前端现有站点页、数据总览、路由页、日志页仍能通过 IPC 获取所需数据。
* [ ] 兼容门面输出覆盖现有前端依赖字段；旧 `loadConfig()`/`getLegacyConfig()` 消费路径在本轮实现后不出现字段缺失回归。
* [ ] 本地备份和 WebDAV 备份能按 manifest 打包、校验、恢复。
* [ ] 高频 route stats、health、probe、analytics、cached data 写入不会生成新的 `config` 自动备份。
* [ ] 稳定配置自动备份具备节流/去重保护；连续多次保存相同内容不会生成重复备份。
* [ ] 每个新 state/cache 文件都有明确 retention/cap 规则，并有测试覆盖 prune/compaction 行为。
* [ ] 在本机现有数据迁移结果中，`config.json` 不再包含重复 cached/runtime payload；route probe、analytics、model registry 等拆分文件不与 stable config 双写同一 payload。
* [ ] 高频检测/探测/路由请求模拟不会导致任一单个 JSON 文件出现无界 append-only 增长。
* [ ] 迁移失败时保留原文件，并能给出明确错误。
* [ ] 单元测试覆盖迁移、备份恢复、原子写、运行缓存分层和前端数据契约。

## Definition of Done

* Tests added/updated for migration, config manager, runtime cache manager, backup/WebDAV, and affected renderer flows.
* Before changing any storage writer/reader, add or update equivalence tests/fixtures for the affected business read model.
* Lint/typecheck/test suite pass for touched areas.
* `PROJECT_INDEX.md` and relevant `FOLDER_INDEX.md` updated if modules are added/removed.
* Storage manifest and migration behavior documented.
* Rollback/recovery path documented and tested.

## Out of Scope (Temporary)

* 暂不改变真实 CLI 工具自身配置文件格式。
* 暂不删除用户已有历史备份，除非新清理策略明确覆盖。
* 本轮不动浏览器相关文件：不迁移、不删除、不清理、不压缩、不改路径。
* 本轮不做 cookies/API key 加密或敏感文件迁移。
* 本轮不做日志脱敏，不改 logger，不重写/清理历史日志，不因脱敏目的修改现有 cookie/token 日志调用点。

## Technical Notes

* Current core files: `src/main/unified-config-manager.ts`, `src/main/runtime-cache-manager.ts`, `src/main/backup-manager.ts`, `src/main/webdav-manager.ts`, `src/main/route-analytics-service.ts`, `src/main/route-cli-probe-service.ts`, `src/main/credit-service.ts`, `src/main/custom-cli-config-service.ts`, `src/main/utils/logger.ts`.
* Current renderer/IPC impact areas likely include route overview/log pages, config store, data overview page, and backup/settings handlers.
* Existing docs already describe the goal that `config.json` should no longer carry all runtime cache, but implementation is incomplete.
* This is a complex cross-layer storage and migration task; implementation should likely be split into several smaller PRs.
* `v2.1.24` tag exists. Current app version is `3.0.1`; current config schema constant is `3.1`.
* `package.json` already exposes `migrate:config-v224-to-v301`.
* Existing `scripts/migrate-config-v224-to-v301.cjs` already supports `--path`, `--dry-run`, original config backup, existing runtime cache backup, and writes `runtime-cache.json`; however it writes directly rather than through a shared atomic writer.
* The current migration script removes `cached_data` from persistable `sites` and `accounts`, but `UnifiedConfigManager.createPersistableConfig()` currently preserves `cached_data`, so runtime save semantics conflict with the migration output.
* Electron official docs define `userData` as the conventional location for app configuration files, but warn that large files should not be written there because some environments may back it up to cloud storage. Electron also exposes `sessionData`, `temp`, `logs`, and `safeStorage` for browser/session data, temporary files, logs, and local encryption respectively.

## Research Notes

### Current Repo Constraints

* `loadConfig()` and `getLegacyConfig()` are effectively front-end contracts today. Renderer code, route pages, data overview, logs, custom CLI, settings, and backup flows rely on hydrated config objects.
* Route analytics request logs are already memory-only with a 1000-item cap; route analytics buckets, route stats, route health, CLI probe latest/history are persisted in `config.json.routing`.
* Backup UI and WebDAV UI assume a single backup file name and single restore target today.
* Existing tests explicitly assert current `cached_data` persistence in `config.json`; these tests will need deliberate contract replacement rather than small assertion updates.
* True external CLI config files under `~/.claude`, `~/.codex`, and `~/.gemini` are user/tool-owned files; app internal storage should not treat them as part of normal app backup unless explicitly requested.
* Local inspection shows the highest disk consumers are browser/session/cache directories, not JSON. After user clarification, these browser-related files are protected operational state for multi-account site management; this task may classify them and exclude them from default backup, but must not clean, migrate, compress, or relocate them.
* Local inspection also proves route probe/model registry runtime data materially bloats `config.json`; route runtime cannot remain in stable config if the goal is clean local storage.
* After user clarification, browser/session/profile data must be treated as protected operational state for this task. The design may classify and exclude it from backup, but implementation must not mutate it.
* Current backup implementation copies `config.json` on every `saveConfig()` and retains the latest 10 by filename prefix. It has no trigger classification, no minimum interval, no content hash dedupe, and no size-aware behavior. This is unsuitable while `config.json` is large and `saveConfig()` is used by runtime routes.

### Backup Trigger Policy Options

**Option A: Stable Config Auto Backup + Throttle**

* How it works: stable config changes trigger auto backup; runtime/cache/statistics writes never trigger backup; auto backups are throttled by minimum interval and skipped when the stable config content hash has not changed.
* Pros: preserves automatic safety net for user-visible config edits.
* Cons: still creates backups during active configuration editing, though bounded by throttle/dedupe.

**Option B: Manual + Safety-Point Backup Only**

* How it works: normal saves never auto-backup; backups happen only on manual backup, migration-before, restore-before, and import-before.
* Pros: lowest disk churn and easiest mental model.
* Cons: user may lose recent config edits if they never manually back up and no migration/restore/import occurred.

**Option C: Tiered Backup Policy (Recommended)**

* How it works: manual/迁移前/恢复前/导入前生成 full manifest bundle；稳定配置变更只生成 throttled lightweight config snapshot；runtime/cache/statistics writes never trigger backup; browser operational state is classified but excluded by default.
* Pros: separates high-risk operations from normal edits, preserves recovery points without backing up noisy state, and matches the manifest-based storage split.
* Cons: implementation is slightly broader because backup metadata must record bundle type, source event, content hash, and included files.
* Decision: selected by user.

### Proposed Storage Manifest

Internal app data should be described by a single manifest/helper rather than scattered string paths:

* Stable config: `${userData}/config/config.json` or keep `${userData}/config.json` for compatibility, but content must be stable only.
* Settings: `${userData}/settings/theme.json`, `close-behavior.json`, `update.json`, `webdav.json` if moved out of `config.settings`.
* Runtime detection cache: `${userData}/state/runtime-cache.json`.
* Route runtime: `${userData}/state/route-runtime.json` for `stats`, `routePathStates`, `health`.
* Route probes: `${userData}/state/route-probes.json` for `latest` and `history`.
* Route analytics: `${userData}/state/route-analytics.json` for durable buckets; request logs remain memory-only unless a file-backed log is explicitly required.
* Secrets: `${userData}/secrets/secrets.json` with values encrypted via Electron `safeStorage` when available; fall back to redacted/explicit warning behavior if not available.
* Logs: use `app.getPath('logs')` or `${userData}/logs`, with retention policy.
* Electron/Chromium session data: classified as browser operational state; excluded from default backup and not mutated in this task.
* Persistent browser profiles: classified as protected browser operational state; excluded from default backup and not mutated in this task.
* Temp work: non-browser temp work may be cleaned by owner in future; Chrome temp profiles are classified as browser operational state and not mutated in this task.
* Update downloads: `${localAppData}/api-hub-management-tools-updater/*` or `${temp}` with post-install/TTL cleanup.
* Backups: bundle format under existing backup directory or `${userData}/backups`, with manifest version, checksums, and included files list.

### Feasible Approaches

**Approach A: Clean Storage + Compatibility Facade (Recommended)**

* How it works: internal files become clean and manifest-driven; main process assembles a hydrated read model for existing renderer `loadConfig()` callers during transition.
* Pros: lowest UI breakage risk, allows storage cleanup and migration first, front-end can be migrated incrementally to explicit cache APIs.
* Cons: compatibility view can hide accidental new dependencies if not tested; requires clear naming such as `loadConfigView()` vs `loadStableConfig()`.
* Decision: selected by user.

**Approach B: Strict API Boundary Now**

* How it works: `loadConfig()` returns stable config only; all runtime/cache/analytics data move behind explicit IPC APIs; renderer components are updated immediately.
* Pros: cleanest contract, fewer compatibility traps, easier future maintenance.
* Cons: broad front-end blast radius, many tests need rewrite at once, higher regression risk.

**Approach C: Minimal Runtime Split**

* How it works: fix `createPersistableConfig()` and restore flow first, keep most route runtime inside config for now, move other files later.
* Pros: smallest initial patch.
* Cons: does not solve route config bloat, backup churn, or full manifest cleanliness; likely causes another migration soon.

## Decision (ADR-lite)

**Context**: The existing renderer has many `loadConfig()` and `cached_data` consumers, while the storage layer needs a clean split between stable config and runtime/cache/log state.

**Decision**: Use Approach A, "Clean Storage + Compatibility Facade".

**Consequences**:

* Internal persisted files must follow the new storage manifest and avoid duplicate runtime data in `config.json`.
* Existing renderer flows can continue through a compatibility read model during the first implementation wave.
* New or touched front-end code should use explicit IPC/read models for runtime cache, route analytics, logs, and backup metadata.
* Tests must protect both sides: stable files stay clean on disk, and compatibility views still provide the data current UI needs until migrated.
* Business behavior must remain stable: changes should be observable as different files on disk, not as different user workflows or routing/detection semantics.

### Decision: Browser Operational State Is Protected

**Context**: Local inspection shows browser/session/profile directories are the largest disk consumers, but the user clarified these files are required for site multi-account management.

**Decision**: Browser-related files are out of mutation scope for this task. Do not migrate, delete, clean, compress, relocate, or re-key them. The storage manifest may classify them and backup defaults may exclude them.

**Consequences**:

* Disk-size improvements in this task come from config/runtime/cache/log/backup structure, not browser profile cleanup.
* Backup/diagnostic UI must label browser operational state separately so it is not confused with app runtime cache.
* Any future browser-profile cleanup or selective backup must be a separate task with explicit account/profile ownership rules.

### Decision: Sensitive Storage Deferred

**Context**: `custom-cli-configs.json` contains API keys and `credit-settings.json` contains cookies/cached info, but the user selected the conservative option to avoid changing sensitive storage in this iteration.

**Decision**: Do not migrate, encrypt, split, or reformat cookies/API keys in this task. Only prevent new logs from exposing sensitive values.

**Consequences**:

* Existing sensitive file locations remain stable for compatibility.
* Backup manifest must treat these files deliberately, but encryption/keychain work is out of scope.
* Log redaction and related tests are out of scope by explicit user decision.

## Expansion Sweep

### Future Evolution

* A manifest-based storage layer can later support import/export, selective backup, diagnostics bundle, and “reset cache only” without touching stable config.
* A secrets abstraction can later move from safeStorage-encrypted JSON to OS keychain/keytar without changing renderer contracts.

### Related Scenarios

* Local backup, WebDAV backup, migration script, startup migration, and restore must use the same manifest and validation logic.
* Site/account deletion must clean related state files: detection cache, route runtime, probes, analytics, and optionally browser profiles.

### Failure / Edge Cases

* Migration must be idempotent: running it twice should not duplicate accounts, caches, or backups.
* Restore must be transactional enough to avoid mixed old/new files; if bundle restore partially fails, original files remain recoverable.
* Corrupted JSON should be quarantined under one diagnostic directory with retention, not scattered in userData root.

## Implementation Plan

### Phase 1: Storage Contracts and Safety Net

* Add a shared storage manifest that defines every app-owned local file: stable config, runtime cache, route runtime, route probes, route analytics, backups, logs, settings, protected browser operational state, and out-of-scope sensitive files.
* Add or centralize atomic JSON read/write helpers used by config, runtime cache, route state, migration, and backup code.
* Define retention/cap contracts for state files before moving data: CLI probe history, analytics buckets, route runtime, runtime detection cache, daily snapshots, diagnostics/quarantine.
* Add equivalence fixtures from current local config shape and v2.1.24 shape so compatibility views can be tested before storage writers change.

### Phase 2: Clean Stable Config + Compatibility Facade

* Refactor persisted `config.json` so it stores stable user intent only: sites/accounts without runtime `cached_data`, routing config without runtime stats/history/buckets, settings, groups, and stable model routing config.
* Keep existing renderer-facing read behavior through a compatibility facade, so existing `loadConfig()`/`getLegacyConfig()` consumers still receive required cached/runtime fields assembled from state files.
* Ensure new/touched code uses explicit stable-config vs runtime-state APIs rather than depending on legacy hydrated config.
* Verify business behavior equivalence for site list, account list, data overview, route pages, and logs pages.

### Phase 3: Runtime/Route State Split

* Move detection cached data to runtime cache/state with one owner and no double-write back into stable config.
* Move route stats, route path state, route health, CLI probe latest/history, analytics buckets, and model registry runtime/source snapshots out of `config.json`.
* Apply retention/cap/compaction on each state file so high-frequency route/probe/analytics writes cannot become unbounded append-only JSON growth.
* Keep route request logs memory-only unless a separate explicit file-backed log requirement is added.

### Phase 4: Backup, Restore, and WebDAV Bundle

* Replace config-only backup semantics with manifest-based backups.
* Implement selected tiered backup policy: manual/migration-before/restore-before/import-before produce full manifest bundle; stable config edits produce throttled + hash-deduped lightweight config snapshot; runtime/cache/statistics writes never trigger backup.
* Exclude browser operational state from default backups and do not mutate browser files.
* Make restore transactional enough to avoid mixed old/new files; restore must not allow old runtime cache to re-pollute restored stable config.
* Update backup/WebDAV IPC and UI read models to handle backup type, manifest version, included files, and restore status.

### Phase 5: v2.1.24 Migration Script and Startup Migration

* Rework `scripts/migrate-config-v224-to-v301.cjs` or replace it with a shared migration module used by both CLI script and runtime startup migration.
* Preserve current support for `--path` and `--dry-run`.
* Add backups before migration, backup existing runtime/state files, and make migration idempotent.
* Migrate v2.1.24 sites/accounts/caches/routing into the new stable config + state files without duplicating cached/runtime payload.
* Add migration fixtures/tests for v2.1.24, current bloated config, already-migrated config, corrupted JSON, and partial state-file presence.

### Phase 6: Cross-Layer Verification and Docs

* Update renderer IPC contracts only where needed; avoid user-visible workflow changes.
* Run focused unit/integration tests for migration, config manager, runtime cache/state managers, backup/WebDAV, and renderer compatibility read models.
* Add size/growth regression tests or simulations for high-frequency detection/probe/route/analytics writes.
* Update `PROJECT_INDEX.md`, relevant `FOLDER_INDEX.md`, and storage/migration docs for any added modules.

## Implementation Guardrails

* No browser file mutation: no migration, deletion, cleanup, compression, or path changes for browser profiles/cache/temp Chrome data.
* No sensitive-storage work: no cookie/API key encryption, migration, or log redaction in this task.
* No business behavior drift: observable changes should be disk layout, backup semantics, and migration safety, not user workflows or routing/detection results.
* No blind writer refactor: before changing a reader/writer, add or update an equivalence test for the affected business read model.
* No unbounded JSON: every new state/cache/statistics file must have owner, source, rebuildability, retention/cap, dedupe key, and prune/compaction test coverage.

## Proposed PR Split

* PR1: storage manifest + atomic JSON helper + retention contracts + baseline fixtures/tests.
* PR2: stable config cleanup + compatibility facade + runtime cache double-write removal.
* PR3: route runtime/probe/analytics/model-source split + caps/compaction.
* PR4: manifest backup/restore + WebDAV bundle + tiered backup trigger policy.
* PR5: v2.1.24/current migration script + startup migration + migration fixtures.
* PR6: renderer/API compatibility cleanup + docs/index updates + final regression pass.
