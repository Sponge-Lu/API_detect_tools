# 架构与数据管理重构实施验收

planVersion: 2
日期：2026-10-24
状态：T00–T15 已实施，Windows x64 的功能/构建/实际 ASAR 产品门禁通过。未验证平台和既有安全限制单列，不推定跨平台发布通过。

## 交付与工作区

- 已删除 docs/DEEPSEEK_REFACTOR_HANDOFF.md；没有保留 DeepSeek 执行提示词。
- 直接在当前 worktree 实施。基线 HEAD=ef24227635c11a94dee0a12c0b9f65cd34f219eb；原始 104 条状态记录及 index diff 保存在 .cache/architecture-refactor-tests/baseline-*。
- 最终逐字比较 git diff --cached --binary 与基线一致；未暂存、提交、推送、reset 或创建 PR。原有 UI/样式与 staged 修改保留。
- 已有 package-lock 依赖版本变化数=0；新增 better-sqlite3 11.10.0、@types/better-sqlite3 7.6.13，构建直接声明既有 esbuild 0.21.5。未升级 Electron/React/Zustand/Vitest。
- 新 STORAGE_SCHEMA.md、STORAGE_OPERATIONS.md 和本记录受仓库现有 docs 忽略规则影响，文件已在本地，未 force-add、未改忽略策略。ARCHITECTURE/API_REFERENCE/DEVELOPMENT 与模块索引已更新。

## T00–T15 实施签核

| 任务 | 实施结果与证据 |
|---|---|
| T00 基线/存储清单 | 基线 index/状态、storage-io-inventory.txt、all-storage-writers.txt；迁移文档路径与数据库表映射明确。额外发现 ChromeManager 的配置直读后已改走数据库桥接。AppStorageManifest 登记 DB、逻辑文档及保留文件。 |
| T01 驱动与打包 | 固定驱动/类型；prepare-native 探测实际 Electron ABI，Windows 官方精确预编译准备脚本；驱动与完整产品实际 ASAR 均通过。sandbox preload 单文件构建修复实际打包 require 失败。 |
| T02 字段映射/DDL | schema 1–3、实体/关联/顺序/偏好叶子/未知扩展映射完整；见 STORAGE_SCHEMA.md。高频集合按实体分行，没有整份应用配置 blob。 |
| T03 存储基础 | application_id、迁移校验和/未来版本拒绝、FK/WAL/FULL、同步事务、升级前在线快照、密文载荷、scope/generation、维护和退出 drain。真实 DB/WAL/重启/进程中断测试。 |
| T04 命令与修改 | app/custom CLI 按 ID 命令与字段白名单，路由稳定命令版本守卫；facade 串行草稿/提交后发布。逐卡 revision 和文件指纹。卡片删除与会话/亲和行清理统一事务；实际触发器失败验证回滚。 |
| T05 一次性迁移 | 纯旧版本适配、原始字节+存在性+SHA-256 备份、输入二次核对、数据+完成标记单事务；完成后不重读旧 JSON，不损坏回退。首次导入中断和提交后重启分别验证。 |
| T06 Renderer 边界 | ElectronAPI/Config 类型移出 App；preload 将旧表单保存转换为版本化命令，返回 canonicalConfig/ID；Renderer 成功后接收，失败保留草稿。实际 contextBridge 验证旧快照冲突和连续 canonical 保存。 |
| T07 运行态/统计 | 缓存、统计、来源、session/affinity 与稳定域分离；脏分析桶 SQL upsert、索引范围查询、TTL/50000 上限；stats/analytics 批次串行、失败保留绝对计数、新事件不漏/不重复。失败重叠请求回归通过。 |
| T08 一致备份 | bundle v2 加密正文、v1/legacy 输入兼容、includeSecrets/DB version 元数据；flush+同步读事务生成逻辑快照，上传不持维护许可；不复制活 DB。 |
| T09 恢复 | 格式/大小/hash/版本/候选关系先验；维护 drain、在线恢复前快照、选定域+revisions+operationId 单事务；第 N 表失败、提交前后进程退出、提交后重建失败分别测试。 |
| T10 缓存/后台任务 | generation 检查旧回调；重载全部存储投影、请求/端点/CLI 检测缓存，重启代理监听，浏览器既有路径重绑一次；Renderer epoch/序号、卡片预览响应失效。成功后单次恢复事件。 |
| T11 外部 CLI | 模板/目标/内容/会话解析分离；预览、revision、文件 hash/mtime、DSH 签名重检；prepared journal → 原子文件写 → metadata+committed。重启回滚原始字节，保留第三方改写。新备份正文加密，旧备份兼容。 |
| T12 联合验收 | 实际产品迁移→IPC 编辑/冲突/失败回滚→含/不含密钥导出→恢复→重启；三协议本地假上游和假 CLI 文件应用；原始输入字节保持。DB/WAL/快照假秘密检查通过。 |
| T13 Main 职责 | config 实体/defaults/旧协议；auth 按 authentication/checkin/api-keys/detection；clients 按 content/templates/targets/session parser，复用 DSH 与 journal；browser-runtime 按 slot/path/page-auth；路由沿用既有 request-context/forwarder/rule-engine/usage，避免复制。 |
| T14 Renderer 职责 | App 生命周期/刷新 Hook；Sites/ModelRedirection 控制 Hook + 展示；overview 纯 metrics/charts/两类视图；profile 预览/规则编辑/DSH 控件边界。原布局、保活、分组/筛选/History/会话行为回归通过。 |
| T15 门禁/交接 | 进程/模块依赖自动检查、旧全量持久化入口检查、全量测试、真实 DB、构建、ASAR、新用户/升级/恢复/重启；23 个相关模块索引与项目导航、schema/运维/兼容/错误/回退文档已更新。 |

