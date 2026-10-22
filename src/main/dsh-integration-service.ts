/**
 * 输入: ~/.dsh（DSH home）、本应用路由配置（server.host/port、unifiedApiKey、模型目录）
 * 输出: DSH 会话级路由的检测状态、一键接入/回滚、存量会话 provider 迁移
 * 定位: 主进程服务层 - 把 DeepSeek Harness 的 cordis.patch.yml 与本应用路由打通
 *
 * 背景（为什么必须由应用代劳）：
 *   DSH 默认用 `llm-pi-ai` 的 anthropic-messages 通道，该通道的 compat gate 把
 *   `sendSessionAffinityHeaders` / `sessionAffinityFormat` 都设为 withhold，
 *   且对任何出现在 gate 表里的 compat 字段直接抛错，用户无法通过配置打开。
 *   只有 `llm-deepseek` 系适配器（registerDeepSeekProvider）才发送
 *   `x-deepseek-harness-session-id`，因此必须把 provider 切到 `deepseek-official`
 *   并把 baseURL 指向本应用的路由端口。
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseDocument, isMap, isScalar, isSeq, type ParsedNode, type YAMLMap } from 'yaml';
import Logger from './utils/logger';
import {
  readJsonFile,
  writeJsonFileAtomically,
  writeTextFileAtomically,
} from './utils/atomic-json';
import {
  DSH_AGENT_DEFAULT_MODEL_ENTRY_ID,
  DSH_LEGACY_PROVIDER_ID,
  DSH_NATIVE_PROVIDER_ID,
  DSH_PATCH_ENTRY_ID,
  DSH_PATCH_ENTRY_NAME,
  DSH_ROUTE_CREDENTIAL_REF,
  DSH_SUBAGENT_MODEL_ENTRY_ID,
  type DshDriftReason,
  type DshModelSource,
  type DshRollbackResult,
  type DshRoutingStatus,
  type DshSessionMigrationResult,
  type EnableDshSessionRoutingInput,
  type EnableDshSessionRoutingResult,
} from '../shared/types/dsh-integration';
import type { AgentLogoId } from '../shared/types/config-file-profile';

const log = Logger.scope('DshIntegration');

const DEFAULT_SUBAGENT_MODEL_COUNT = 4;
const MANIFEST_FILENAME = '.api-detect-dsh-integration.json';

export interface DshPaths {
  dshHome: string;
  profileDir: string;
  patchFilePath: string;
  credentialsFilePath: string;
  projcacheDir: string;
  manifestPath: string;
}

/**
 * 本应用侧的接入参数。全部从运行时配置派生，绝不硬编码：
 * 端口、密钥、模型目录每个用户都不一样。
 */
export interface DshRouteSource {
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** 承载这把 Key 的配置方案 id；仅用于诊断与后续切换客户端级路由 */
  profileId?: string;
  /** 模型来自哪个来源（供应商） */
  modelSourceId?: string;
}

export interface DshIntegrationOptions {
  /** 覆盖 DSH home，测试用 */
  dshHome?: string;
  /** 覆盖接入参数，测试用；不传则从 unifiedConfigManager 派生 */
  routeSource?: DshRouteSource;
  /** 覆盖可选模型来源列表，测试用；不传则读应用配置目标目录 */
  modelSources?: DshModelSource[];
  /** 覆盖"DSH 是否在运行"的判定，测试用 */
  isRunning?: () => Promise<boolean>;
}

interface IntegrationManifest {
  version: 1;
  enabledAt: string;
  /** 文件绝对路径 -> 写入后的 sha256（用于回滚时判断是否被外部改动） */
  writtenHashes: Record<string, string>;
  /** 文件绝对路径 -> 备份绝对路径 */
  backupPaths: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 路径与运行状态
// ---------------------------------------------------------------------------

export function resolveDshHome(override?: string): string {
  if (override) return path.resolve(override);
  const fromEnv = process.env.DSH_HOME?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), '.dsh');
}

export function resolveDshPaths(dshHome: string): DshPaths {
  const profileDir = path.join(dshHome, 'profiles', 'desktop');
  return {
    dshHome,
    profileDir,
    patchFilePath: path.join(profileDir, 'cordis.patch.yml'),
    credentialsFilePath: path.join(dshHome, '.credentials.yaml'),
    projcacheDir: path.join(dshHome, 'storages', 'session_projcache', 'sessions'),
    manifestPath: path.join(dshHome, MANIFEST_FILENAME),
  };
}

/** DSH 桌面端的安装目录候选（只用于"是否装过"的判断，不参与写入）。 */
function listAppInstallCandidates(): string[] {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [
      path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
      path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'DeepSeek Harness',
        'resources',
        'app.asar'
      ),
    ];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'];
  }
  return [
    '/opt/DeepSeek Harness/resources/app.asar',
    path.join(os.homedir(), '.local', 'share', 'deepseek-harness', 'resources', 'app.asar'),
  ];
}

function detectAppInstalled(): boolean {
  return listAppInstallCandidates().some(candidate => fsSync.existsSync(candidate));
}

/**
 * DSH 是否在运行。Windows 用 tasklist，其它平台用 pgrep。
 * 判定失败一律视为"未运行"，避免因为探测本身报错而阻塞用户。
 */
