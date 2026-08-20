import { createHash, randomBytes, randomUUID } from 'crypto';
import * as TOML from '@iarna/toml';
import { app } from 'electron';
import * as fs from 'fs/promises';
import {
  applyEdits as applyJsonEdits,
  modify as modifyJson,
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';
import * as os from 'os';
import * as path from 'path';
import type {
  ApplyConfigFileProfileInput,
  CommitConfigFileProfileInput,
  ConfigFileDefinition,
  ConfigFilePreviewItem,
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  ConfigFileApplyMode,
  ConfigFileFormat,
  ConfigFileReplacementMatchCounts,
  ConfigFileSnapshot,
  ConfigSessionRecord,
  ConfigSessionRecordDiagnostic,
  ConfigSessionRecordScanResult,
  AgentLogoId,
  ConfigFileTargetCatalogEntry,
  ConfigFileResolvedTargetValues,
  DeleteConfigFileProfileInput,
  GenerateConfigFileProfileRouteKeyInput,
  PreviewConfigFileProfileInput,
  PreviewConfigFileProfileRouteKeyRotationInput,
  PreviewConfigFileDirectEditInput,
  RestoreBuiltinConfigFileProfileInput,
  ResolveConfigFileProfileValuesInput,
  SessionRecordConnector,
  UpsertConfigFileProfileInput,
  ValidateSessionRecordConnectorInput,
} from '../shared/types/config-file-profile';
import {
  DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS,
  isAgentLogoId,
} from '../shared/types/config-file-profile';
import {
  BUILTIN_CLI_TYPES,
  normalizeCliTargetProtocol,
  type BuiltinCliType,
  type EditedConfigFile,
} from '../shared/types/cli-config';
import { writeJsonFileAtomically, writeTextFileAtomically } from './utils/atomic-json';
import { routeStateAffinityService } from './route-state-affinity-service';
import { routeSessionActivityService } from './route-session-activity-service';
import { getBuiltinClientConfigTemplates } from '../shared/config/builtin-client-configs';
import { BUILTIN_GROUP_IDS, isApiKeyActive } from '../shared/types/site';
import { normalizeTomlContent } from './utils/toml-parser';

interface ConfigFileProfileStorage {
  version: 3;
  profiles: ConfigFileProfile[];
}

interface FileState {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  mtimeMs: number | null;
  mode: number | null;
}

const DEFAULT_TOKENS = DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS;
const TRANSACTION_TTL_MS = 10 * 60_000;
const MAX_SESSION_RECORD_FILES = 200;
const MAX_SESSION_RECORD_FILE_BYTES = 10 * 1024 * 1024;
const previewTransactions = new Map<string, ConfigFilePreviewTransaction>();
let routeCredentialIndex = new Map<string, ConfigFileProfile>();
const routeCredentialMisses = new Set<string>();
const BUILTIN_TEMPLATE_VERSION = 3;
const BUILTIN_NAMES: Record<BuiltinCliType, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  openCode: 'OpenCode',
  grokBuild: 'Grok Build',
};
const BUILTIN_IDS: Record<BuiltinCliType, string> = {
  claudeCode: 'example:claude-code',
  codex: 'example:codex',
  openCode: 'example:opencode',
  grokBuild: 'example:grok-build',
};
const LEGACY_SIMPLIFIED_EXAMPLES: Record<BuiltinCliType, { path: string; template: string }> = {
  claudeCode: {
    path: '~/.claude/settings.json',
    template:
      '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "{{BASE_URL}}",\n    "ANTHROPIC_AUTH_TOKEN": "{{API_KEY}}",\n    "ANTHROPIC_MODEL": "{{MODEL}}"\n  }\n}',
  },
  codex: {
    path: '~/.codex/config.toml',
    template:
      'model = "{{MODEL}}"\nmodel_provider = "api-detect"\n\n[model_providers.api-detect]\nbase_url = "{{BASE_URL}}"\nenv_key = "API_DETECT_KEY"',
  },
  openCode: {
    path: '~/.config/opencode/opencode.json',
    template:
      '{\n  "provider": {\n    "api-detect": {\n      "options": { "baseURL": "{{BASE_URL}}", "apiKey": "{{API_KEY}}" },\n      "models": { "{{MODEL}}": {} }\n    }\n  },\n  "model": "api-detect/{{MODEL}}"\n}',
  },
  grokBuild: {
    path: '~/.grok/config.toml',
    template: 'default = "{{MODEL}}"\nbase_url = "{{BASE_URL}}"\napi_key = "{{API_KEY}}"',
  },
};

interface SessionRecordCacheEntry {
  size: number;
  mtimeMs: number;
  records: ConfigSessionRecord[];
  error?: string;
}

const sessionRecordCache = new Map<string, SessionRecordCacheEntry>();
let pendingSessionRecordScan: Promise<ConfigSessionRecordScanResult> | null = null;
let sessionRecordFileReadCount = 0;

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function profileFingerprint(profile: Pick<ConfigFileProfile, 'name' | 'files'>): string {
  return hashContent(JSON.stringify({ name: profile.name, files: profile.files }));
}

export function createDefaultConfigFileProfiles(now = Date.now()): ConfigFileProfile[] {
  return BUILTIN_CLI_TYPES.map(clientType => {
    const id = BUILTIN_IDS[clientType];
    const files = getBuiltinClientConfigTemplates(clientType).map((file, index) => ({
      id: `${id}:file:${index + 1}`,
      path: file.path,
      template: file.content,
      format: file.format,
    }));
    const profile: ConfigFileProfile = {
      id,
      name: BUILTIN_NAMES[clientType],
      files,
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: null },
      isExample: true,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    profile.builtin = {
      clientType,
      version: BUILTIN_TEMPLATE_VERSION,
      fingerprint: profileFingerprint(profile),
    };
    return profile;
  });
}

function replaceLiteral(content: string, value: string | null | undefined, token: string): string {
  return value ? content.split(value).join(token) : content;
}

function migrateEditedFiles(
  profile: ConfigFileProfile,
  editedFiles: EditedConfigFile[],
  values: { baseUrl?: string; apiKey?: string; model?: string }
): void {
  profile.files = editedFiles.map((file, index) => ({
    id: `${profile.id}:migrated:${index + 1}`,
    path: file.path,
    template: replaceLiteral(
      replaceLiteral(
        replaceLiteral(file.content, values.apiKey, DEFAULT_TOKENS.apiKey),
        values.baseUrl,
        DEFAULT_TOKENS.baseUrl
      ),
      values.model,
      DEFAULT_TOKENS.model
    ),
    format: 'auto',
  }));
}