## 最终验证命令与结果

| 命令 | 退出码 / 实际结果 | 本地证据 |
|---|---|---|
| main tsc --noEmit --incremental false | 0 | 最终打包前显式执行，build:main 再执行 |
| renderer tsc --noEmit --incremental false | 0 | 显式执行，build:renderer 再执行 |
| npm test | 0；116 文件、2125 测试通过 | .cache/architecture-refactor-tests/full-suite-release.log |
| npm run test:storage | 0；27 真实 Electron/SQLite 测试通过 | .cache/architecture-refactor-tests/storage-release.log |
| npm run lint | 0；0 错误、1415 警告 | .cache/architecture-refactor-tests/lint-release.log |
| npm run build | 0；包含于产品打包验证 | .cache/architecture-refactor-tests/product-release.log |
| npm run verify:storage:product | 0；3 次实际 EXE 启动通过 | 同上；packaged-product-1792847479446 |
| git diff --check | 0 | 仅 LF/CRLF 提示，无 whitespace 错误 |
| index 与基线比较 | 完全一致 | baseline-index.diff 与最终 git diff --cached --binary |
| 已有 lock 版本比较 | 变化 0 | index 中 package-lock 与当前 package-lock 比较 |

Lint 未执行整个仓库自动修复，避免改写另一批 UI 工作。警告含原有 any/Hook 依赖等，也包含移动/新增边界的兼容类型；不把 1415 条全部称作历史既存，更不宣称零警告。

实际产物：.cache/architecture-refactor-tests/packaged-product-1792847479446/out/win-unpacked/StorageProductSmoke.exe。使用真实 dist/main、dist-renderer、sandbox preload、contextBridge 与 IPC；仅测试入口及假环境被替换。三阶段报告分别确认升级后 sites=3、重启后 sites=3、新用户 sites=0；旧 config.json 字节不变，interrupted-client 重启后还原 original-client。

## A01–A34 验收对应

此表列源码边界与实际自动测试/产品验证，不代表 34 份独立人工操作录像。