export async function isDshRunning(): Promise<boolean> {
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const command = process.platform === 'win32' ? 'tasklist' : 'pgrep';
      const args =
        process.platform === 'win32'
          ? ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH']
          : ['-f', 'DeepSeek Harness'];
      execFile(command, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout || ''));
      });
    });
    if (process.platform === 'win32') return /DeepSeek Harness\.exe/i.test(output);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 接入参数派生（用户相关值全部来自运行时配置）
// ---------------------------------------------------------------------------

function normalizeHostForClient(host: string | undefined): string {
  const trimmed = (host || '').trim();
  if (!trimmed || trimmed === '0.0.0.0' || trimmed === '::' || trimmed === '[::]')
    return '127.0.0.1';
  return trimmed;
}

/**
 * 列出所有可作为 DSH 模型来源的"供应商"。
 *
 * 直接复用应用自己的配置目标目录：本地路由（所有站点聚合）+ 每个站点账户 + 每个直连配置。
 * 用户加了几家供应商，这里就有几项；没加过站点时返回空数组。
 */
export async function listDshModelSources(): Promise<DshModelSource[]> {
  const { getConfigFileTargetCatalog } = await import('./config-file-profile-service');
  const catalog = await getConfigFileTargetCatalog();
  const sources = catalog
    .filter(entry => entry.available)
    .map(entry => ({
      id: entry.value,
      label: entry.label,
      kind: entry.kind,
      models: Array.from(
        new Set((entry.allModels || []).map(item => String(item).trim()).filter(Boolean))
      ),
    }))
    .filter(source => source.models.length > 0);
  // 本地路由放最前，它是默认选项
  return sources.sort(
    (a, b) => Number(b.kind === 'local-route') - Number(a.kind === 'local-route')
  );
}

function pickModelSource(
  sources: DshModelSource[],
  preferredId: string | null | undefined
): DshModelSource | null {
  if (sources.length === 0) return null;
  if (preferredId) {
    const hit = sources.find(source => source.id === preferredId);
    if (hit) return hit;
  }
  return sources.find(source => source.kind === 'local-route') ?? sources[0];
}

/**
 * 给配置卡片补 logo。
 *
 * 卡片渲染时 `logoId` 为空会退回 `agentId`（只有内置卡片有）再退回卡片名去猜，
 * 猜不到就显示一个 Bot 图标。自定义卡片（DSH / Workbuddy 这类）没有 builtin，
 * 名字也未必能命中别名，所以创建/复用时要显式写 `agentLogoId`。
 */
async function ensureProfileLogo(profileId: string, logoId: AgentLogoId): Promise<void> {
  try {
    const { loadConfigFileProfiles, upsertConfigFileProfile } = await import(
      './config-file-profile-service'
    );
    const profiles = await loadConfigFileProfiles();
    const profile = profiles.find(item => item.id === profileId);
    if (!profile || profile.agentLogoId === logoId) return;
    await upsertConfigFileProfile({ profile: { ...profile, agentLogoId: logoId } });
  } catch (error) {
    // 补 logo 是锦上添花，失败不该让接入流程中断
    log.warn('补写配置卡片 logo 失败', error);
  }
}

/** 只读取现有 DSH 方案的路由 Key，不创建任何东西。 */ async function readDshRouteCredential(): Promise<{
  profileId: string;
  apiKey: string;
} | null> {
  const { loadConfigFileProfiles } = await import('./config-file-profile-service');
  const profiles = await loadConfigFileProfiles();
  const existing = profiles.find(
    profile =>
      profile.target?.kind === 'local-route' &&
      Boolean(profile.localRouteCredential?.apiKey) &&
      /^(dsh|deepseek[\s_-]*harness)$/i.test(profile.name.trim())
  );
  const apiKey = existing?.localRouteCredential?.apiKey;
  return existing && apiKey ? { profileId: existing.id, apiKey } : null;
}

/**
 * 找到（或创建）供 DSH 使用的配置方案，并取它自己的本地路由 Key。
 *
 * **不能用 `server.unifiedApiKey`**：代理侧 `resolveRouteProfileCredential()` 要求凭据能
 * 匹配到某个 `ConfigFileProfile.localRouteCredential.apiKey`，匹配不到一律返回
 * `401 invalid_api_key`（`route-proxy-service.ts:575`）。统一 Key 只用于 target-lock，
 * 不参与方案解析。
 *
 * 方案复用规则：优先复用名字就是 DSH 的方案；否则新建一个 `credentialOnly` 方案。
 * 不复用其它客户端的方案，避免把别人的 Key 借给 DSH。
 */
async function ensureDshRouteCredential(): Promise<{ profileId: string; apiKey: string }> {
  const existing = await readDshRouteCredential();
  if (existing) {
    // 复用的卡片可能没有 logo（早于 logo 字段创建的），卡片会退化成 Bot 图标。
    // 顺手补上，避免"DSH 卡片没图标"这种一眼可见的毛病。
    await ensureProfileLogo(existing.profileId, 'deepseekHarness');
    return existing;
  }

  const { upsertConfigFileProfile, generateConfigFileProfileRouteKey } = await import(
    './config-file-profile-service'
  );
  const now = Date.now();
  const created = await upsertConfigFileProfile({
    profile: {
      id: randomUUID(),
      name: 'DeepSeek Harness',
      agentLogoId: 'deepseekHarness',
      authMode: 'third-party',
      credentialOnly: true,
      files: [],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      createdAt: now,
      updatedAt: now,
    },
  });
  const withKey = await generateConfigFileProfileRouteKey({ profileId: created.id });
  const apiKey = withKey.localRouteCredential?.apiKey;
  if (!apiKey) throw new Error('生成 DSH 本地路由密钥失败，请到配置卡片里手动生成一次');
  return { profileId: withKey.id, apiKey };
}

