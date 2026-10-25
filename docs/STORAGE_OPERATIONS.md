# SQLite 运行、迁移与恢复

## 启动与数据切换

1. Electron 获取单实例锁，在创建窗口前打开 userData/storage/app.db；foreign_keys=ON、journal_mode=WAL、synchronous=FULL、busy timeout 默认 1000ms。
2. 无 migration_complete 时读取已知旧文件，纯转换各版本，保存精确原始字节及存在性/SHA-256 清单到 storage/migration-backups/<UUID>，再次检查来源未变化。
3. 在一个事务中导入全部文档与完成标记；失败没有半份数据。新用户创建默认数据库，不创建 config.json。旧文件不会被删除或覆盖。
4. 有完成标记后只读数据库；完成标记存在而核心配置缺失时拒绝启动。恢复未决 CLI journal，重建内存配置，组装服务、IPC 和窗口。
5. 退出先停代理，再拒绝新存储活动、等待已接收操作、flush，最后关闭数据库。维护/退出等待上限 30 秒，失败写明确日志。

## 修改契约

- 查询 load-config 返回 storageVersion。preload 保存原始已发出的快照（有上限），比较 UI 草稿后发送 config:commands 的按 ID patch/group/order/settings 命令；服务端严格校验字段并在队列内部检查版本。
- custom-cli-config:commands 使用独立 scope；route 稳定命令经统一 IPC 版本守卫。卡片采用原有逐卡 revision 和预览文件指纹；恢复时卡片 revision 单调递增，旧卡片草稿不能应用。
- 旧 save-config 和 custom-cli-config:save 在数据库模式明确拒绝。兼容 facade 只供主进程业务协调，不能重新通过 preload 暴露整表覆盖。
- Electron contextBridge 不会把主进程对参数的修改带回 Renderer，也不会保留 Error 自定义属性。保存返回 canonicalConfig，Renderer 在成功后接收服务端 ID/版本；失败保留草稿，按错误消息/结构化结果提示。错误代码不能假定穿过 rejected IPC 后仍在 Error.code 上。

| 错误/状态 | 含义与处理 |
|---|---|
| CONFLICT | generation/scope/revision 过期；重新查询并人工合并草稿，不自动重试旧整表 |
| LEGACY_WRITE_DISABLED | 旧全量写入口或未携带版本的路由命令被拒绝 |
| RESTORE_IN_PROGRESS | 维护期间新操作被拒绝，原已接收活动等待完成 |
| RECOVERY_REQUIRED / committed=true | 恢复已经提交但服务投影重建失败；阻止后续业务，重启读取新库 |
| CLI recovery-required | 文件已被第三方改写，保留第三方内容与 journal，人工核对后再恢复应用数据 |
| schema/密文/关系/校验失败 | 保留原数据与诊断，不自动建空库、不退回旧 JSON |

## 备份兼容与恢复范围

当前输出 bundle version=2，接受 version=1 与已知 legacy config-only；同时记录 includeSecrets 与 databaseSchemaVersion。版本未知、格式错误、大小/哈希不符在 live DB 维护之前拒绝；输入上限 128MiB。

| 输入 | 稳定配置 | custom CLI / profiles 缺失 | 运行态缺失 | 其他文件 |
|---|---|---|---|---|
| portable-config | 替换所含稳定域 | 保留；显式空集合清空 | 保留 | 不动 |
| full-manifest | 替换所含稳定域 | 保留；显式空集合清空 | detection/runtime/analytics/model sources/endpoint/activity/bindings 按清单重置 | affinity 与缺失偏好保留；CLI/Profile/日志不动 |
| legacy config-only | 纯版本适配后替换 | 保留 | 保留 | 不动 |

- 导出先 flush，再在同步读事务中形成一致逻辑快照；不等待无关长网络请求。上传在快照生成后进行，不占恢复屏障。
- includeSecrets=true 的文档正文加密封装；false 清掉已知凭证、代理用户名密码及模板/正文/headers/env/editedFiles 等自由文本，卡片标记 requiresConfiguration，补全前拒绝应用。
- 恢复先预检并在独立候选库验证关系；随后维护屏障等待已接收活动，在线备份旧库，单事务修改选定域、revisions 和 operationId，切换 generation。
- 提交后清理/重载配置、缓存、registry、stats、analytics、session、affinity、卡片、偏好；代理按恢复配置重启，浏览器只经既有安全路径重绑一次。成功后只广播一次恢复事件；失败不冒充恢复成功。
- SQLite online backup 生成临时快照并执行 integrity_check，校验成功后原子改名。禁止 fs.copyFile 活跃 app.db，也禁止只复制 DB 而漏掉仍有效的 WAL。

## 外部 CLI 文件

预览不写文件；提交复核卡片 revision、内容 hash/mtime、目标路径和 DSH 签名。先持久化 prepared journal（原内容/存在性/候选哈希），再原子写第三方文件；元数据与 committed 标记一起提交。启动恢复只回滚仍匹配本次候选的文件，第三方后续改写不覆盖。文件 I/O 不处于长 SQL 写事务内。

## 数据库损坏或需要回退

1. 退出所有应用进程；不要删库，也不要靠旧 JSON 覆盖新数据。保留 storage 目录（含 DB/WAL/SHM）、诊断日志、迁移原始备份和恢复快照的副本。
2. 正常可打开数据库时优先应用内逻辑恢复。若无法打开，应在独立目录使用同一 Electron/驱动对选定完整快照做 readonly integrity_check、application_id/schema 校验和校验，再以隔离 userData 启动验证。
3. 只在全部连接关闭并保全当前 DB/WAL/SHM 后，人工更换验证通过的完整快照；旧 WAL/SHM 不得与另一个快照配对。重新启动核对 ID、账户、路由、卡片和统计。
4. 回退到旧版应用会读取旧 JSON 而非数据库最新状态。因此不提供自动降级：必须先在隔离目录验证一个旧版支持的含密钥逻辑导出及版本转换；不能把 untouched 旧 JSON 宣称为最新备份。

本轮没有自动物理替换损坏数据库的工具。原始迁移/升级/恢复失败证据不自动删除，需按实际保留需求人工归档。

## 版本、验证与限制

better-sqlite3=11.10.0、类型=7.6.13；Electron=28.3.3，内置 Node=18.18.2，ABI=119，SQLite=3.49.2。宿主 Node24 不加载 Electron ABI 原生模块；npm run test:storage 使用 Electron Node 模式。Windows 可运行 npm run prepare:sqlite 准备精确预编译模块；build/dev 先探测实际 ABI。preload 使用 esbuild 0.21.5 打成一个外置 electron 的 CJS，供 Electron sandbox 加载。

Windows x64 实际 ASAR/窗口/preload/IPC 已验收；macOS/Linux/其他架构未实机验证。打包冒烟不携带大体积 Chromium，不代替真实站点登录测试。进程强制退出测试不等同真实硬件断电。统计合并窗口保持：analytics 30 秒、channel stats 3 秒、activity/bindings 250ms；退出/备份/恢复显式 flush。

既有 encrypted:v1 使用固定应用密钥，不保证对已能运行应用代码的攻击者保密。新文件保护不追溯擦除旧 JSON 原始备份、旧日志和第三方文件。无密钥导出按已知敏感字段/自由文本域处理，不承诺识别任意未知业务字符串中的秘密。
