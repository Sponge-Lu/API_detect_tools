/**
 * 输入: 无（纯类型与常量）
 * 输出: DSH（DeepSeek Harness）会话级路由接入相关的状态、漂移原因、请求/结果类型
 * 定位: 类型层 - 主进程 dsh-integration-service 与渲染进程接入卡片共享的类型边界
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/types/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * DSH 侧的常量。这三个值是 DSH 安装包内部定义的，**与用户环境无关**，因此必须硬编码。
 *
 * - `DSH_PATCH_ENTRY_ID`：`@deepseek-ai/dsh-base/cordis.patch.yml` 里已存在的条目 id。
 *   patch 层按 id 合并，写成包名 `dsh-llm-deepseek-api-key` 会新增一条指向同一插件的条目，
 *   导致 `deepseek-official` 重复注册，且 settings 命名空间错位。
 * - `DSH_NATIVE_PROVIDER_ID`：`dsh-llm-deepseek-api-key` 源码里的 `PROVIDER` 常量。
 * - `DSH_LEGACY_PROVIDER_ID`：`llm-pi-ai` 下 anthropic-messages 通道的 provider id，
 *   该通道的 compat gate 会 withhold `sendSessionAffinityHeaders`，永远不发会话头。
 */
export const DSH_PATCH_ENTRY_ID = 'llm-deepseek';
export const DSH_PATCH_ENTRY_NAME = '@deepseek-ai/dsh-llm-deepseek-api-key';
export const DSH_NATIVE_PROVIDER_ID = 'deepseek-official';
export const DSH_LEGACY_PROVIDER_ID = 'local';
export const DSH_AGENT_DEFAULT_MODEL_ENTRY_ID = 'agent-default-model';
export const DSH_SUBAGENT_MODEL_ENTRY_ID = 'subagent-model-selection-settings';

/**
 * 写入 DSH 凭据库（`~/.dsh/.credentials.yaml` 的 `refs`）时使用的引用名。
 * DSH 要求 refs 的 key 是 POSIX 标识符，因此只能是字母/数字/下划线且不以数字开头。
 */
export const DSH_ROUTE_CREDENTIAL_REF = 'API_DETECT_ROUTE_KEY';

/** 状态漂移原因。`ok` 是唯一表示"无需处理"的取值。 */
export const DSH_DRIFT_REASONS = [
  'ok',
  'dsh-not-installed',
  'profile-not-initialized',
  'patch-file-missing',
  'patch-file-invalid',
  'patch-entry-missing',
  'patch-entry-wrong-base-url',
  'patch-entry-wrong-credential-ref',
  'patch-entry-no-models',
  'credential-ref-missing',
  'credential-ref-mismatch',
  'default-model-not-native',
  'models-out-of-sync',
  /** 应用里还没有任何可用模型来源（没加站点 / 没刷新模型） */
  'no-model-source',
] as const;

export type DshDriftReason = (typeof DSH_DRIFT_REASONS)[number];

/**
 * 可供 DSH 选择的一组模型，对应应用里的一个"配置目标"：
 * 本地路由（所有站点聚合）、某个站点的某个账户、或某个直连配置。
 */
export interface DshModelSource {
  /** 与 `ConfigFileTargetCatalogEntry.value` 一致，例如 `local-route` / `managed:site:account` */
  id: string;
  label: string;
  kind: 'local-route' | 'managed' | 'direct';
  models: string[];
}

export interface DshRoutingStatus {
  /** DSH 是否已安装（找到应用目录或 profile 目录） */
  installed: boolean;
  /** DSH 的 home 目录，例如 `~/.dsh` */
  dshHome: string | null;
  /** profile 目录，例如 `~/.dsh/profiles/desktop` */
  profileDir: string | null;
  /** `cordis.patch.yml` 路径 */
  patchFilePath: string | null;
  /** `.credentials.yaml` 路径 */
  credentialsFilePath: string | null;
  /** DSH 进程是否在运行（仅影响存量会话迁移） */
  running: boolean;
  /** 是否已经正确接入（等价于 drift 只含 'ok'） */
  configured: boolean;
  drift: DshDriftReason[];
  /** patch 里当前配置的 baseURL */
  currentBaseUrl: string | null;
  /** 本应用期望的 baseURL（由路由服务端配置派生） */
  expectedBaseUrl: string;
  /** patch 里声明的模型数量 */
  configuredModelCount: number;
  /** 本应用模型目录里有、但 patch 里没有的模型 */
  missingModels: string[];
  /** patch 里有、但本应用模型目录里没有的模型 */
  staleModels: string[];
  /** 仍钉在 legacy provider 上的会话数 */
  sessionsOnLegacyProvider: number;
  /** 扫描到的会话总数 */
  sessionsTotal: number;
  /** 改了配置之后是否必须重启 DSH 才生效 */
  restartRequired: boolean;
  /** 可供选择模型来源（供应商）列表；为空表示应用里还没加站点 */
  modelSources: DshModelSource[];
  /** 当前 DSH 配置里的模型集合能对上哪个来源；对不上为 null */
  matchedModelSourceId: string | null;
  /** 供 UI 直接展示的一句话说明 */
  summary: string;
}

export interface EnableDshSessionRoutingInput {
  /** 默认模型；不在模型目录里则回退到第一个可用模型 */
  defaultModel?: string | null;
  /** 子 agent 白名单；不传则取模型目录前 4 个 */
  allowedModels?: string[] | null;
  /** 用哪个来源的模型；不传则沿用当前匹配到的来源，否则用 local-route */
  modelSourceId?: string | null;
  /** 是否顺带迁移存量会话（DSH 必须已退出） */
  migrateSessions?: boolean;
}

export interface DshSessionMigrationResult {
  scannedFiles: number;
  changedFiles: number;
  changedRefs: number;
  /** 备份目录；没有改动时为 null */
  backupDir: string | null;
}

export interface EnableDshSessionRoutingResult {
  ok: boolean;
  /** 被写入的文件（绝对路径） */
  changedFiles: string[];
  /** 备份文件（绝对路径） */
  backupPaths: string[];
  /** 实际写入 patch 的模型 id 列表 */
  models: string[];
  /** 这次用的模型来源 */
  modelSourceId: string;
  defaultModel: string;
  allowedModels: string[];
  sessionMigration: DshSessionMigrationResult | null;
  restartRequired: boolean;
  status: DshRoutingStatus;
}

export interface DshRollbackResult {
  ok: boolean;
  restoredFiles: string[];
  /** 因内容已被外部改动而跳过还原的文件 */
  skippedFiles: string[];
  status: DshRoutingStatus;
}

/**
 * IPC 统一返回形状：Electron 只透传异常的 message，
 * 所以主进程把失败收敛成 `{ ok: false, error }`，调用方不必 try/catch。
 */
export interface DshActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