function resolveBaseUrl(server: { host?: string; port: number }): string {
  return `http://${normalizeHostForClient(server.host)}:${server.port}`;
}

/**
 * 从本应用运行时配置派生 baseURL / apiKey / 模型目录。
 * 供写入路径使用（会按需创建 DSH 方案与密钥）。
 */
export async function resolveRouteSource(modelSourceId?: string | null): Promise<DshRouteSource> {
  const { unifiedConfigManager } = await import('./unified-config-manager');
  const sources = await listDshModelSources();
  const source = pickModelSource(sources, modelSourceId);
  if (!source) {
    throw new Error('应用里还没有可用的模型供应商，请先在「站点」页添加供应商并刷新模型');
  }
  const { profileId, apiKey } = await ensureDshRouteCredential();
  return {
    baseUrl: resolveBaseUrl(unifiedConfigManager.getRoutingConfig().server),
    apiKey,
    profileId,
    models: source.models,
    modelSourceId: source.id,
  };
}

// ---------------------------------------------------------------------------
// YAML 读取（注释保留式）
// ---------------------------------------------------------------------------

interface PatchEntrySnapshot {
  provider: string | null;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  models: string[];
  hasEntry: boolean;
  defaultProvider: string | null;
  defaultModel: string | null;
}

/**
 * 把 YAML 标量还原成 JS 原始值。
 *
 * 注意 `Collection.get()` 默认会把标量节点拆包成 JS 值（只有 `keepScalar: true`
 * 才返回节点），而类型声明给的是节点类型，所以这里两种形态都要吃。
 */
function scalarOf(node: unknown): string | number | boolean | null {
  if (isScalar(node)) {
    const value = (node as { value?: unknown }).value;
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : null;
  }
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    return node;
  }
  return null;
}

function readStringField(map: unknown, key: string): string | null {
  if (!isMap(map)) return null;
  const value = scalarOf(map.get(key));
  return typeof value === 'string' ? value : null;
}

function readPatchSnapshot(raw: string): PatchEntrySnapshot {
  const snapshot: PatchEntrySnapshot = {
    provider: null,
    baseUrl: null,
    apiKeyEnv: null,
    models: [],
    hasEntry: false,
    defaultProvider: null,
    defaultModel: null,
  };
  const doc = parseDocument(raw);
  if (doc.errors.length > 0 || !isSeq(doc.contents)) return snapshot;

  for (const item of doc.contents.items) {
    if (!isMap(item)) continue;
    const id = scalarOf(item.get('id'));
    const config = item.get('config');
    if (id === DSH_PATCH_ENTRY_ID) {
      snapshot.hasEntry = true;
      snapshot.baseUrl = readStringField(config, 'baseURL');
      snapshot.apiKeyEnv = readStringField(config, 'apiKeyEnv');
      if (isMap(config)) {
        const models = config.get('models');
        if (isSeq(models)) {
          snapshot.models = models.items
            .map(model => scalarOf(isMap(model) ? model.get('id') : null))
            .filter((value): value is string => typeof value === 'string');
        }
      }
    }
    if (id === DSH_AGENT_DEFAULT_MODEL_ENTRY_ID) {
      snapshot.defaultProvider = readStringField(config, 'provider');
      snapshot.defaultModel = readStringField(config, 'model');
    }
  }
  return snapshot;
}

function readCredentialRef(raw: string, ref: string): string | null {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return null;
  const refs = doc.get('refs');
  if (!isMap(refs)) return null;
  const value = scalarOf(refs.get(ref));
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// 状态检测
// ---------------------------------------------------------------------------

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function countLegacySessions(
  projcacheDir: string
): Promise<{ total: number; legacy: number }> {
  let files: string[];
  try {
    files = (await fs.readdir(projcacheDir)).filter(name => name.endsWith('.json'));
  } catch {
    return { total: 0, legacy: 0 };
  }
  let legacy = 0;
  for (const name of files) {
    const raw = await readFileIfExists(path.join(projcacheDir, name));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as {
        record?: { rows?: { modelSelection?: { val?: { lastUsed?: { provider?: string } } } } };
      };
      if (parsed.record?.rows?.modelSelection?.val?.lastUsed?.provider === DSH_LEGACY_PROVIDER_ID) {
        legacy += 1;
      }
    } catch {
      // 单条缓存损坏不影响整体统计
    }
  }
  return { total: files.length, legacy };
}

function buildSummary(status: Omit<DshRoutingStatus, 'summary'>): string {
  if (!status.installed) return '未检测到 DeepSeek Harness';
  if (status.drift.includes('no-model-source')) {
    return '应用里还没有可用的模型供应商，请先在「站点」页添加供应商并刷新模型';
  }
  if (!status.patchFilePath) return 'DSH 已安装但 profile 尚未初始化（先启动一次 DSH）';
  if (status.configured && status.sessionsOnLegacyProvider === 0) {
    return `已接入会话级路由（${status.configuredModelCount} 个模型）`;
  }
  if (status.configured && status.sessionsOnLegacyProvider > 0) {
    return `配置已就绪，但还有 ${status.sessionsOnLegacyProvider} 个会话仍在使用旧 provider，需要迁移`;
  }
  if (status.drift.includes('patch-entry-missing')) {
    return '未接入：DSH 所有对话窗口会共用同一张路由卡片';
  }
  if (status.drift.includes('models-out-of-sync')) {
    const parts: string[] = [];
    if (status.missingModels.length > 0) parts.push(`新增 ${status.missingModels.length} 个`);
    if (status.staleModels.length > 0) parts.push(`移除 ${status.staleModels.length} 个`);
    return `模型目录已变化（${parts.join('，') || '与 DSH 不一致'}），需要重新应用一次`;
  }
  return '接入配置已过期，需要重新应用';
}