function cloneMigratedProfile(
  source: ConfigFileProfile,
  sourceId: string,
  name: string
): ConfigFileProfile {
  const now = Date.now();
  const id = `migrated:${hashContent(sourceId).slice(0, 20)}`;
  return {
    ...source,
    id,
    name,
    files: source.files.map((file, index) => ({ ...file, id: `${id}:file:${index + 1}` })),
    isExample: false,
    builtin: source.builtin ? { ...source.builtin, migrationSourceId: sourceId } : undefined,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function createMigratedDefaultConfigFileProfiles(): Promise<ConfigFileProfile[]> {
  const profiles = createDefaultConfigFileProfiles();
  const byCli = new Map<BuiltinCliType, ConfigFileProfile>(
    profiles.map(profile => [profile.builtin!.clientType, profile])
  );
  const migratedProfiles: ConfigFileProfile[] = [];
  const { unifiedConfigManager } = await import('./unified-config-manager');
  const { resolveAccountApiKeyValue } = await import('./route-channel-resolver');
  const { resolveApiKeyId } = await import('./route-model-registry-service');

  for (const site of unifiedConfigManager.getSites()) {
    for (const account of unifiedConfigManager.getAccountsBySiteId(site.id)) {
      for (const cliType of BUILTIN_CLI_TYPES) {
        const setting = account.cli_config?.[cliType];
        if (!setting?.editedFiles?.length) continue;
        const sourceId = `managed:${site.id}:${account.id}:${cliType}`;
        const migrated = cloneMigratedProfile(
          byCli.get(cliType)!,
          sourceId,
          `${BUILTIN_NAMES[cliType]} · ${site.name} / ${account.account_name}`
        );
        const keyInfo = account.cached_data?.api_keys?.find(
          item => resolveApiKeyId(item) === String(setting.apiKeyId ?? '')
        );
        const apiKey = keyInfo
          ? await resolveAccountApiKeyValue(site, account, keyInfo)
          : undefined;
        migrateEditedFiles(migrated, setting.editedFiles, {
          baseUrl: site.url,
          apiKey: apiKey || undefined,
          model: setting.model || undefined,
        });
        migrated.target = {
          kind: 'managed',
          siteId: site.id,
          accountId: account.id,
          apiKeyId: keyInfo ? resolveApiKeyId(keyInfo) : undefined,
          model: setting.model,
        };
        migrated.builtin!.fingerprint = profileFingerprint(migrated);
        migratedProfiles.push(migrated);
      }
    }
  }

  const { loadCustomCliConfigStorage } = await import('./custom-cli-config-service');
  const directStorage = await loadCustomCliConfigStorage();
  for (const direct of directStorage.configs) {
    for (const cliType of BUILTIN_CLI_TYPES) {
      const setting = direct.cliSettings[cliType];
      if (!setting?.editedFiles?.length) continue;
      const sourceId = `direct:${direct.id}:${cliType}`;
      const migrated = cloneMigratedProfile(
        byCli.get(cliType)!,
        sourceId,
        `${BUILTIN_NAMES[cliType]} · ${direct.name}`
      );
      migrateEditedFiles(migrated, setting.editedFiles, {
        baseUrl: direct.baseUrl,
        apiKey: direct.apiKey,
        model: setting.model || undefined,
      });
      migrated.target = {
        kind: 'direct',
        configId: direct.id,
        model: setting.model,
      };
      migrated.builtin!.fingerprint = profileFingerprint(migrated);
      migratedProfiles.push(migrated);
    }
  }
  return [...profiles, ...migratedProfiles];
}

function normalizeDefinition(
  definition: Partial<ConfigFileDefinition>,
  fallbackId: string
): ConfigFileDefinition {
  return {
    id: String(definition.id || fallbackId),
    path: String(definition.path || '').trim(),
    template: String(definition.template || ''),
    format: ['auto', 'json', 'toml', 'env', 'text'].includes(String(definition.format))
      ? definition.format
      : 'auto',
  };
}

function normalizeSessionRecordConnector(
  connector: Partial<SessionRecordConnector>,
  fallbackId: string
): SessionRecordConnector {
  return {
    id: String(connector.id || fallbackId),
    path: String(connector.path || '').trim(),
    format: connector.format === 'jsonl' ? 'jsonl' : 'json',
    namespace: String(connector.namespace || '').trim(),
    recordsPath: String(connector.recordsPath || '').trim() || undefined,
    sessionIdPath: String(connector.sessionIdPath || '').trim(),
    displayNamePath: String(connector.displayNamePath || '').trim() || undefined,
    workspacePath: String(connector.workspacePath || '').trim() || undefined,
    updatedAtPath: String(connector.updatedAtPath || '').trim() || undefined,
    activePath: String(connector.activePath || '').trim() || undefined,
    windowOpenPath: String(connector.windowOpenPath || '').trim() || undefined,
    currentSessionIdPath: String(connector.currentSessionIdPath || '').trim() || undefined,
    recursive: connector.recursive === true,
  };
}

function normalizeProfile(profile: ConfigFileProfile): ConfigFileProfile {
  const legacyPaths = Array.isArray(profile.filePaths) ? profile.filePaths : [];
  const legacySessionPaths = Array.isArray(profile.sessionRecordPaths)
    ? profile.sessionRecordPaths.map(String).filter(Boolean)
    : [];
  const sourceFiles = Array.isArray(profile.files)
    ? profile.files
    : legacyPaths.map((pathname, index) => ({
        id: `${profile.id}:file:${index + 1}`,
        path: pathname,
        template: profile.template || '',
      }));
  return {
    id: String(profile.id),
    name: String(profile.name || '未命名配置'),
    agentLogoId: isAgentLogoId(profile.agentLogoId)
      ? (profile.agentLogoId as AgentLogoId)
      : undefined,
    credentialOnly: profile.credentialOnly === true,
    files: sourceFiles.map((item, index) =>
      normalizeDefinition(item, `${profile.id}:file:${index + 1}`)
    ),
    sessionRecordConnectors:
      Array.isArray(profile.sessionRecordConnectors) && profile.sessionRecordConnectors.length > 0
        ? profile.sessionRecordConnectors.map((connector, index) =>
            normalizeSessionRecordConnector(connector, `${profile.id}:session:${index + 1}`)
          )
        : legacySessionPaths.map((pathname, index) =>
            normalizeSessionRecordConnector(
              {
                id: `${profile.id}:legacy-session:${index + 1}`,
                path: pathname,
                format: pathname.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json',
                namespace: profile.id,
                sessionIdPath: 'session_id',
              },
              `${profile.id}:legacy-session:${index + 1}`
            )
          ),
    sessionRecordPaths: legacySessionPaths,
    target: profile.target || { kind: 'local-route', model: null },
    localRouteCredential: profile.localRouteCredential
      ? {
          id: String(profile.localRouteCredential.id || randomUUID()),
          apiKey: String(profile.localRouteCredential.apiKey || ''),
          createdAt: Number(profile.localRouteCredential.createdAt) || Date.now(),
          rotatedAt: profile.localRouteCredential.rotatedAt
            ? Number(profile.localRouteCredential.rotatedAt)
            : undefined,
        }
      : undefined,
    lastApplied:
      profile.lastApplied &&
      typeof profile.lastApplied.baseUrl === 'string' &&
      typeof profile.lastApplied.targetLabel === 'string'
        ? {
            targetLabel: profile.lastApplied.targetLabel,
            baseUrl: profile.lastApplied.baseUrl,
            apiKeyName: String(profile.lastApplied.apiKeyName || '未命名 API Key'),
            model: String(profile.lastApplied.model || ''),
            appliedAt: Number(profile.lastApplied.appliedAt) || Date.now(),
          }
        : undefined,
    isExample: profile.isExample === true,
    builtin:
      profile.builtin && BUILTIN_CLI_TYPES.includes(profile.builtin.clientType)
        ? {
            clientType: profile.builtin.clientType,
            version: Math.max(1, Number(profile.builtin.version) || 1),
            fingerprint: String(profile.builtin.fingerprint || ''),
            migrationSourceId: profile.builtin.migrationSourceId,
          }
        : undefined,
    revision: Math.max(1, Number(profile.revision) || 1),
    createdAt: Number(profile.createdAt) || Date.now(),
    updatedAt: Number(profile.updatedAt) || Date.now(),
  };
}

export function normalizeConfigPath(input: string): string {
  const trimmed = input.trim();
  const expandedHome = /^~(?:[\\/]|$)/.test(trimmed)
    ? path.join(os.homedir(), trimmed.slice(1).replace(/^[\\/]+/, ''))
    : trimmed;
  const expandedEnvironment = expandedHome.replace(
    /%([^%]+)%/g,
    (match, name: string) => process.env[name] ?? match
  );
  return path.resolve(expandedEnvironment);
}

async function assertSafeConfigPath(pathname: string): Promise<void> {
  let current = pathname;
  while (true) {
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new Error(`配置路径不允许使用符号链接: ${current}`);
      if (current === pathname && info.isDirectory()) {
        throw new Error(`配置路径不能是目录: ${pathname}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function readFileState(pathname: string): Promise<FileState> {
  await assertSafeConfigPath(pathname);
  try {
    const [content, stat] = await Promise.all([fs.readFile(pathname, 'utf-8'), fs.stat(pathname)]);
    return {
      path: pathname,
      exists: true,
      content,
      hash: hashContent(content),
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: pathname,
        exists: false,
        content: '',
        hash: hashContent(''),
        mtimeMs: null,
        mode: null,
      };
    }
    throw error;
  }
}

function countAndReplace(content: string, token: string, value: string): [string, number] {
  if (!token) return [content, 0];
  const parts = content.split(token);
  return [parts.join(value), parts.length - 1];
}

function renderDefinition(
  definition: ConfigFileDefinition,
  values: { baseUrl: string; apiKey: string; model: string }
): { content: string; matchCounts: ConfigFileReplacementMatchCounts } {
  let content = definition.template;
  const matchCounts = { baseUrl: 0, apiKey: 0, model: 0 };
  for (const key of ['baseUrl', 'apiKey', 'model'] as const) {
    [content, matchCounts[key]] = countAndReplace(content, DEFAULT_TOKENS[key], values[key]);
  }
  return { content, matchCounts };
}

function ensureSkPrefix(apiKey: string): string {
  if (!apiKey) return apiKey;
  return apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey}`;
}

async function resolveProfileValues(
  profile: ConfigFileProfile
): Promise<ConfigFileResolvedTargetValues> {
  const target = profile.target;
  const { unifiedConfigManager } = await import('./unified-config-manager');
  if (target.kind === 'local-route') {
    const server = unifiedConfigManager.getRoutingConfig().server;
    const registry = unifiedConfigManager.getRoutingConfig().modelRegistry;
    const availableModels = new Set(
      registry.displayItems.length > 0
        ? registry.displayItems.map(item => item.canonicalName)
        : Object.values(registry.entries).map(item => item.canonicalName)
    );
    if (target.model && !availableModels.has(target.model)) {
      throw new Error('所选本地路由模型已不可用，请重新选择');
    }
    if (!profile.localRouteCredential?.apiKey) {
      throw new Error('请先为此配置卡片生成独立的本地路由 API Key');
    }
    return {
      baseUrl: `http://${server.host}:${server.port}`,
      apiKey: profile.localRouteCredential.apiKey,
      model: target.model || '',
      targetLabel: '本地路由',
      apiKeyName: '独立路由 API Key',
    };
  }
  const targetValue =
    target.kind === 'direct'
      ? `direct:${target.configId}`
      : `managed:${target.siteId}:${target.accountId}`;
  const catalogEntry = (await getConfigFileTargetCatalog()).find(
    item => item.value === targetValue && item.available
  );
  if (!catalogEntry) throw new Error('配置目标当前不可用，请重新选择');
  if (target.model && !catalogEntry.allModels.includes(target.model)) {
    throw new Error('所选模型已不属于当前配置目标，请重新选择');
  }
  if (target.kind === 'direct') {
    const { loadCustomCliConfigStorage } = await import('./custom-cli-config-service');
    const storage = await loadCustomCliConfigStorage();
    const config = storage.configs.find(item => item.id === target.configId);
    if (!config || !config.baseUrl.trim() || !config.apiKey.trim())
      throw new Error('直连配置不可用');
    return {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: target.model || config.models[0] || config.manualModels?.[0] || '',
      targetLabel: catalogEntry.label,
      apiKeyName: config.name.trim() || '直连 API Key',
    };
  }
  const site = unifiedConfigManager.getSiteById(target.siteId);
  const account = unifiedConfigManager.getAccountById(target.accountId);
  if (!site || !account || account.site_id !== target.siteId) throw new Error('站点账户不存在');
  const apiKeys = account.cached_data?.api_keys || [];
  const { resolveApiKeyId } = await import('./route-model-registry-service');
  if (!target.apiKeyId) throw new Error('请选择有效的 API Key');
  const apiKeyInfo = apiKeys.find(item => resolveApiKeyId(item) === target.apiKeyId);
  if (!apiKeyInfo || !isApiKeyActive(apiKeyInfo)) throw new Error('请选择有效的 API Key');
  const catalogApiKey = catalogEntry.apiKeys.find(key => key.id === resolveApiKeyId(apiKeyInfo));
  if (!catalogApiKey) {
    throw new Error('所选 API Key 已不可用，请重新选择');
  }
  const scopedModels = catalogApiKey.scopedModels;
  if (target.model && !scopedModels.includes(target.model)) {
    throw new Error('所选模型不属于当前 API Key 分组，请重新选择');
  }
  const { resolveAccountApiKeyValue } = await import('./route-channel-resolver');
  const apiKey = await resolveAccountApiKeyValue(site, account, apiKeyInfo);
  if (!apiKey) throw new Error('无法解析 API Key 的真实值');
  return {
    baseUrl: site.url,
    apiKey: ensureSkPrefix(apiKey),
    model: target.model || scopedModels[0] || '',
    targetLabel: catalogEntry.label,
    apiKeyName: String(apiKeyInfo.name || apiKeyInfo.token_id || apiKeyInfo.id || '未命名 API Key'),
  };
}

export async function resolveConfigFileProfileValues(
  input: ResolveConfigFileProfileValuesInput
): Promise<ConfigFileResolvedTargetValues> {
  if (!input?.profile) throw new Error('配置卡片不能为空');
  return resolveProfileValues(normalizeProfile(input.profile));
}

export function getConfigFileProfileStoragePath(): string {
  return path.join(app.getPath('userData'), 'config-file-profiles.json');
}

function rebuildRouteCredentialIndex(profiles: ConfigFileProfile[]): void {
  routeCredentialIndex = new Map(
    profiles.flatMap(profile =>
      profile.localRouteCredential?.apiKey
        ? [[profile.localRouteCredential.apiKey, profile] as const]
        : []
    )
  );
  routeCredentialMisses.clear();
}

async function writeProfileStorage(profiles: ConfigFileProfile[]): Promise<void> {
  await writeJsonFileAtomically<ConfigFileProfileStorage>(
    getConfigFileProfileStoragePath(),
    { version: 3, profiles },
    { trailingNewline: true, mode: 0o600 }
  );
  rebuildRouteCredentialIndex(profiles);
}

function upgradeBuiltinProfiles(profiles: ConfigFileProfile[]): ConfigFileProfile[] {
  const defaults = createDefaultConfigFileProfiles();
  const latestByClient = new Map(defaults.map(item => [item.builtin!.clientType, item]));
  return profiles.map(profile => {
    if (!profile.isExample) return profile;
    const legacyClient = BUILTIN_CLI_TYPES.find(
      clientType => BUILTIN_IDS[clientType] === profile.id
    );
    const clientType = profile.builtin?.clientType || legacyClient;
    if (!clientType || profile.builtin?.migrationSourceId) return profile;
    const latest = latestByClient.get(clientType);
    if (!latest) return profile;
    const isUntouchedLegacy =
      !profile.builtin &&
      profile.files.length === 1 &&
      profile.files[0].path === LEGACY_SIMPLIFIED_EXAMPLES[clientType].path &&
      profile.files[0].template === LEGACY_SIMPLIFIED_EXAMPLES[clientType].template;
    const isUntouchedVersioned =
      !!profile.builtin &&
      profile.builtin.version < latest.builtin!.version &&
      profileFingerprint(profile) === profile.builtin.fingerprint;
    if (!isUntouchedLegacy && !isUntouchedVersioned) return profile;
    return {
      ...latest,
      name: profile.name,
      agentLogoId: profile.agentLogoId,
      target: profile.target,
      localRouteCredential: profile.localRouteCredential,
      lastApplied: profile.lastApplied,
      sessionRecordConnectors: profile.sessionRecordConnectors,
      sessionRecordPaths: profile.sessionRecordPaths,
      createdAt: profile.createdAt,
      revision: (profile.revision || 1) + 1,
    };
  });
}

export async function loadConfigFileProfiles(): Promise<ConfigFileProfile[]> {
  try {
    const raw = JSON.parse(await fs.readFile(getConfigFileProfileStoragePath(), 'utf-8')) as {
      version?: number;
      profiles?: ConfigFileProfile[];
    };
    const normalized = Array.isArray(raw.profiles) ? raw.profiles.map(normalizeProfile) : [];
    const upgraded = upgradeBuiltinProfiles(normalized);
    if (raw.version !== 3 || upgraded.some((profile, index) => profile !== normalized[index])) {
      await writeProfileStorage(upgraded);
    }
    rebuildRouteCredentialIndex(upgraded);
    return upgraded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const profiles = await createMigratedDefaultConfigFileProfiles();
      await writeProfileStorage(profiles);
      return profiles;
    }
    throw error;
  }
}

async function validateProfile(profile: ConfigFileProfile, requireFiles = true): Promise<void> {
  if (!profile.id.trim() || !profile.name.trim()) throw new Error('配置卡片 ID 和名称不能为空');
  const target = profile.target;
  if (
    !target ||
    !['local-route', 'managed', 'direct'].includes(target.kind) ||
    (target.kind === 'managed' && (!target.siteId || !target.accountId)) ||
    (target.kind === 'direct' && !target.configId)
  ) {
    throw new Error('配置目标参数无效');
  }
  if (profile.credentialOnly) {
    if (
      profile.target.kind !== 'local-route' ||
      profile.files.length > 0 ||
      profile.sessionRecordConnectors.length > 0 ||
      profile.sessionRecordPaths.length > 0 ||
      profile.isExample ||
      profile.builtin
    ) {
      throw new Error('仅凭证客户端只能保存名称、Logo 和本地路由凭证');
    }
  } else if (requireFiles && profile.files.length === 0) {
    throw new Error('至少需要一个配置文件');
  }
  const fileIds = new Set<string>();
  const normalizedPaths = new Set<string>();
  for (const file of profile.files) {
    if (!file.path) throw new Error(`配置卡片 ${profile.name} 存在空文件路径`);
    if (typeof file.template !== 'string') {
      throw new Error(`配置卡片 ${profile.name} 的文件模板无效`);
    }
    if (fileIds.has(file.id)) throw new Error(`配置卡片 ${profile.name} 的文件 ID 必须唯一`);
    fileIds.add(file.id);
    const pathname = normalizeConfigPath(file.path);
    const pathKey = process.platform === 'win32' ? pathname.toLowerCase() : pathname;
    if (normalizedPaths.has(pathKey)) throw new Error(`配置卡片存在重复文件路径: ${file.path}`);
    normalizedPaths.add(pathKey);
    await assertSafeConfigPath(pathname);
  }
  const connectorIds = new Set<string>();
  for (const connector of profile.sessionRecordConnectors) {
    if (connectorIds.has(connector.id)) throw new Error('对话记录路径 ID 必须唯一');
    connectorIds.add(connector.id);
    if (!connector.path || !connector.namespace || !connector.sessionIdPath) {
      throw new Error(`配置卡片 ${profile.name} 的对话记录解析规则不完整`);
    }
    await assertSafeSessionRecordPath(normalizeConfigPath(connector.path));
  }
}

export async function upsertConfigFileProfile(
  input: UpsertConfigFileProfileInput
): Promise<ConfigFileProfile> {
  if (!input || typeof input !== 'object' || !isRecord(input.profile)) {
    throw new Error('配置卡片参数无效');
  }
  if (input.profile.agentLogoId !== undefined && !isAgentLogoId(input.profile.agentLogoId)) {
    throw new Error('客户端 Logo 参数无效');
  }
  const profiles = await loadConfigFileProfiles();
  const index = profiles.findIndex(item => item.id === input.profile.id);
  const previous = index >= 0 ? profiles[index] : undefined;
  if (
    previous &&
    input.expectedRevision !== undefined &&
    previous.revision !== input.expectedRevision
  ) {
    throw new Error('配置卡片已被其他操作修改，请重新加载');
  }
  if (!previous && input.expectedRevision !== undefined) throw new Error('配置卡片不存在');
  const now = Date.now();
  const normalized = normalizeProfile({
    ...input.profile,
    revision: previous ? (previous.revision || 1) + 1 : 1,
    createdAt: previous?.createdAt || input.profile.createdAt || now,
    updatedAt: now,
  });
  await validateProfile(normalized);
  if (index >= 0) profiles[index] = normalized;
  else profiles.push(normalized);
  await writeProfileStorage(profiles);
  previewTransactions.forEach((transaction, id) => {
    if (transaction.profileId === normalized.id) previewTransactions.delete(id);
  });
  return normalized;
}

export async function deleteConfigFileProfile(input: DeleteConfigFileProfileInput): Promise<void> {
  if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
  const profiles = await loadConfigFileProfiles();
  const profile = findProfile(profiles, input.profileId);
  if (input.expectedRevision !== undefined && profile.revision !== input.expectedRevision) {
    throw new Error('配置卡片已被其他操作修改，请重新加载');
  }
  await writeProfileStorage(profiles.filter(item => item.id !== input.profileId));
  try {
    await Promise.all([
      routeStateAffinityService.removeByProfile(input.profileId),
      routeSessionActivityService.removeByProfile(input.profileId),
    ]);
  } catch (error) {
    try {
      await writeProfileStorage(profiles);
    } catch (rollbackError) {
      throw new Error(`删除配置与回滚均失败: ${String(error)}; ${String(rollbackError)}`);
    }
    throw error;
  }
  previewTransactions.forEach((transaction, id) => {
    if (transaction.profileId === input.profileId) previewTransactions.delete(id);
  });
}

export async function restoreBuiltinConfigFileProfile(
  input: RestoreBuiltinConfigFileProfileInput
): Promise<ConfigFileProfile> {
  if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
  const profiles = await loadConfigFileProfiles();
  const index = profiles.findIndex(item => item.id === input.profileId);
  const previous = index >= 0 ? profiles[index] : undefined;
  if (!previous || !previous.isExample) throw new Error('该配置不是内置示例');
  if (input.expectedRevision !== undefined && previous.revision !== input.expectedRevision) {
    throw new Error('配置卡片已被其他操作修改，请重新加载');
  }
  const clientType =
    previous.builtin?.clientType ||
    BUILTIN_CLI_TYPES.find(value => BUILTIN_IDS[value] === previous.id);
  const latest = createDefaultConfigFileProfiles().find(
    profile => profile.builtin?.clientType === clientType
  );
  if (!latest) throw new Error('找不到对应的最新内置示例');
  const restored: ConfigFileProfile = {
    ...latest,
    name: previous.name,
    agentLogoId: previous.agentLogoId,
    target: previous.target,
    localRouteCredential: previous.localRouteCredential,
    lastApplied: previous.lastApplied,
    sessionRecordConnectors: previous.sessionRecordConnectors,
    sessionRecordPaths: previous.sessionRecordPaths,
    revision: (previous.revision || 1) + 1,
    createdAt: previous.createdAt,
    updatedAt: Date.now(),
  };
  profiles[index] = restored;
  await writeProfileStorage(profiles);
  previewTransactions.forEach((transaction, id) => {
    if (transaction.profileId === previous.id) previewTransactions.delete(id);
  });
  return restored;
}

// Compatibility for legacy tests and callers. New UI persists profiles independently.
export async function saveConfigFileProfiles(profiles: ConfigFileProfile[]): Promise<void> {
  const normalized = profiles.map(normalizeProfile);
  const ids = new Set<string>();
  for (const profile of normalized) {
    if (ids.has(profile.id)) throw new Error('配置卡片 ID 必须唯一');
    ids.add(profile.id);
    await validateProfile(profile, false);
  }
  await writeProfileStorage(normalized);
}

export async function generateConfigFileProfileRouteKey(
  input: GenerateConfigFileProfileRouteKeyInput
): Promise<ConfigFileProfile> {
  if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
  const profiles = await loadConfigFileProfiles();
  const index = profiles.findIndex(profile => profile.id === input.profileId);
  if (index < 0) throw new Error('配置卡片不存在或尚未保存');
  const current = profiles[index];
  if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
    throw new Error('配置卡片已修改，请重新加载');
  }
  if (current.target.kind !== 'local-route') {
    throw new Error('只有本地路由配置可以生成独立 API Key');
  }

  const now = Date.now();
  const credential = {
    id: current.localRouteCredential?.id || randomUUID(),
    apiKey: `sk-route-${randomBytes(24).toString('base64url')}`,
    createdAt: current.localRouteCredential?.createdAt || now,
    rotatedAt: current.localRouteCredential ? now : undefined,
  };
  const updated: ConfigFileProfile = {
    ...current,
    localRouteCredential: credential,
    revision: (current.revision || 1) + 1,
    updatedAt: now,
  };
  profiles[index] = updated;
  await writeProfileStorage(profiles);
  previewTransactions.forEach((transaction, id) => {
    if (transaction.profileId === updated.id) previewTransactions.delete(id);
  });
  return updated;
}

export async function previewConfigFileProfileRouteKeyRotation(
  input: PreviewConfigFileProfileRouteKeyRotationInput
): Promise<ConfigFilePreviewTransaction> {
  if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
  pruneTransactions();
  const profile = findProfile(await loadConfigFileProfiles(), input.profileId);
  if (input.expectedRevision !== undefined && profile.revision !== input.expectedRevision) {
    throw new Error('配置卡片已修改，请重新加载');
  }
  if (profile.target.kind !== 'local-route' || !profile.localRouteCredential?.apiKey) {
    throw new Error('当前配置卡片没有可轮换的独立 API Key');
  }
  await validateProfile(profile);

  const now = Date.now();
  const nextLocalRouteCredential = {
    ...profile.localRouteCredential,
    apiKey: `sk-route-${randomBytes(24).toString('base64url')}`,
    rotatedAt: now,
  };
  const files = await Promise.all(
    profile.files.map(async definition => {
      const state = await readFileState(normalizeConfigPath(definition.path));
      const nextContent = state.content
        .split(profile.localRouteCredential!.apiKey)
        .join(nextLocalRouteCredential.apiKey);
      return {
        fileId: definition.id,
        ...state,
        nextContent,
        matchCounts: { baseUrl: 0, apiKey: state.content === nextContent ? 0 : 1, model: 0 },
        changed: state.content !== nextContent,
      };
    })
  );
  if (!profile.credentialOnly && !files.some(file => file.changed)) {
    throw new Error('本地配置中未找到当前 API Key，无法安全地重新生成');
  }
  const transaction: ConfigFilePreviewTransaction = {
    transactionId: randomUUID(),
    profileId: profile.id,
    profileRevision: profile.revision,
    profileFingerprint: transactionProfileFingerprint(profile),
    operation: 'key-rotation',
    createdAt: now,
    expiresAt: now + TRANSACTION_TTL_MS,
    files,
    nextLocalRouteCredential,
  };
  previewTransactions.set(transaction.transactionId, transaction);
  return transaction;
}

export async function findConfigFileProfileByRouteApiKey(
  apiKey: string
): Promise<ConfigFileProfile | null> {
  if (!apiKey) return null;
  const cached = routeCredentialIndex.get(apiKey);
  if (cached) return cached;
  if (routeCredentialMisses.has(apiKey)) return null;
  await loadConfigFileProfiles();
  const loaded = routeCredentialIndex.get(apiKey) || null;
  if (!loaded) routeCredentialMisses.add(apiKey);
  return loaded;
}

function splitModelRestriction(value?: string): Set<string> | null {
  const values = String(value || '')
    .split(/[\s,|]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return values.length === 0 || values.includes('*') || values.includes('all')
    ? null
    : new Set(values);
}

function collectScopedModels(
  models: string[],
  pricing: Record<string, { enable_groups?: string[] }> | undefined,
  group: string | undefined,
  restriction: string | undefined
): string[] {
  const restricted = splitModelRestriction(restriction);
  return models.filter(model => {
    if (restricted && !restricted.has(model)) return false;
    const groups = pricing?.[model]?.enable_groups;
    return !group || !groups || groups.length === 0 || groups.includes(group);
  });
}

export async function getConfigFileTargetCatalog(): Promise<ConfigFileTargetCatalogEntry[]> {
  const { unifiedConfigManager } = await import('./unified-config-manager');
  const { resolveApiKeyId } = await import('./route-model-registry-service');
  const routing = unifiedConfigManager.getRoutingConfig();
  const localModels = Array.from(
    new Set(
      (routing.modelRegistry.displayItems.length > 0
        ? routing.modelRegistry.displayItems.map(item => item.canonicalName)
        : Object.values(routing.modelRegistry.entries).map(item => item.canonicalName)
      ).filter(Boolean)
    )
  );
  const catalog: ConfigFileTargetCatalogEntry[] = [
    {
      value: 'local-route',
      kind: 'local-route',
      label: '本地路由',
      available: true,
      apiKeys: [],
      models: localModels,
      allModels: localModels,
    },
  ];
  for (const site of unifiedConfigManager.getSites()) {
    for (const account of unifiedConfigManager.getAccountsBySiteId(site.id)) {
      const allModels = Array.from(new Set(account.cached_data?.models || [])).filter(Boolean);
      const userGroups = account.cached_data?.user_groups || {};
      const apiKeys = (account.cached_data?.api_keys || []).filter(isApiKeyActive).map(key => {
        const groupName = key.group?.trim();
        const groupInfo = groupName ? userGroups[groupName] : undefined;
        return {
          id: resolveApiKeyId(key),
          label: String(key.name || key.token_id || key.id || '未命名 Key'),
          key: key.key || key.token || undefined,
          group: groupName || undefined,
          ratio: groupInfo?.ratio,
          desc: groupInfo?.desc,
          scopedModels: collectScopedModels(
            allModels,
            account.cached_data?.model_pricing?.data,
            groupName,
            key.models
          ),
        };
      });
      const unavailableReasons = [
        !site.url?.trim() ? '缺少 Base URL' : '',
        site.enabled === false ? '站点已禁用' : '',
        site.group === BUILTIN_GROUP_IDS.UNAVAILABLE ? '站点位于不可用分组' : '',
        apiKeys.length === 0 ? '缺少有效 API Key' : '',
      ].filter(Boolean);
      catalog.push({
        value: `managed:${site.id}:${account.id}`,
        kind: 'managed',
        label: `${site.name} / ${account.account_name}`,
        available: unavailableReasons.length === 0,
        unavailableReason: unavailableReasons.join('；') || undefined,
        siteId: site.id,
        accountId: account.id,
        targetProtocol: normalizeCliTargetProtocol(
          account.routeTargetProtocol ??
            account.cli_config?.codex?.targetProtocol ??
            site.cli_config?.codex?.targetProtocol
        ),
        apiKeys,
        models: Array.from(new Set(apiKeys.flatMap(key => key.scopedModels))),
        allModels,
      });
    }
  }
  const { loadCustomCliConfigStorage } = await import('./custom-cli-config-service');
  for (const direct of (await loadCustomCliConfigStorage()).configs) {
    const unavailableReasons = [
      !direct.baseUrl.trim() ? '缺少 Base URL' : '',
      !direct.apiKey.trim() ? '缺少 API Key' : '',
    ].filter(Boolean);
    const models = Array.from(new Set([...(direct.models || []), ...(direct.manualModels || [])]))
      .map(item => item.trim())
      .filter(Boolean);
    catalog.push({
      value: `direct:${direct.id}`,
      kind: 'direct',
      label: `直连 / ${direct.name || direct.baseUrl}`,
      available: unavailableReasons.length === 0,
      unavailableReason: unavailableReasons.join('；') || undefined,
      configId: direct.id,
      targetProtocol: normalizeCliTargetProtocol(direct.routeTargetProtocol),
      apiKeys: [],
      models,
      allModels: models,
    });
  }
  return catalog;
}

function findProfile(profiles: ConfigFileProfile[], profileId: string): ConfigFileProfile {
  const profile = profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('配置卡片不存在或尚未保存');
  return profile;
}

export async function readSavedConfigFiles(profileId: string): Promise<ConfigFileSnapshot[]> {
  const profile = findProfile(await loadConfigFileProfiles(), profileId);
  return Promise.all(
    profile.files.map(async file => {
      const state = await readFileState(normalizeConfigPath(file.path));
      return { fileId: file.id, ...state };
    })
  );
}

async function assertSafeSessionRecordPath(pathname: string): Promise<void> {
  let current = pathname;
  while (true) {
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new Error(`会话记录路径不允许使用符号链接: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function collectSessionRecordFiles(
  pathname: string,
  connector: SessionRecordConnector
): Promise<string[]> {
  await assertSafeSessionRecordPath(pathname);
  let stat;
  try {
    stat = await fs.stat(pathname);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (stat.isFile()) return [pathname];
  if (!stat.isDirectory()) throw new Error(`会话记录路径必须是文件或目录: ${pathname}`);
  const extension = connector.format === 'jsonl' ? '.jsonl' : '.json';
  const files: string[] = [];
  const pending = [pathname];
  while (pending.length > 0 && files.length < MAX_SESSION_RECORD_FILES) {
    const directory = pending.shift()!;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`会话记录路径不允许使用符号链接: ${child}`);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) files.push(child);
      if (connector.recursive && entry.isDirectory()) pending.push(child);
      if (files.length >= MAX_SESSION_RECORD_FILES) break;
    }
  }
  return files;
}

function readRecordPath(value: unknown, pathname?: string): unknown {
  if (!pathname) return value;
  let current = value;
  for (const segment of pathname
    .split('.')
    .map(item => item.trim())
    .filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else return undefined;
  }
  return current;
}

function stringRecordValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  const containsControlCharacter = Array.from(normalized).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!normalized || normalized.length > 512 || containsControlCharacter) {
    return undefined;
  }
  return normalized;
}

function recordTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordOpenState(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'open', 'opened', 'active', 'current', 'selected'].includes(normalized)) {
    return true;
  }
  if (
    ['false', '0', 'closed', 'close', 'inactive', 'ended', 'complete', 'completed'].includes(
      normalized
    )
  ) {
    return false;
  }
  return undefined;
}

function parseSessionRecords(
  content: string,
  connector: SessionRecordConnector
): { items: unknown[]; windowOpen?: boolean; currentSessionIds?: Set<string> } {
  if (connector.format === 'jsonl') {
    return {
      items: content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    };
  }
  const parsed = JSON.parse(content) as unknown;
  const records = readRecordPath(parsed, connector.recordsPath);
  const windowOpen = connector.windowOpenPath
    ? recordOpenState(readRecordPath(parsed, connector.windowOpenPath))
    : undefined;
  const currentValue = connector.currentSessionIdPath
    ? readRecordPath(parsed, connector.currentSessionIdPath)
    : undefined;
  const currentValues = Array.isArray(currentValue) ? currentValue : [currentValue];
  const currentSessionIds =
    connector.currentSessionIdPath && currentValue !== undefined
      ? new Set(
          currentValues
            .map(stringRecordValue)
            .filter((value): value is string => value !== undefined)
        )
      : undefined;
  return {
    items: Array.isArray(records)
      ? records
      : records && typeof records === 'object'
        ? [records]
        : [],
    windowOpen,
    currentSessionIds,
  };
}

function extractSessionRecords(
  content: string,
  connector: SessionRecordConnector
): ConfigSessionRecord[] {
  const records: ConfigSessionRecord[] = [];
  const parsed = parseSessionRecords(content, connector);
  for (const item of parsed.items) {
    const sessionId = stringRecordValue(readRecordPath(item, connector.sessionIdPath));
    if (!sessionId) continue;
    const recordState = connector.activePath
      ? recordOpenState(readRecordPath(item, connector.activePath))
      : undefined;
    const isOpen =
      parsed.windowOpen === false
        ? false
        : parsed.windowOpen === true && parsed.currentSessionIds !== undefined
          ? parsed.currentSessionIds.has(sessionId)
          : recordState;
    records.push({
      connectorId: connector.id,
      namespace: connector.namespace,
      sessionId,
      displayName: stringRecordValue(readRecordPath(item, connector.displayNamePath)),
      workspace: stringRecordValue(readRecordPath(item, connector.workspacePath)),
      updatedAt: recordTimestamp(readRecordPath(item, connector.updatedAtPath)),
      ...(isOpen === undefined ? {} : { isOpen }),
    });
  }
  return records;
}

async function scanConnector(
  connector: SessionRecordConnector
): Promise<{ records: ConfigSessionRecord[]; diagnostics: ConfigSessionRecordDiagnostic[] }> {
  const records = new Map<string, ConfigSessionRecord>();
  const diagnostics: ConfigSessionRecordDiagnostic[] = [];
  let files: string[];
  try {
    files = await collectSessionRecordFiles(normalizeConfigPath(connector.path), connector);
  } catch (error) {
    return {
      records: [],
      diagnostics: [
        {
          connectorId: connector.id,
          path: connector.path,
          status: 'error',
          recordCount: 0,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  if (files.length === 0) {
    return {
      records: [],
      diagnostics: [
        {
          connectorId: connector.id,
          path: connector.path,
          status: 'missing',
          recordCount: 0,
          message: '路径不存在或没有匹配的记录文件',
        },
      ],
    };
  }
  const connectorSignature = hashContent(JSON.stringify(connector));
  for (const pathname of files) {
    let parsed: ConfigSessionRecord[] = [];
    let errorMessage: string | undefined;
    try {
      const stat = await fs.stat(pathname);
      if (stat.size > MAX_SESSION_RECORD_FILE_BYTES) {
        throw new Error(`会话记录文件超过 10 MB 限制: ${pathname}`);
      }
      const cacheKey = `${connectorSignature}:${normalizeConfigPath(pathname)}`;
      const cached = sessionRecordCache.get(cacheKey);
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
        parsed = cached.records;
        errorMessage = cached.error;
      } else {
        try {
          sessionRecordFileReadCount += 1;
          parsed = extractSessionRecords(await fs.readFile(pathname, 'utf-8'), connector);
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
        }
        sessionRecordCache.set(cacheKey, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          records: parsed,
          error: errorMessage,
        });
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    for (const record of parsed) {
      const key = `${record.namespace}:${record.sessionId}`;
      const previous = records.get(key);
      if (!previous || (record.updatedAt || 0) >= (previous.updatedAt || 0))
        records.set(key, record);
    }
    diagnostics.push({
      connectorId: connector.id,
      path: pathname,
      status: errorMessage ? 'error' : 'ok',
      recordCount: parsed.length,
      message: errorMessage,
    });
  }
  return { records: Array.from(records.values()), diagnostics };
}

async function runSessionRecordScan(): Promise<ConfigSessionRecordScanResult> {
  const profiles = await loadConfigFileProfiles();
  const records = new Map<string, ConfigSessionRecord>();
  const diagnostics: ConfigSessionRecordDiagnostic[] = [];
  for (const connector of profiles.flatMap(profile => profile.sessionRecordConnectors)) {
    const result = await scanConnector(connector);
    diagnostics.push(...result.diagnostics);
    for (const record of result.records) {
      const key = `${record.namespace}:${record.sessionId}`;
      const previous = records.get(key);
      if (!previous || (record.updatedAt || 0) >= (previous.updatedAt || 0))
        records.set(key, record);
    }
  }
  return { records: Array.from(records.values()), diagnostics };
}

export async function scanSavedSessionRecordsWithDiagnostics(): Promise<ConfigSessionRecordScanResult> {
  if (pendingSessionRecordScan) return pendingSessionRecordScan;
  pendingSessionRecordScan = runSessionRecordScan().finally(() => {
    pendingSessionRecordScan = null;
  });
  return pendingSessionRecordScan;
}

export async function scanSavedSessionRecords(): Promise<ConfigSessionRecord[]> {
  return (await scanSavedSessionRecordsWithDiagnostics()).records;
}

export function getSessionRecordCacheStats(): { entries: number; fileReads: number } {
  return { entries: sessionRecordCache.size, fileReads: sessionRecordFileReadCount };
}

export async function validateSessionRecordConnector(
  input: ValidateSessionRecordConnectorInput
): Promise<ConfigSessionRecordScanResult> {
  if (!input?.connector) throw new Error('对话记录路径参数无效');
  const connector = normalizeSessionRecordConnector(
    input.connector,
    input.connector.id || randomUUID()
  );
  if (!connector.path || !connector.namespace || !connector.sessionIdPath) {
    throw new Error('对话记录路径和解析规则不完整');
  }
  return scanConnector(connector);
}

function pruneTransactions(now = Date.now()): void {
  for (const [id, transaction] of previewTransactions) {
    if (transaction.expiresAt <= now) previewTransactions.delete(id);
  }
}

function transactionProfileFingerprint(profile: ConfigFileProfile): string {
  return hashContent(
    JSON.stringify({
      id: profile.id,
      revision: profile.revision,
      target: profile.target,
      files: profile.files,
    })
  );
}

function resolveFileFormat(definition: ConfigFileDefinition): Exclude<ConfigFileFormat, 'auto'> {
  if (definition.format && definition.format !== 'auto') return definition.format;
  const extension = path.extname(definition.path).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.toml') return 'toml';
  if (extension === '.env') return 'env';
  return 'text';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(content: string, label: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value = parseJsonc(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${label} JSON 解析失败: ${printParseErrorCode(first.error)} (位置 ${first.offset})`
    );
  }
  if (!isRecord(value)) throw new Error(`${label} JSON 解析失败: 根节点必须是对象`);
  return value;
}

function mergeJsonPreservingSource(current: string, generated: string): string {
  parseJsonObject(current, '本地文件');
  const template = parseJsonObject(generated, '模板');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const indentation = current.match(/\r?\n([ \t]+)"/)?.[1] || '  ';
  const formattingOptions = {
    eol: newline,
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  };
  const updates: Array<{ path: string[]; value: unknown }> = [];
  const collectUpdates = (value: unknown, targetPath: string[]) => {
    if (isRecord(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) collectUpdates(child, [...targetPath, key]);
      return;
    }
    updates.push({ path: targetPath, value });
  };
  collectUpdates(template, []);
  let result = current;
  for (const update of updates) {
    result = applyJsonEdits(
      result,
      modifyJson(result, update.path, update.value, { formattingOptions })
    );
  }
  parseJsonObject(result, '合并结果');
  return result;
}

function parseTomlObject(content: string, label: string): Record<string, unknown> {
  try {
    const value = TOML.parse(normalizeTomlContent(content)) as unknown;
    if (!isRecord(value)) throw new Error('根节点必须是对象');
    return value;
  } catch (error) {
    throw new Error(
      `${label} TOML 解析失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseEnvAssignments(content: string, label: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) throw new Error(`${label} ENV 解析失败: 无法识别 ${rawLine}`);
    result.set(match[1], match[2]);
  }
  return result;
}

function envCommentSuffix(value: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== '#' || (index > 0 && !/\s/.test(value[index - 1]))) continue;
    let suffixStart = index;
    while (suffixStart > 0 && /\s/.test(value[suffixStart - 1])) suffixStart -= 1;
    return value.slice(suffixStart);
  }
  return '';
}

function mergeEnv(current: string, generated: string): string {
  const replacements = parseEnvAssignments(generated, '模板');
  if (!current) return generated;
  parseEnvAssignments(current, '本地文件');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const used = new Set<string>();
  const lines = current.split(/\r?\n/).map(line => {
    const match = line.match(/^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || !replacements.has(match[3])) return line;
    used.add(match[3]);
    const suffix = envCommentSuffix(match[5]);
    return `${match[1]}${match[2] || ''}${match[3]}${match[4]}${replacements.get(match[3])?.trim()}${suffix}`;
  });
  const finalEmptyLine = lines.at(-1) === '' ? lines.pop() : undefined;
  for (const [key, value] of replacements) if (!used.has(key)) lines.push(`${key}=${value}`);
  if (finalEmptyLine !== undefined) lines.push(finalEmptyLine);
  return lines.join(newline);
}

function parseTomlKeyPath(input: string): string[] | null {
  const segments: string[] = [];
  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/.test(input[cursor] || '')) cursor += 1;
  };
  skipWhitespace();
  while (cursor < input.length) {
    let segment = '';
    const quote = input[cursor];
    if (quote === '"' || quote === "'") {
      const start = cursor;
      cursor += 1;
      let escaped = false;
      while (cursor < input.length) {
        const character = input[cursor];
        cursor += 1;
        if (quote === '"' && escaped) {
          escaped = false;
        } else if (quote === '"' && character === '\\') {
          escaped = true;
        } else if (character === quote) {
          const raw = input.slice(start, cursor);
          segment = quote === '"' ? (JSON.parse(raw) as string) : raw.slice(1, -1);
          break;
        }
      }
      if (!segment && input[cursor - 1] !== quote) return null;
    } else {
      const start = cursor;
      while (cursor < input.length && !/[.\s]/.test(input[cursor])) cursor += 1;
      segment = input.slice(start, cursor);
    }
    if (!segment) return null;
    segments.push(segment);
    skipWhitespace();
    if (cursor >= input.length) break;
    if (input[cursor] !== '.') return null;
    cursor += 1;
    skipWhitespace();
  }
  return segments;
}

function tomlPathIdentity(pathSegments: string[]): string {
  return JSON.stringify(pathSegments);
}

function tomlAssignmentEqualsIndex(line: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let cursor = 0; cursor < line.length; cursor += 1) {
    const character = line[cursor];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#') break;
    if (character === '=') return cursor;
  }
  return -1;
}

function replaceTomlAssignmentValue(localLine: string, templateLine: string): string {
  const localEquals = tomlAssignmentEqualsIndex(localLine);
  const templateEquals = tomlAssignmentEqualsIndex(templateLine);
  if (localEquals < 0 || templateEquals < 0) return templateLine;
  const localValue = localLine.slice(localEquals + 1);
  const localSpacing = localValue.match(/^\s*/)?.[0] || '';
  const localComment = envCommentSuffix(localValue);
  const templateValue = templateLine.slice(templateEquals + 1).trim();
  const templateComment = envCommentSuffix(templateValue);
  const value = templateComment
    ? templateValue.slice(0, -templateComment.length).trimEnd()
    : templateValue;
  return `${localLine.slice(0, localEquals + 1)}${localSpacing}${value}${localComment}`;
}

function parseTomlLineDocument(content: string): {
  lines: string[];
  assignments: Map<string, number>;
  sections: Map<string, { header: string; path: string[]; start: number; end: number }>;
} {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const assignments = new Map<string, number>();
  const sections = new Map<
    string,
    { header: string; path: string[]; start: number; end: number }
  >();
  let sectionPath: string[] = [];
  let sectionStart = 0;
  let sectionHeader = '';

  const closeSection = (end: number) => {
    sections.set(tomlPathIdentity(sectionPath), {
      header: sectionHeader,
      path: sectionPath,
      start: sectionStart,
      end,
    });
  };

  lines.forEach((line, index) => {
    const sectionMatch = line.match(/^\s*\[([^[]+)]\s*(?:#.*)?$/);
    if (sectionMatch) {
      const parsedSection = parseTomlKeyPath(sectionMatch[1]);
      if (!parsedSection) return;
      closeSection(index);
      sectionPath = parsedSection;
      sectionStart = index;
      sectionHeader = line;
      return;
    }
    const equalsIndex = tomlAssignmentEqualsIndex(line);
    if (equalsIndex < 0) return;
    const keyPath = parseTomlKeyPath(line.slice(0, equalsIndex));
    if (keyPath) assignments.set(tomlPathIdentity([...sectionPath, ...keyPath]), index);
  });
  closeSection(lines.length);
  return { lines, assignments, sections };
}

function mergeTomlPreservingSource(current: string, generated: string): string {
  parseTomlObject(current, '本地文件');
  const templateObject = parseTomlObject(generated, '模板');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalNewline = /\r?\n$/.test(current);
  const local = parseTomlLineDocument(current);
  const template = parseTomlLineDocument(generated);
  const missingBySection = new Map<string, { path: string[]; lines: string[] }>();

  for (const [identity, templateIndex] of template.assignments) {
    const localIndex = local.assignments.get(identity);
    if (localIndex !== undefined) {
      local.lines[localIndex] = replaceTomlAssignmentValue(
        local.lines[localIndex],
        template.lines[templateIndex]
      );
      continue;
    }
    const fullPath = JSON.parse(identity) as string[];
    const templateValue = fullPath.reduce<unknown>(
      (value, segment) => (isRecord(value) ? value[segment] : undefined),
      templateObject
    );
    const inlineTableEntries = isRecord(templateValue) ? Object.entries(templateValue) : [];
    if (
      local.sections.has(identity) &&
      inlineTableEntries.length > 0 &&
      inlineTableEntries.every(([, value]) => !isRecord(value))
    ) {
      const missing = missingBySection.get(identity) || { path: fullPath, lines: [] };
      for (const [key, value] of inlineTableEntries) {
        const childIdentity = tomlPathIdentity([...fullPath, key]);
        const serialized = TOML.stringify({
          [key]: value,
        } as Parameters<typeof TOML.stringify>[0]).trimEnd();
        const childLocalIndex = local.assignments.get(childIdentity);
        if (childLocalIndex !== undefined) {
          local.lines[childLocalIndex] = replaceTomlAssignmentValue(
            local.lines[childLocalIndex],
            serialized
          );
        } else {
          missing.lines.push(serialized);
        }
      }
      if (missing.lines.length > 0) missingBySection.set(identity, missing);
      continue;
    }
    const section = Array.from(template.sections.values())
      .filter(item => item.path.every((segment, index) => fullPath[index] === segment))
      .sort((left, right) => right.path.length - left.path.length)[0];
    const sectionPath = section?.path || [];
    const sectionIdentity = tomlPathIdentity(sectionPath);
    const missing = missingBySection.get(sectionIdentity) || { path: sectionPath, lines: [] };
    missing.lines.push(template.lines[templateIndex]);
    missingBySection.set(sectionIdentity, missing);
  }

  const existingInsertions = Array.from(missingBySection.entries())
    .filter(([section]) => local.sections.has(section))
    .map(([section, missing]) => ({
      index: local.sections.get(section)!.end,
      lines: missing.lines,
    }))
    .sort((left, right) => right.index - left.index);
  for (const insertion of existingInsertions) {
    local.lines.splice(insertion.index, 0, ...insertion.lines);
  }

  const impliedSections = new Set<string>();
  const rootIdentity = tomlPathIdentity([]);
  const impliedLines: string[] = [];
  for (const [section, missing] of missingBySection) {
    if (local.sections.has(section) || missing.path.length === 0) continue;
    const hasDottedAssignment = Array.from(local.assignments.keys()).some(identity => {
      const assignmentPath = JSON.parse(identity) as string[];
      return (
        assignmentPath.length > missing.path.length &&
        missing.path.every((segment, index) => assignmentPath[index] === segment)
      );
    });
    if (!hasDottedAssignment) continue;
    const header = template.sections.get(section)?.header;
    const dottedPrefix = header
      ?.trim()
      .replace(/^\[/, '')
      .replace(/]\s*(?:#.*)?$/, '');
    if (!dottedPrefix) continue;
    impliedSections.add(section);
    impliedLines.push(...missing.lines.map(line => `${dottedPrefix}.${line.trimStart()}`));
  }
  if (impliedLines.length > 0) {
    local.lines.splice(local.sections.get(rootIdentity)?.end ?? 0, 0, ...impliedLines);
  }

  for (const [section, missing] of missingBySection) {
    if (local.sections.has(section) || impliedSections.has(section)) continue;
    if (local.lines.length > 0 && local.lines.at(-1)?.trim()) local.lines.push('');
    const header = template.sections.get(section)?.header || `[${section}]`;
    if (missing.path.length > 0) local.lines.push(header);
    local.lines.push(...missing.lines);
  }

  const result = local.lines.join(newline) + (hasFinalNewline ? newline : '');
  try {
    parseTomlObject(result, '合并结果');
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}。本地 TOML 与模板存在结构冲突，请选择覆盖模式或调整冲突项。`
    );
  }
  return result;
}

function removeObsoleteBuiltinManagedFields(
  definition: ConfigFileDefinition,
  current: string,
  generated: string
): string {
  const normalizedPath = definition.path.replace(/\\/g, '/').toLowerCase();
  if (normalizedPath.endsWith('/.claude/settings.json')) {
    const currentObject = parseJsonObject(current, '本地文件');
    const generatedObject = parseJsonObject(generated, '模板');
    const currentEnv = isRecord(currentObject.env) ? currentObject.env : null;
    const generatedEnv = isRecord(generatedObject.env) ? generatedObject.env : null;
    if (currentEnv && generatedEnv) {
      for (const key of ['HTTPS_PROXY', 'HTTP_PROXY']) {
        if (generatedEnv[key] === undefined && currentEnv[key] === 'http://127.0.0.1:7890') {
          delete currentEnv[key];
        }
      }
    }
    return JSON.stringify(currentObject, null, 2) + (current.endsWith('\n') ? '\n' : '');
  }

  if (!normalizedPath.endsWith('/.grok/config.toml')) return current;
  const local = parseTomlLineDocument(current);
  const template = parseTomlLineDocument(generated);
  const managedModels = new Set([
    'api-detect-grok-responses',
    'api-detect-grok-chat',
    'api-detect-grok-messages',
  ]);
  const obsoleteIndexes = [...local.assignments.entries()]
    .filter(([identity]) => {
      const pathSegments = JSON.parse(identity) as string[];
      return (
        pathSegments.length === 3 &&
        pathSegments[0] === 'model' &&
        managedModels.has(pathSegments[1]) &&
        ['api_key', 'extra_headers'].includes(pathSegments[2]) &&
        !template.assignments.has(identity)
      );
    })
    .map(([, index]) => index)
    .sort((left, right) => right - left);
  for (const index of obsoleteIndexes) local.lines.splice(index, 1);
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  return local.lines.join(newline) + (/\r?\n$/.test(current) ? newline : '');
}

function mergeConfigContent(
  definition: ConfigFileDefinition,
  state: FileState,
  generated: string,
  mode: ConfigFileApplyMode
): string {
  const format = resolveFileFormat(definition);
  if (mode === 'overwrite' || !state.exists) {
    if (format === 'json') parseJsonObject(generated, '模板');
    if (format === 'toml') parseTomlObject(generated, '模板');
    if (format === 'env') parseEnvAssignments(generated, '模板');
    return generated;
  }
  if (format === 'text') throw new Error(`文本文件不支持合并，请选择覆盖: ${definition.path}`);
  if (format === 'json') {
    return mergeJsonPreservingSource(
      removeObsoleteBuiltinManagedFields(definition, state.content, generated),
      generated
    );
  }
  if (format === 'toml') {
    return mergeTomlPreservingSource(
      removeObsoleteBuiltinManagedFields(definition, state.content, generated),
      generated
    );
  }
  return mergeEnv(state.content, generated);
}

export async function previewConfigFileProfile(
  input: PreviewConfigFileProfileInput
): Promise<ConfigFilePreviewTransaction> {
  if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
  pruneTransactions();
  const profile = findProfile(await loadConfigFileProfiles(), input.profileId);
  if (input.expectedRevision !== undefined && profile.revision !== input.expectedRevision) {
    throw new Error('配置卡片已修改，请重新加载');
  }
  await validateProfile(profile);
  const applyMode = input.applyMode || 'merge';
  if (!['merge', 'overwrite'].includes(applyMode)) throw new Error('应用模式无效');
  const values = await resolveProfileValues(profile);
  const files: ConfigFilePreviewItem[] = await Promise.all(
    profile.files.map(async definition => {
      const state = await readFileState(normalizeConfigPath(definition.path));
      const rendered = renderDefinition(definition, values);
      const nextContent = mergeConfigContent(definition, state, rendered.content, applyMode);
      return {
        fileId: definition.id,
        ...state,
        nextContent,
        matchCounts: rendered.matchCounts,
        changed: state.content !== nextContent || !state.exists,
      };
    })
  );
  const now = Date.now();
  const transaction: ConfigFilePreviewTransaction = {
    transactionId: randomUUID(),
    profileId: profile.id,
    profileRevision: profile.revision,
    profileFingerprint: transactionProfileFingerprint(profile),
    operation: 'apply',
    applyMode,
    createdAt: now,
    expiresAt: now + TRANSACTION_TTL_MS,
    files,
  };
  previewTransactions.set(transaction.transactionId, transaction);
  return transaction;
}

export async function previewConfigFileDirectEdit(
  input: PreviewConfigFileDirectEditInput
): Promise<ConfigFilePreviewTransaction> {
  if (!input?.profileId || !isRecord(input.edits) || !isRecord(input.snapshots)) {
    throw new Error('本地文件编辑参数无效');
  }
  pruneTransactions();
  const profile = findProfile(await loadConfigFileProfiles(), input.profileId);
  if (input.expectedRevision !== undefined && profile.revision !== input.expectedRevision) {
    throw new Error('配置卡片已修改，请重新加载');
  }
  await validateProfile(profile);
  const files: ConfigFilePreviewItem[] = [];
  for (const definition of profile.files) {
    if (!(definition.id in input.edits)) continue;
    const pathname = normalizeConfigPath(definition.path);
    const snapshot = input.snapshots[definition.id];
    if (!snapshot || normalizeConfigPath(snapshot.path) !== pathname) {
      throw new Error(`文件路径已变化，请重新读取: ${definition.path}`);
    }
    const current = await readFileState(pathname);
    if (
      current.exists !== snapshot.exists ||
      current.hash !== snapshot.hash ||
      current.mtimeMs !== snapshot.mtimeMs ||
      current.mode !== (snapshot.mode ?? null)
    ) {
      throw new Error(`文件已被外部修改，请重新读取: ${definition.path}`);
    }
    const nextContent = String(input.edits[definition.id]);
    files.push({
      fileId: definition.id,
      ...current,
      nextContent,
      matchCounts: { baseUrl: 0, apiKey: 0, model: 0 },
      changed: current.content !== nextContent || !current.exists,
    });
  }
  if (files.length === 0) throw new Error('没有可保存的本地文件修改');
  const now = Date.now();
  const transaction: ConfigFilePreviewTransaction = {
    transactionId: randomUUID(),
    profileId: profile.id,
    profileRevision: profile.revision,
    profileFingerprint: transactionProfileFingerprint(profile),
    operation: 'direct-edit',
    createdAt: now,
    expiresAt: now + TRANSACTION_TTL_MS,
    files,
  };
  previewTransactions.set(transaction.transactionId, transaction);
  return transaction;
}

function fileStateMatches(snapshot: ConfigFilePreviewItem, current: FileState): boolean {
  return (
    snapshot.exists === current.exists &&
    snapshot.hash === current.hash &&
    snapshot.mtimeMs === current.mtimeMs &&
    (snapshot.mode ?? null) === current.mode
  );
}

export async function commitConfigFileProfile(input: CommitConfigFileProfileInput): Promise<void> {
  pruneTransactions();
  const transaction = previewTransactions.get(input.transactionId);
  if (!transaction) throw new Error('预览事务已过期，请重新预览');
  const profile = findProfile(await loadConfigFileProfiles(), transaction.profileId);
  if (
    profile.revision !== transaction.profileRevision ||
    transactionProfileFingerprint(profile) !== transaction.profileFingerprint
  ) {
    throw new Error('配置卡片已修改，请重新预览');
  }
  const resolvedValues =
    transaction.operation === 'apply' ? await resolveProfileValues(profile) : undefined;
  const definitions = new Map(profile.files.map(file => [file.id, file]));
  const _currentStates: FileState[] = [];
  for (const preview of transaction.files) {
    const definition = definitions.get(preview.fileId);
    if (!definition || normalizeConfigPath(definition.path) !== preview.path) {
      throw new Error('配置卡片已修改，请重新预览');
    }
    const current = await readFileState(preview.path);
    if (!fileStateMatches(preview, current)) {
      throw new Error(`文件已被外部修改，请重新读取后再保存: ${preview.path}`);
    }
    _currentStates.push(current);
  }

  const changed = transaction.files.filter(file => file.changed);
  const suffix = `.bak.${Date.now()}`;
  for (const file of changed) {
    if (file.exists) {
      await writeTextFileAtomically(`${file.path}${suffix}`, file.content, {
        mode: file.mode ?? 0o600,
      });
    }
  }

  const written: ConfigFilePreviewItem[] = [];
  try {
    for (const file of changed) {
      await writeTextFileAtomically(file.path, file.nextContent, {
        mode: file.mode ?? undefined,
      });
      written.push(file);
    }
    if (transaction.operation === 'apply' || transaction.operation === 'key-rotation') {
      if (transaction.operation === 'key-rotation' && !transaction.nextLocalRouteCredential) {
        throw new Error('轮换事务缺少新凭证');
      }
      const profiles = await loadConfigFileProfiles();
      const index = profiles.findIndex(item => item.id === profile.id);
      if (index < 0) throw new Error('配置卡片已删除');
      const current = profiles[index];
      profiles[index] = {
        ...current,
        ...(transaction.operation === 'key-rotation'
          ? { localRouteCredential: transaction.nextLocalRouteCredential }
          : resolvedValues
            ? {
                lastApplied: {
                  targetLabel: resolvedValues.targetLabel || '未命名目标',
                  baseUrl: resolvedValues.baseUrl,
                  apiKeyName: resolvedValues.apiKeyName || '未命名 API Key',
                  model: resolvedValues.model,
                  appliedAt: Date.now(),
                },
              }
            : {}),
        revision: (profile.revision || 1) + 1,
        updatedAt: Date.now(),
      };
      await writeProfileStorage(profiles);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const file of written.reverse()) {
      try {
        if (file.exists) {
          await writeTextFileAtomically(file.path, file.content, {
            mode: file.mode ?? undefined,
          });
        } else
          await fs.unlink(file.path).catch(unlinkError => {
            if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
          });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `配置写入和回滚失败: ${String(error)}; ${rollbackErrors.map(String).join('; ')}`
      );
    }
    throw error;
  }
  previewTransactions.delete(transaction.transactionId);
}

// Non-IPC compatibility helpers.
export async function readConfigFiles(filePaths: string[]): Promise<ConfigFileSnapshot[]> {
  return Promise.all(
    filePaths.map(async (inputPath, index) => {
      const state = await readFileState(normalizeConfigPath(inputPath));
      return { fileId: `legacy:${index}`, ...state };
    })
  );
}

export async function saveConfigFile(pathname: string, content: string): Promise<void> {
  pathname = normalizeConfigPath(pathname);
  const previous = await readFileState(pathname);
  if (previous.exists)
    await writeTextFileAtomically(`${pathname}.bak.${Date.now()}`, previous.content);
  await writeTextFileAtomically(pathname, content);
}

export async function applyConfigFileProfile(input: ApplyConfigFileProfileInput): Promise<void> {
  const profile = normalizeProfile(input.profile);
  if (profile.files.length === 0) throw new Error('至少需要一个配置文件路径');
  const originals = await Promise.all(
    profile.files.map(async definition => ({
      definition,
      state: await readFileState(normalizeConfigPath(definition.path)),
      rendered: renderDefinition(definition, input.values),
    }))
  );
  const suffix = `.bak.${Date.now()}`;
  for (const item of originals) {
    if (item.state.exists) {
      await writeTextFileAtomically(`${item.state.path}${suffix}`, item.state.content);
    }
  }
  const written: typeof originals = [];
  try {
    for (const item of originals) {
      await writeTextFileAtomically(item.state.path, item.rendered.content);
      written.push(item);
    }
  } catch (error) {
    await Promise.all(
      written.map(item =>
        item.state.exists
          ? writeTextFileAtomically(item.state.path, item.state.content)
          : fs.unlink(item.state.path).catch(() => undefined)
      )
    );
    throw error;
  }
}