| 编号 | 结果/证据 |
|---|---|
| A01 | 产品旧 UI 快照保存遭冲突，后续新增记录保留；canonical 新 ID 连续保存通过。 |
| A02 | 同名不同 ID 两个站点，编辑只影响目标；仓储与产品验证。 |
| A03 | 实际 SQL 触发器中途失败，行/revision/稳定内存不发布；数据库事务测试。 |
| A04 | 检测缓存、来源刷新不推进 app revision，稳定写入不覆盖独立 runtime 行；产品与映射往返。 |
| A05 | 数据库模式旧 full-save 明确拒绝；preload 架构门禁禁止发旧通道，产品表单仅走 commands。 |
| A06 | load-config 查询只读当前投影；路由列表按副本规范化；普通刷新不重新迁移/恢复。 |
| A07 | 未来 schema/数据版本、损坏必要输入/密文、外来 DB 拒绝；基础/迁移集成测试。 |
| A08 | 恢复后续表失败时全部旧行和 revisions 保留。 |
| A09 | 子进程在恢复事务提交前/后退出，重启分别为完整旧/完整新数据。 |
| A10 | 恢复 drain 已接收任务，新任务拒绝，旧 generation 延迟回调写回拒绝。 |
| A11 | Main 统一重载，Renderer Store/查询序号与卡片预览/响应失效；相关 UI 回归与产品恢复。 |
| A12 | v1/legacy 缺失可选域保留；显式空集合清空；bundle/真实文档测试。 |
| A13 | full 缺失运行态按清单重置，affinity/缺失偏好/CLI/浏览器不删；bundle 恢复测试。 |
| A14 | 旧版本迁移后重启 ID 不变，无重复实体；产品连续启动与集成测试。 |
| A15 | 无密钥包移除已知秘密及自由模板正文，requiresConfiguration 经规范化保留且阻止应用。 |
| A16 | 含密钥正文封装加密，恢复可使用；旧密文先解后入库，不二次嵌套。 |
| A17 | runtime/cache/model sources 与 app revision 分离；50k 历史单桶 SQL 只改变 2 行。 |
| A18 | IPC 冲突与失败可见，表单失败保留；epoch/序号/预览 generation 屏蔽旧响应。 |
| A19 | 三协议产品本地 HTTP 请求及原有取消/SSE/熔断/故障转移/会话/pin/双认证/DSH 单测通过。 |
| A20 | 所有产品 home/userData/temp/CLI 假环境在项目缓存；index 逐字不变。 |
| A21 | 直连按 ID 命令、卡片 revision/串行队列；profile 删除 SQL 失败回滚/成功不删实际 CLI 文件。 |
| A22 | flush 后同步读事务形成一致文档；快照不等待无关网络活动；上传在快照许可之外。 |
| A23 | Electron28/ABI119 的 ASAR 原生驱动加载、写入、重启、备份通过。 |
| A24 | 实际 FK、默认账户归属触发器、级联/受限规则删除与历史统计保留测试。 |
| A25 | 升级前在线快照、升级失败回滚、未来 schema/校验和拒绝；底层进程中断测试。 |
| A26 | 首次导入中途及完成标记提交后强制退出，重启无半份数据/重复 ID，原始输入不变。 |
| A27 | 标记存在后故意损坏旧 JSON 仍读新库；核心数据缺失/DB 错误不回退旧文件。 |
| A28 | 新加密载荷在 DB/WAL/在线快照无假秘密明文字节；CLI 新备份正文受保护。原始迁移备份保留原字节是明确例外。 |
| A29 | stats 与 analytics 写入失败期间到达新事件，重试计数为两次，空 flush 不重复写。 |
| A30 | 端点身份、加权总计/空桶/时间范围、索引命中与 TTL/50000 上限测试。 |
| A31 | 实际 online backup 与 integrity_check、关闭重开验证；不用 copy 活库。 |
| A32 | 提交已成功但 reload 失败报告 committed/recovery-required，阻止业务；重启读新状态。 |
| A33 | journal 关闭重开回滚，候选之后第三方改写保留；实际卡片预览/提交与重启恢复。 |
| A34 | 实际 Windows ASAR 的新用户、旧数据升级、IPC 编辑、三协议假上游、假 CLI 应用、导出/恢复/重启全部通过。 |

## 性能记录与决策

真实 SQLite 50k 历史桶，单桶更新只改 bucket + last_updated 两行。最后一轮合成样本：首次 50k 导入约 3926ms，单次脏桶约 5.9ms。10 样本 nearest-rank p95 对比：

| JSON 全量桶数 | 全量 JSON 序列化+fsync+改名 p95 | SQLite 脏桶 p95（始终已有50k桶） |
|---|---|---|
| 1000 | 6.25ms | 3.26ms |
| 10000 | 29.09ms | 3.21ms |
| 50000 | 66.92ms | 3.04ms |

原始样本位于 analytics/case-*/benchmark.json。数据仅为本机本次合成样本，不等价于真实负载吞吐、端到端 p95 或跨机结论。冷导入/恢复候选和大型导出仍有同步批量序列化成本；本轮将它们放在启动/明确维护或导出流程，代理请求路径不扫描全历史，未为此引入第二写线程。

## 限制与操作说明

- 验证平台为 Windows x64；macOS/Linux/其他架构未实机打包。ASAR 产品冒烟不携带内置 Chromium，不替代真实账户登录、真实 WebDAV 上传或安装器安装流程。
- 杀进程测试覆盖事务中断，不等于硬件断电认证。保留当前 WAL/FULL 与 bounded drain；损坏 DB 的隔离诊断/人工快照恢复步骤见 STORAGE_OPERATIONS.md，没有自动删除重建路径。
- 仍使用既有固定 encrypted:v1 密钥；不是整库/OS 托管加密。历史日志、第三方文件和原始迁移备份可能含旧明文，不自动擦除。无密钥导出不承诺语义识别未知任意字符串。
- 延迟刷盘窗口未扩大：analytics 30s、stats 3s、activity/bindings 250ms；退出、备份、恢复显式 flush。失败数据继续留在 pending，错误可见。
- npm11 对 .npmrc runtime/target/disturl 有兼容警告，当前构建通过；未来 npm 主版本需重新验证。
- 新驱动、模块、测试和相关文档纳入 v3.1.4。

## 审查修复与 v3.1.4 验证（2026-10-25）

- 模型拉取同步保存版本并保留草稿，恢复前响应失效；配置提交保留并发更新的缓存。
- 代理启停在数据库提交成功后执行；自动备份先节流，再按所需数据域读取快照。
- 全量 117 个测试文件、2139 项测试及 28 项真实 Electron/SQLite 测试通过。
- 主进程/渲染进程类型检查、构建、实际 ASAR 产品迁移/编辑/备份/恢复/重启验证通过；Lint 无错误，仍有警告。