/** 比较两个模型集合是否完全相同（顺序无关）。 */
function sameModelSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every(model => setB.has(model));
}

export async function detectDshRouting(
  options: DshIntegrationOptions = {}
): Promise<DshRoutingStatus> {
  const dshHome = resolveDshHome(options.dshHome);
  const paths = resolveDshPaths(dshHome);
  const running = await (options.isRunning ?? isDshRunning)();

  const profileInitialized = fsSync.existsSync(path.join(paths.profileDir, 'package.json'));
  const patchRaw = await readFileIfExists(paths.patchFilePath);
  const credentialRaw = await readFileIfExists(paths.credentialsFilePath);
  const snapshot = patchRaw ? readPatchSnapshot(patchRaw) : null;
  const sessions = await countLegacySessions(paths.projcacheDir);
  const configuredModels = snapshot?.models ?? [];

  // 供应商列表与期望参数一律只读派生：检测过程不创建方案、不写任何文件
  const modelSources =
    options.modelSources ??
    (options.routeSource
      ? [
          {
            id: options.routeSource.modelSourceId ?? 'local-route',
            label: '本地路由',
            kind: 'local-route' as const,
            models: options.routeSource.models,
          },
        ]
      : await listDshModelSources());
  const matchedSource =
    modelSources.find(source => sameModelSet(source.models, configuredModels)) ?? null;

  let expectedBaseUrl: string;
  let expectedModels: string[];
  if (options.routeSource) {
    expectedBaseUrl = options.routeSource.baseUrl;
    expectedModels = options.routeSource.models;
  } else {
    const { unifiedConfigManager } = await import('./unified-config-manager');
    expectedBaseUrl = resolveBaseUrl(unifiedConfigManager.getRoutingConfig().server);
    expectedModels = pickModelSource(modelSources, matchedSource?.id ?? null)?.models ?? [];
  }

  // 期望密钥只在已有 DSH 方案时才有得比；没有方案说明还没接入，交给 credential-ref-missing 报
  const expectedApiKey = options.routeSource?.apiKey ?? (await readDshRouteCredential())?.apiKey;

  const drift: DshDriftReason[] = [];
  const missingModels = expectedModels.filter(model => !configuredModels.includes(model));
  const staleModels = configuredModels.filter(model => !expectedModels.includes(model));

  if (!profileInitialized && !detectAppInstalled()) {
    drift.push('dsh-not-installed');
  } else if (!profileInitialized) {
    drift.push('profile-not-initialized');
  } else if (modelSources.length === 0) {
    // 应用侧还没加供应商，这不是 DSH 的问题，但必须先解决
    drift.push('no-model-source');
  } else if (!patchRaw) {
    drift.push('patch-file-missing');
  } else if (!snapshot?.hasEntry) {
    drift.push('patch-entry-missing');
  } else {
    if (snapshot.baseUrl !== expectedBaseUrl) drift.push('patch-entry-wrong-base-url');
    if (snapshot.apiKeyEnv !== DSH_ROUTE_CREDENTIAL_REF)
      drift.push('patch-entry-wrong-credential-ref');
    if (configuredModels.length === 0) drift.push('patch-entry-no-models');
    else if (missingModels.length > 0 || staleModels.length > 0) drift.push('models-out-of-sync');

    const credentialValue = credentialRaw
      ? readCredentialRef(credentialRaw, DSH_ROUTE_CREDENTIAL_REF)
      : null;
    if (!credentialValue) drift.push('credential-ref-missing');
    else if (expectedApiKey && credentialValue !== expectedApiKey)
      drift.push('credential-ref-mismatch');

    const defaultProvider = snapshot.defaultProvider;
    if (defaultProvider && defaultProvider === DSH_LEGACY_PROVIDER_ID) {
      drift.push('default-model-not-native');
    }
  }

  const configured = drift.length === 0;
  if (configured) drift.push('ok');

  const base: Omit<DshRoutingStatus, 'summary'> = {
    installed: profileInitialized || detectAppInstalled(),
    dshHome: fsSync.existsSync(dshHome) ? dshHome : null,
    profileDir: profileInitialized ? paths.profileDir : null,
    patchFilePath: patchRaw ? paths.patchFilePath : null,
    credentialsFilePath: credentialRaw ? paths.credentialsFilePath : null,
    running,
    configured,
    drift,
    currentBaseUrl: snapshot?.baseUrl ?? null,
    expectedBaseUrl,
    configuredModelCount: configuredModels.length,
    missingModels,
    staleModels,
    sessionsOnLegacyProvider: sessions.legacy,
    sessionsTotal: sessions.total,
    restartRequired: !configured || sessions.legacy > 0,
    modelSources,
    matchedModelSourceId: matchedSource?.id ?? null,
  };

  return { ...base, summary: buildSummary(base) };
}

// ---------------------------------------------------------------------------
// 写入：cordis.patch.yml
// ---------------------------------------------------------------------------

function buildModelEntries(models: string[]): Array<{ id: string; name: string }> {
  return models.map(id => ({ id, name: id }));
}

/**
 * `YAMLSeq.add` 的形参类型是 `ParsedNode`，而 `createNode` 返回的是带泛型的
 * `YAMLMap`/`Scalar`，两者在 yaml 的 d.ts 里不直接兼容。这里做一次收口转换。
 */
function asParsedNode(
  doc: { createNode: (value: unknown) => unknown },
  value: unknown
): ParsedNode {
  return doc.createNode(value) as ParsedNode;
}

/**
 * 注释保留式改写 `cordis.patch.yml`。
 *
 * 只用 parseDocument/Document API 做节点级修改：parse + stringify 会把用户在
 * 这个文件里写的注释、`!!js` 表达式、条目顺序全部重排或丢弃，而这是 DSH 的文件。
 */
export function applyPatchDocument(
  raw: string,
  params: { baseUrl: string; models: string[]; defaultModel: string; allowedModels: string[] }
): string {
  // 空文件按空数组处理；`parseDocument('')` 的 contents 是 null，赋节点类型很别扭
  const doc = parseDocument(raw.trim().length === 0 ? '[]\n' : raw);
  if (doc.errors.length > 0) {
    throw new Error(`cordis.patch.yml 解析失败：${doc.errors[0]?.message ?? '未知错误'}`);
  }
  if (!isSeq(doc.contents)) {
    throw new Error('cordis.patch.yml 顶层必须是 YAML 数组');
  }
  const seq = doc.contents;
  // 顶层用块式：文件原来是 `[]` 这类流式写法时，追加条目会变成一行 `[{...}, {...}]`，
  // 既难读，用户再手动追加块式条目也会变成非法 YAML
  seq.flow = false;

  // 1) provider 条目：按 id 合并，绝不新增重复条目
  let routeEntry: YAMLMap | undefined;
  let defaultEntry: YAMLMap | undefined;
  let subagentEntry: YAMLMap | undefined;
  for (const item of seq.items) {
    if (!isMap(item)) continue;
    const id = scalarOf(item.get('id'));
    if (id === DSH_PATCH_ENTRY_ID) routeEntry = item as YAMLMap;
    else if (id === DSH_AGENT_DEFAULT_MODEL_ENTRY_ID) defaultEntry = item as YAMLMap;
    else if (id === DSH_SUBAGENT_MODEL_ENTRY_ID) subagentEntry = item as YAMLMap;
  }

  const routeConfig = {
    baseURL: params.baseUrl,
    apiKeyEnv: DSH_ROUTE_CREDENTIAL_REF,
    models: buildModelEntries(params.models),
  };

  if (!routeEntry) {
    seq.add(
      asParsedNode(doc, { id: DSH_PATCH_ENTRY_ID, name: DSH_PATCH_ENTRY_NAME, config: routeConfig })
    );
  } else {
    routeEntry.set('name', DSH_PATCH_ENTRY_NAME);
    const existingConfig = routeEntry.get('config');
    if (isMap(existingConfig)) {
      // 保留用户自己加的字段（thinking / maxTokens 等），只覆盖这三项
      existingConfig.set('baseURL', params.baseUrl);
      existingConfig.set('apiKeyEnv', DSH_ROUTE_CREDENTIAL_REF);
      existingConfig.set('models', buildModelEntries(params.models));
    } else {
      routeEntry.set('config', routeConfig);
    }
  }

  // 2) 默认模型：只在缺失或仍指向 legacy provider 时改，避免踩掉用户选的 deepseek-account
  if (!defaultEntry) {
    seq.add(
      asParsedNode(doc, {
        id: DSH_AGENT_DEFAULT_MODEL_ENTRY_ID,
        name: '@deepseek-ai/dsh-agent-default-model',
        config: { provider: DSH_NATIVE_PROVIDER_ID, model: params.defaultModel },
      })
    );
  } else {
    const config = defaultEntry.get('config');
    if (isMap(config)) {
      const currentProvider = scalarOf(config.get('provider'));
      if (currentProvider === null || currentProvider === DSH_LEGACY_PROVIDER_ID) {
        config.set('provider', DSH_NATIVE_PROVIDER_ID);
        const currentModel = scalarOf(config.get('model'));
        if (typeof currentModel !== 'string' || !params.models.includes(currentModel)) {
          config.set('model', params.defaultModel);
        }
      }
    }
  }

  // 3) 子 agent 白名单：只在缺失或整表都指向 legacy provider 时替换
  const allowedModels =
    params.allowedModels.length > 0
      ? params.allowedModels
      : params.models.slice(0, DEFAULT_SUBAGENT_MODEL_COUNT);
  if (subagentEntry) {
    const config = subagentEntry.get('config');
    if (isMap(config)) {
      const current = config.get('allowedModels');
      const usesLegacy =
        !isSeq(current) ||
        current.items.length === 0 ||
        current.items.every(
          item => isMap(item) && scalarOf(item.get('provider')) === DSH_LEGACY_PROVIDER_ID
        );
      if (usesLegacy && allowedModels.length > 0) {
        config.set(
          'allowedModels',
          allowedModels.map(model => ({ provider: DSH_NATIVE_PROVIDER_ID, model }))
        );
      }
    }
  }

  return doc.toString({ lineWidth: 0 });
}

// ---------------------------------------------------------------------------
// 写入：.credentials.yaml
// ---------------------------------------------------------------------------

export function applyCredentialDocument(raw: string | null, apiKey: string): string {
  if (!raw || raw.trim().length === 0) {
    return `version: 1\nrefs:\n  ${DSH_ROUTE_CREDENTIAL_REF}: ${JSON.stringify(apiKey)}\n`;
  }
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new Error(`.credentials.yaml 解析失败：${doc.errors[0]?.message ?? '未知错误'}`);
  }
  const version = scalarOf(doc.get('version'));
  if (version !== 1) {
    throw new Error('DSH 凭据文件不是 version: 1 布局，拒绝改写（请先让 DSH 完成一次迁移）');
  }
  let refs = doc.get('refs');
  if (!isMap(refs)) {
    doc.set('refs', {});
    refs = doc.get('refs');
  }
  if (isMap(refs)) refs.set(DSH_ROUTE_CREDENTIAL_REF, apiKey);
  return doc.toString({ lineWidth: 0 });
}

// ---------------------------------------------------------------------------
// 备份与清单
// ---------------------------------------------------------------------------

/** 我们会改写的条目 id。回滚按 id 逐个还原，不整文件覆盖。 */
const MANAGED_ENTRY_IDS = [
  DSH_PATCH_ENTRY_ID,
  DSH_AGENT_DEFAULT_MODEL_ENTRY_ID,
  DSH_SUBAGENT_MODEL_ENTRY_ID,
] as const;

/**
 * 按 id 把受管条目还原成基线版本，其余内容（用户自己的条目、注释）原样保留。
 *
 * 不做整文件覆盖的原因：用户可能在接入之后又改了 patch（包括应用自己修过一次密钥），
 * 整文件还原要么被哈希守卫拦下变成"什么都没发生"，要么把用户的后续修改一起冲掉。
 */
export function revertManagedPatchEntries(currentRaw: string, baselineRaw: string): string {
  const doc = parseDocument(currentRaw.trim().length === 0 ? '[]\n' : currentRaw);
  if (doc.errors.length > 0) {
    throw new Error(`cordis.patch.yml 解析失败：${doc.errors[0]?.message ?? '未知错误'}`);
  }
  if (!isSeq(doc.contents)) throw new Error('cordis.patch.yml 顶层必须是 YAML 数组');

  const baselineDoc = parseDocument(baselineRaw.trim().length === 0 ? '[]\n' : baselineRaw);
  const baselineById = new Map<string, unknown>();
  if (isSeq(baselineDoc.contents)) {
    for (const item of baselineDoc.contents.items) {
      if (!isMap(item)) continue;
      const id = scalarOf(item.get('id'));
      if (typeof id === 'string' && (MANAGED_ENTRY_IDS as readonly string[]).includes(id)) {
        // toJS 的 ctx 形参在 d.ts 里是必填，但实现只读取其中的可选字段
        baselineById.set(id, item.toJS({} as never));
      }
    }
  }

  const seq = doc.contents;
  for (const id of MANAGED_ENTRY_IDS) {
    const index = seq.items.findIndex(item => isMap(item) && scalarOf(item.get('id')) === id);
    const baselineValue = baselineById.get(id);
    if (baselineValue !== undefined) {
      const node = asParsedNode(doc, baselineValue);
      if (index >= 0) seq.items[index] = node;
      else seq.add(node);
    } else if (index >= 0) {
      seq.items.splice(index, 1);
    }
  }
  return doc.toString({ lineWidth: 0 });
}

/** 把我们的凭据引用还原成基线：基线没有这个 ref 就删掉。 */
export function revertCredentialRef(
  currentRaw: string,
  baselineRaw: string | null,
  ref: string
): string {
  const doc = parseDocument(currentRaw);
  if (doc.errors.length > 0) {
    throw new Error(`.credentials.yaml 解析失败：${doc.errors[0]?.message ?? '未知错误'}`);
  }
  const baselineValue = baselineRaw ? readCredentialRef(baselineRaw, ref) : null;

  let refs = doc.get('refs');
  if (!isMap(refs)) {
    if (baselineValue === null) return doc.toString({ lineWidth: 0 });
    doc.set('refs', {});
    refs = doc.get('refs');
  }
  if (isMap(refs)) {
    if (baselineValue === null) refs.delete(ref);
    else refs.set(ref, baselineValue);
  }
  return doc.toString({ lineWidth: 0 });
}

async function sha256OfFile(filePath: string): Promise<string> {
  const { createHash } = await import('crypto');
  const buffer = await fs.readFile(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

function timestampSuffix(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

async function backupFile(filePath: string, suffix: string): Promise<string> {
  const backupPath = `${filePath}.apidetect-${suffix}.bak`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

/**
 * 找不到清单时（例如清单已被删掉），退回到"同目录下最新的 .apidetect-*.bak"。
 * 时间戳后缀是 14 位定长，字典序即时间序。
 */
async function findLatestBackup(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.apidetect-`;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  const candidates = names.filter(name => name.startsWith(prefix) && name.endsWith('.bak')).sort();
  return candidates.length > 0 ? path.join(dir, candidates[candidates.length - 1]) : null;
}

async function readManifest(manifestPath: string): Promise<IntegrationManifest | null> {
  try {
    const parsed = await readJsonFile<IntegrationManifest>(manifestPath);
    if (parsed && parsed.version === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 存量会话迁移
// ---------------------------------------------------------------------------

export async function migrateDshSessionProviders(
  options: DshIntegrationOptions & { force?: boolean } = {}
): Promise<DshSessionMigrationResult> {
  const dshHome = resolveDshHome(options.dshHome);
  const paths = resolveDshPaths(dshHome);
  const running = await (options.isRunning ?? isDshRunning)();
  if (running && !options.force) {
    throw new Error(
      'DeepSeek Harness 正在运行，请先完全退出再迁移存量会话，否则退出时会把旧状态写回磁盘'
    );
  }

  let names: string[];
  try {
    names = (await fs.readdir(paths.projcacheDir)).filter(name => name.endsWith('.json'));
  } catch {
    return { scannedFiles: 0, changedFiles: 0, changedRefs: 0, backupDir: null };
  }

  const planned: Array<{ filePath: string; name: string; json: any; refs: number }> = [];
  for (const name of names) {
    const filePath = path.join(paths.projcacheDir, name);
    const raw = await readFileIfExists(filePath);
    if (!raw) continue;
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const rows = json?.record?.rows;
    let refs = 0;

    const lastUsed = rows?.modelSelection?.val?.lastUsed;
    if (lastUsed && lastUsed.provider === DSH_LEGACY_PROVIDER_ID) refs += 1;

    const policy = rows?.subagentModelSelectionPolicy?.val;
    if (Array.isArray(policy)) {
      refs += policy.filter((item: any) => item && item.provider === DSH_LEGACY_PROVIDER_ID).length;
    }

    if (refs > 0) planned.push({ filePath, name, json, refs });
  }

  if (planned.length === 0) {
    return { scannedFiles: names.length, changedFiles: 0, changedRefs: 0, backupDir: null };
  }

  const backupDir = path.join(
    paths.projcacheDir,
    '..',
    `_backup_before_dsh_provider_migration_${timestampSuffix()}`
  );
  await fs.mkdir(backupDir, { recursive: true });

  let changedRefs = 0;
  for (const item of planned) {
    await fs.copyFile(item.filePath, path.join(backupDir, item.name));

    const rows = item.json.record.rows;
    const lastUsed = rows?.modelSelection?.val?.lastUsed;
    if (lastUsed && lastUsed.provider === DSH_LEGACY_PROVIDER_ID) {
      lastUsed.provider = DSH_NATIVE_PROVIDER_ID;
      changedRefs += 1;
    }
    const policy = rows?.subagentModelSelectionPolicy?.val;
    if (Array.isArray(policy)) {
      for (const entry of policy) {
        if (entry && entry.provider === DSH_LEGACY_PROVIDER_ID) {
          entry.provider = DSH_NATIVE_PROVIDER_ID;
          changedRefs += 1;
        }
      }
    }
    await writeTextFileAtomically(item.filePath, JSON.stringify(item.json));
  }

  log.info(`存量会话迁移完成：${planned.length} 个文件 / ${changedRefs} 处引用`);
  return {
    scannedFiles: names.length,
    changedFiles: planned.length,
    changedRefs,
    backupDir: path.resolve(backupDir),
  };
}

// ---------------------------------------------------------------------------
// 一键接入 / 回滚
// ---------------------------------------------------------------------------

export async function enableDshSessionRouting(
  input: EnableDshSessionRoutingInput = {},
  options: DshIntegrationOptions = {}
): Promise<EnableDshSessionRoutingResult> {
  const dshHome = resolveDshHome(options.dshHome);
  const paths = resolveDshPaths(dshHome);

  // 重新应用时如果没显式指定来源，沿用当前 DSH 配置已经对应的那个供应商，
  // 否则会因为默认回退到 local-route 而把用户选的供应商悄悄换掉。
  let modelSourceId = input.modelSourceId ?? null;
  if (!modelSourceId && !options.routeSource) {
    const currentPatch = await readFileIfExists(paths.patchFilePath);
    const currentSnapshot = currentPatch ? readPatchSnapshot(currentPatch) : null;
    if (currentSnapshot?.hasEntry && currentSnapshot.models.length > 0) {
      const sources = options.modelSources ?? (await listDshModelSources());
      modelSourceId =
        sources.find(source => sameModelSet(source.models, currentSnapshot.models))?.id ?? null;
    }
  }

  const routeSource = options.routeSource ?? (await resolveRouteSource(modelSourceId));

  if (!fsSync.existsSync(paths.profileDir)) {
    throw new Error('未找到 DSH profile 目录，请先启动一次 DeepSeek Harness 完成初始化');
  }

  // 迁移存量会话必须 DSH 已退出；在写任何文件之前就拦下来，避免留下半截状态
  const running = await (options.isRunning ?? isDshRunning)();
  if (input.migrateSessions && running) {
    throw new Error(
      'DeepSeek Harness 正在运行，请先完全退出再一并迁移存量会话；或取消勾选“迁移存量会话”，改配置后再单独迁移'
    );
  }

  const defaultModel =
    input.defaultModel && routeSource.models.includes(input.defaultModel)
      ? input.defaultModel
      : routeSource.models[0];
  const allowedModels = Array.from(
    new Set(
      (input.allowedModels ?? routeSource.models.slice(0, DEFAULT_SUBAGENT_MODEL_COUNT)).filter(
        model => routeSource.models.includes(model)
      )
    )
  );

  const suffix = timestampSuffix();
  const backupPaths: string[] = [];
  const writtenHashes: Record<string, string> = {};
  const backupMap: Record<string, string> = {};
  const changedFiles: string[] = [];

  // --- cordis.patch.yml ---
  const patchRaw = (await readFileIfExists(paths.patchFilePath)) ?? '';
  const nextPatch = applyPatchDocument(patchRaw, {
    baseUrl: routeSource.baseUrl,
    models: routeSource.models,
    defaultModel,
    allowedModels,
  });
  if (patchRaw) {
    const backupPath = await backupFile(paths.patchFilePath, suffix);
    backupPaths.push(backupPath);
    backupMap[paths.patchFilePath] = backupPath;
  }
  await writeTextFileAtomically(paths.patchFilePath, nextPatch);
  changedFiles.push(paths.patchFilePath);
  writtenHashes[paths.patchFilePath] = await sha256OfFile(paths.patchFilePath);

  // --- .credentials.yaml ---
  const credentialRaw = await readFileIfExists(paths.credentialsFilePath);
  const nextCredential = applyCredentialDocument(credentialRaw, routeSource.apiKey);
  if (credentialRaw) {
    const backupPath = await backupFile(paths.credentialsFilePath, suffix);
    backupPaths.push(backupPath);
    backupMap[paths.credentialsFilePath] = backupPath;
  }
  await writeTextFileAtomically(paths.credentialsFilePath, nextCredential);
  changedFiles.push(paths.credentialsFilePath);
  writtenHashes[paths.credentialsFilePath] = await sha256OfFile(paths.credentialsFilePath);

  // --- 清单（回滚依据）---
  const manifest: IntegrationManifest = {
    version: 1,
    enabledAt: new Date().toISOString(),
    writtenHashes,
    backupPaths: backupMap,
  };
  await writeJsonFileAtomically(paths.manifestPath, manifest);

  // --- 存量会话 ---
  let sessionMigration: DshSessionMigrationResult | null = null;
  if (input.migrateSessions) {
    sessionMigration = await migrateDshSessionProviders({
      dshHome,
      isRunning: async () => false,
      force: true,
    });
  }

  const status = await detectDshRouting({ ...options, dshHome, routeSource });
  log.info(`DSH 会话级路由已接入：${routeSource.baseUrl} / ${routeSource.models.length} 个模型`);

  return {
    ok: true,
    changedFiles,
    backupPaths,
    models: routeSource.models,
    modelSourceId: routeSource.modelSourceId ?? 'local-route',
    defaultModel,
    allowedModels,
    sessionMigration,
    restartRequired: true,
    status,
  };
}

/**
 * 恢复到接入前的状态。
 *
 * 语义是"按 id 撤销我们做过的事"，不是整文件覆盖：
 * 只把我们写进去的条目（`llm-deepseek` / `agent-default-model` /
 * `subagent-model-selection-settings`）还原成基线版本，其余内容原样保留。
 *
 * 这样即使接入之后用户又手改了 patch、或者应用自己修过密钥，回滚依然有效——
 * 旧实现用"整文件哈希比对"当守卫，任何后续改动都会让它静默跳过，
 * 用户看到的就是"点了没反应"。
 */
export async function rollbackDshSessionRouting(
  options: DshIntegrationOptions = {}
): Promise<DshRollbackResult> {
  const dshHome = resolveDshHome(options.dshHome);
  const paths = resolveDshPaths(dshHome);
  const manifest = await readManifest(paths.manifestPath);
  const restoredFiles: string[] = [];
  const skippedFiles: string[] = [];

  const patchBaselinePath =
    manifest?.backupPaths[paths.patchFilePath] ?? (await findLatestBackup(paths.patchFilePath));
  const credentialBaselinePath =
    manifest?.backupPaths[paths.credentialsFilePath] ??
    (await findLatestBackup(paths.credentialsFilePath));

  // --- cordis.patch.yml：按 id 撤销 ---
  const currentPatch = await readFileIfExists(paths.patchFilePath);
  if (currentPatch) {
    const baseline = patchBaselinePath ? await readFileIfExists(patchBaselinePath) : null;
    try {
      const next = revertManagedPatchEntries(currentPatch, baseline ?? '[]\n');
      if (next !== currentPatch) {
        await writeTextFileAtomically(paths.patchFilePath, next);
        restoredFiles.push(paths.patchFilePath);
      }
    } catch (error) {
      log.warn('回滚 cordis.patch.yml 失败', error);
      skippedFiles.push(paths.patchFilePath);
    }
  }

  // --- .credentials.yaml：删掉/还原我们那个 ref ---
  const currentCredential = await readFileIfExists(paths.credentialsFilePath);
  if (currentCredential) {
    const baseline = credentialBaselinePath ? await readFileIfExists(credentialBaselinePath) : null;
    try {
      const next = revertCredentialRef(currentCredential, baseline, DSH_ROUTE_CREDENTIAL_REF);
      if (next !== currentCredential) {
        await writeTextFileAtomically(paths.credentialsFilePath, next);
        restoredFiles.push(paths.credentialsFilePath);
      }
    } catch (error) {
      log.warn('回滚 .credentials.yaml 失败', error);
      skippedFiles.push(paths.credentialsFilePath);
    }
  }

  // 只有确实撤销成功才清清单，否则留着让用户能重试
  if (skippedFiles.length === 0) {
    await fs.unlink(paths.manifestPath).catch(() => undefined);
  }

  const status = await detectDshRouting(options);
  log.info(`DSH 接入已回滚：${restoredFiles.length} 个文件被还原`);
  return { ok: true, restoredFiles, skippedFiles, status };
}
