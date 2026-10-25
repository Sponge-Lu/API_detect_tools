import { resolveProfileValues } from './clients/profile-targets';
export { getConfigFileTargetCatalog } from './clients/profile-targets';
import {
  DEFAULT_TOKENS,
  BUILTIN_NAMES,
  hashContent,
  profileFingerprint,
  createBuiltinConfigFileProfile,
  createDefaultConfigFileProfiles,
  migrateEditedFiles,
  cloneMigratedProfile,
  normalizeSessionRecordConnector,
  normalizeProfile,
  upgradeBuiltinProfiles,
} from './clients/profile-templates';
export { createDefaultConfigFileProfiles } from './clients/profile-templates';
import { extractSessionRecords } from './clients/session-record-parser';
import { FileState, isRecord, mergeConfigContent } from './clients/config-content';
import { randomBytes, randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getApplicationStorage } from './storage/application-storage';
import {
  prepareCliOperation,
  commitCliOperation,
  recoverCliOperations,
} from './storage/cli-operation-journal';
import { buildVersionedApiUrl } from '../shared/utils/apiConfig';

import { app } from 'electron';
import {
  backupConfigFile,
  listConfigFileBackups,
  migrateLegacyConfigBackups,
  readConfigFileBackup,
} from './config-file-backups';
import * as fs from 'fs/promises';

import * as os from 'os';
import * as path from 'path';
import type {
  ConfigFileBackup,
  ConfigFileBackupInput,
  PreviewConfigFileBackupRestoreInput,
  ApplyConfigFileProfileInput,
  CommitConfigFileProfileInput,
  ConfigFileDefinition,
  ConfigFilePreviewItem,
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  ConfigFileReplacementMatchCounts,
  ConfigFileSnapshot,
  ConfigSessionRecord,
  ConfigSessionRecordDiagnostic,
  ConfigSessionRecordScanResult,
  ConfigFileResolvedTargetValues,
  DeleteConfigFileProfileInput,
  GenerateConfigFileProfileRouteKeyInput,
  PreviewConfigFileProfileInput,
  PreviewConfigFileProfileRouteKeyRotationInput,
  PreviewConfigFileDirectEditInput,
  RestoreBuiltinConfigFileProfileInput,
  SwitchBuiltinConfigFileProfileAuthModeInput,
  ResolveConfigFileProfileValuesInput,
  SessionRecordConnector,
  UpsertConfigFileProfileInput,
  ValidateSessionRecordConnectorInput,
} from '../shared/types/config-file-profile';
import { isAgentLogoId, normalizeConfigFileAuthMode } from '../shared/types/config-file-profile';
import {
  BUILTIN_CLI_IDS,
  BUILTIN_CLI_TYPES,
  type BuiltinCliType,
} from '../shared/types/cli-config';
import { writeJsonFileAtomically, writeTextFileAtomically } from './utils/atomic-json';
import { readStorageText } from './storage/application-storage';
import { routeStateAffinityService } from './route-state-affinity-service';
import { routeSessionActivityService } from './route-session-activity-service';
import { routeSessionBindingService } from './route-session-binding-service';

import { isDshConfigProfile } from '../shared/config/dsh-client-config';
import { DSH_ROUTE_CREDENTIAL_REF } from '../shared/types/dsh-integration';
import {
  assertDshProfileInitialized,
  createDshConfigFileProfile,
  migrateDshConfigFileProfiles,
  resolveDshProfileConfig,
  validateDshConfigFileProfile,
} from './dsh-config-file-profile';
import {
  applyCredentialDocument,
  applyPatchDocument,
  prepareDshRollbackContent,
  readCredentialRef,
} from './dsh-integration-service';

interface ConfigFileProfileStorage {
  version: 4;
  profiles: ConfigFileProfile[];
}
const TRANSACTION_TTL_MS = 10 * 60_000;
const MAX_SESSION_RECORD_FILES = 200;
const MAX_SESSION_RECORD_FILE_BYTES = 10 * 1024 * 1024;
const previewTransactions = new Map<string, ConfigFilePreviewTransaction>();
let profileQueue: Promise<void> = Promise.resolve();
const profileMutation = new AsyncLocalStorage<{ open: boolean }>();
async function serializeProfileMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (profileMutation.getStore()?.open) return operation();
  const run = async () => {
    const token = { open: true };
    try {
      return await profileMutation.run(token, operation);
    } finally {
      token.open = false;
    }
  };
  const pending = profileQueue.then(run);
  profileQueue = pending.then(
    () => undefined,
    () => undefined
  );
  return pending;
}
let routeCredentialIndex = new Map<string, ConfigFileProfile>();
const routeCredentialMisses = new Set<string>();

export function invalidateConfigFileProfiles(): void {
  previewTransactions.clear();
  routeCredentialIndex.clear();
  routeCredentialMisses.clear();
  sessionRecordCache.clear();
  pendingSessionRecordScan = null;
}

interface SessionRecordCacheEntry {
  size: number;
  mtimeMs: number;
  records: ConfigSessionRecord[];
  error?: string;
}

const sessionRecordCache = new Map<string, SessionRecordCacheEntry>();
let pendingSessionRecordScan: Promise<ConfigSessionRecordScanResult> | null = null;
let sessionRecordFileReadCount = 0;

async function createMigratedDefaultConfigFileProfiles(): Promise<ConfigFileProfile[]> {
  const profiles = createDefaultConfigFileProfiles();
  const byCli = new Map<BuiltinCliType, ConfigFileProfile>(
    BUILTIN_CLI_TYPES.map(cliType => [
      cliType,
      profiles.find(profile => profile.builtin?.clientType === cliType)!,
    ])
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
  if (content.includes(DEFAULT_TOKENS.baseUrl + '/v1')) {
    [content, matchCounts.baseUrl] = countAndReplace(
      content,
      DEFAULT_TOKENS.baseUrl + '/v1',
      buildVersionedApiUrl(values.baseUrl)
    );
  }
  for (const key of ['baseUrl', 'apiKey', 'model'] as const) {
    const [rendered, count] = countAndReplace(content, DEFAULT_TOKENS[key], values[key]);
    content = rendered;
    matchCounts[key] += count;
  }
  return { content, matchCounts };
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
    { version: 4, profiles },
    { trailingNewline: true, mode: 0o600 }
  );
  rebuildRouteCredentialIndex(profiles);
}

export async function loadConfigFileProfiles(): Promise<ConfigFileProfile[]> {
  return serializeProfileMutation(async () => {
    try {
      const raw = JSON.parse(await readStorageText(getConfigFileProfileStoragePath())) as {
        version?: number;
        profiles?: ConfigFileProfile[];
      };
      const normalized = Array.isArray(raw.profiles) ? raw.profiles.map(normalizeProfile) : [];
      const upgraded = upgradeBuiltinProfiles(
        raw.version === 4 ? normalized : migrateDshConfigFileProfiles(normalized)
      );
      if (raw.version !== 4 || upgraded.some((profile, index) => profile !== normalized[index])) {
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
  });
}

export function prepareConfigFileProfiles(value: unknown): ConfigFileProfileStorage {
  if (!isRecord(value) || !Array.isArray(value.profiles))
    throw new Error('Invalid client profile storage');
  const normalized = value.profiles.map(profile => normalizeProfile(profile as ConfigFileProfile));
  return {
    version: 4,
    profiles: upgradeBuiltinProfiles(
      value.version === 4 ? normalized : migrateDshConfigFileProfiles(normalized)
    ),
  };
}

async function validateProfile(profile: ConfigFileProfile, requireFiles = true): Promise<void> {
  if (profile.requiresConfiguration && requireFiles)
    throw new Error('此配置来自无密钥备份，请先补全模板和凭证');
  if (!profile.id.trim() || !profile.name.trim()) throw new Error('配置卡片 ID 和名称不能为空');
  if (isDshConfigProfile(profile)) validateDshConfigFileProfile(profile);
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
  return serializeProfileMutation(async () => {
    if (!input || typeof input !== 'object' || !isRecord(input.profile)) {
      throw new Error('配置卡片参数无效');
    }
    if (input.profile.agentLogoId !== undefined && !isAgentLogoId(input.profile.agentLogoId)) {
      throw new Error('客户端 Logo 参数无效');
    }
    const profiles = await loadConfigFileProfiles();
    const index = profiles.findIndex(item => item.id === input.profile.id);
    const previous = index >= 0 ? profiles[index] : undefined;
    if (getApplicationStorage() && previous && input.expectedRevision === undefined)
      throw new Error('Existing client profiles require an expected revision');
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
    if (normalized.requiresConfiguration && normalized.files.every(file => file.template.trim()))
      normalized.requiresConfiguration = false;
    await validateProfile(normalized);
    if (index >= 0) profiles[index] = normalized;
    else profiles.push(normalized);
    await writeProfileStorage(profiles);
    previewTransactions.forEach((transaction, id) => {
      if (transaction.profileId === normalized.id) previewTransactions.delete(id);
    });
    return normalized;
  });
}

export async function deleteConfigFileProfile(input: DeleteConfigFileProfileInput): Promise<void> {
  return serializeProfileMutation(async () => {
    if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
    const profiles = await loadConfigFileProfiles();
    const profile = findProfile(profiles, input.profileId);
    if (input.expectedRevision !== undefined && profile.revision !== input.expectedRevision) {
      throw new Error('配置卡片已被其他操作修改，请重新加载');
    }
    const { unifiedConfigManager } = await import('./unified-config-manager');
    const routing = unifiedConfigManager.getRoutingConfig();
    if (
      routing.clientRouting?.[input.profileId]?.pinned ||
      Object.values(routing.sessionRouting?.instances || {}).some(
        instance => instance.profileId === input.profileId && instance.pinned
      )
    ) {
      throw new Error('客户端存在已钉住的路由，请先取消钉住');
    }
    const remaining = profiles.filter(item => item.id !== input.profileId);
    const storage = getApplicationStorage();
    if (storage) {
      await Promise.all([routeSessionActivityService.flush(), routeSessionBindingService.flush()]);
      const related: import('./storage/application-storage').StorageDocuments = {};
      for (const [id, collection] of [
        ['route-state-affinity', 'resources'],
        ['route-session-activity', 'instances'],
        ['route-session-bindings', 'bindings'],
      ] as const) {
        const document = storage.documents.read(id);
        if (!document) continue;
        document[collection] = Object.fromEntries(
          Object.entries(document[collection] ?? {}).filter(
            ([, value]) => (value as { profileId?: string }).profileId !== input.profileId
          )
        );
        related[id] = document;
      }
      await storage.commitDocument(
        'config-file-profiles',
        'config-file-profiles',
        storage.coordinator.version('config-file-profiles'),
        { version: 4, profiles: remaining },
        related
      );
      rebuildRouteCredentialIndex(remaining);
      routeStateAffinityService.invalidate();
      routeSessionActivityService.invalidate();
      routeSessionBindingService.invalidate();
      await Promise.all([
        routeStateAffinityService.load(),
        routeSessionActivityService.load(),
        routeSessionBindingService.load(),
      ]);
      previewTransactions.forEach((transaction, id) => {
        if (transaction.profileId === input.profileId) previewTransactions.delete(id);
      });
      return;
    }
    await writeProfileStorage(remaining);
    try {
      await Promise.all([
        routeStateAffinityService.removeByProfile(input.profileId),
        routeSessionActivityService.removeByProfile(input.profileId),
        routeSessionBindingService.removeByProfile(input.profileId),
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
  });
}

export async function restoreMissingBuiltinConfigFileProfiles(): Promise<ConfigFileProfile[]> {
  return serializeProfileMutation(async () => {
    const profiles = await loadConfigFileProfiles();
    const existingIds = new Set(profiles.map(profile => profile.id));
    const missing = createDefaultConfigFileProfiles().filter(
      profile =>
        !existingIds.has(profile.id) &&
        !profiles.some(
          existing =>
            existing.builtin?.clientType === profile.builtin?.clientType && existing.isExample
        )
    );
    if (missing.length === 0) return profiles;
    const restored = [...profiles, ...missing];
    await writeProfileStorage(restored);
    return restored;
  });
}

export async function restoreBuiltinConfigFileProfile(
  input: RestoreBuiltinConfigFileProfileInput
): Promise<ConfigFileProfile> {
  return serializeProfileMutation(async () => {
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
      BUILTIN_CLI_TYPES.find(value => BUILTIN_CLI_IDS[value] === previous.id);
    if (!clientType) throw new Error('找不到对应的内置示例');
    const authMode = normalizeConfigFileAuthMode(previous.authMode);
    const latest =
      clientType === 'deepseekHarness'
        ? createDshConfigFileProfile(Date.now(), previous.id)
        : createBuiltinConfigFileProfile(clientType, authMode, Date.now());
    const restored: ConfigFileProfile = {
      ...latest,
      name: previous.name,
      agentLogoId: previous.agentLogoId,
      target: previous.target,
      localRouteCredential: previous.localRouteCredential,
      lastApplied: previous.lastApplied,
      dsh: previous.dsh,
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
  });
}

export async function switchBuiltinConfigFileProfileAuthMode(
  input: SwitchBuiltinConfigFileProfileAuthModeInput
): Promise<ConfigFileProfile> {
  return serializeProfileMutation(async () => {
    if (!input?.profileId) throw new Error('配置卡片 ID 不能为空');
    const profiles = await loadConfigFileProfiles();
    const index = profiles.findIndex(item => item.id === input.profileId);
    const previous = index >= 0 ? profiles[index] : undefined;
    if (!previous || !previous.isExample) throw new Error('只有内置示例支持切换接入方式');
    if (isDshConfigProfile(previous))
      throw new Error('DSH 使用本地路由接入，不支持切换官方登录模板');
    if (input.expectedRevision !== undefined && previous.revision !== input.expectedRevision) {
      throw new Error('配置卡片已被其他操作修改，请重新加载');
    }
    const authMode = normalizeConfigFileAuthMode(input.authMode);
    if (normalizeConfigFileAuthMode(previous.authMode) === authMode) return previous;
    const clientType =
      previous.builtin?.clientType ||
      BUILTIN_CLI_TYPES.find(value => BUILTIN_CLI_IDS[value] === previous.id);
    if (!clientType || clientType === 'deepseekHarness') throw new Error('找不到对应的内置示例');
    const latest = createBuiltinConfigFileProfile(clientType, authMode, Date.now());
    const switched: ConfigFileProfile = {
      ...latest,
      name: previous.name,
      agentLogoId: previous.agentLogoId,
      target: previous.target,
      localRouteCredential: previous.localRouteCredential,
      sessionRecordConnectors: previous.sessionRecordConnectors,
      sessionRecordPaths: previous.sessionRecordPaths,
      revision: (previous.revision || 1) + 1,
      createdAt: previous.createdAt,
      updatedAt: Date.now(),
    };
    profiles[index] = switched;
    await writeProfileStorage(profiles);
    previewTransactions.forEach((transaction, id) => {
      if (transaction.profileId === previous.id) previewTransactions.delete(id);
    });
    return switched;
  });
}

// Compatibility for legacy tests and callers. New UI persists profiles independently.
export async function saveConfigFileProfiles(profiles: ConfigFileProfile[]): Promise<void> {
  if (getApplicationStorage())
    throw Object.assign(new Error('Use per-profile versioned operations'), {
      code: 'LEGACY_WRITE_DISABLED',
    });
  return serializeProfileMutation(async () => {
    const normalized = profiles.map(normalizeProfile);
    const ids = new Set<string>();
    for (const profile of normalized) {
      if (ids.has(profile.id)) throw new Error('配置卡片 ID 必须唯一');
      ids.add(profile.id);
      await validateProfile(profile, false);
    }
    await writeProfileStorage(normalized);
  });
}

export async function generateConfigFileProfileRouteKey(
  input: GenerateConfigFileProfileRouteKeyInput
): Promise<ConfigFileProfile> {
  return serializeProfileMutation(async () => {
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
  });
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
      let nextContent = state.content
        .split(profile.localRouteCredential!.apiKey)
        .join(nextLocalRouteCredential.apiKey);
      if (isDshConfigProfile(profile)) {
        nextContent = state.content;
        if (definition.id === profile.files[1].id) {
          if (
            readCredentialRef(state.content, DSH_ROUTE_CREDENTIAL_REF) !==
            profile.localRouteCredential!.apiKey
          ) {
            throw new Error('DSH 凭据与当前 API Key 不一致，请先重新应用配置');
          }
          nextContent = applyCredentialDocument(state.content, nextLocalRouteCredential.apiKey);
        }
      }
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

export async function listSavedConfigFileBackups(
  input: ConfigFileBackupInput
): Promise<ConfigFileBackup[]> {
  const profile = findProfile(await loadConfigFileProfiles(), input?.profileId);
  const definition = profile.files.find(file => file.id === input.fileId);
  if (!definition) throw new Error('配置文件不存在');
  const pathname = normalizeConfigPath(definition.path);
  await assertSafeConfigPath(pathname);
  await migrateLegacyConfigBackups([pathname]);
  return listConfigFileBackups(pathname);
}

export async function previewConfigFileBackupRestore(
  input: PreviewConfigFileBackupRestoreInput
): Promise<ConfigFilePreviewTransaction> {
  const profile = findProfile(await loadConfigFileProfiles(), input?.profileId);
  if (input.expectedRevision !== undefined && input.expectedRevision !== profile.revision)
    throw new Error('配置卡片已修改，请重新加载');
  const definition = profile.files.find(file => file.id === input.fileId);
  if (!definition) throw new Error('配置文件不存在');
  const pathname = normalizeConfigPath(definition.path);
  const snapshot = await readFileState(pathname);
  const content = await readConfigFileBackup(pathname, input.backupId, input.expectedHash);
  const transaction = await previewConfigFileDirectEdit({
    profileId: profile.id,
    expectedRevision: profile.revision,
    edits: { [definition.id]: content },
    snapshots: { [definition.id]: snapshot },
  });
  transaction.operation = 'backup-restore';
  return transaction;
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
      dsh: profile.dsh,
      files: profile.files,
    })
  );
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
  const isDsh = isDshConfigProfile(profile);
  if (input.restoreDsh && !isDsh) throw new Error('只有 DSH 配置支持恢复接入前状态');
  if (isDsh && !input.restoreDsh) await assertDshProfileInitialized();
  const dshConfig = isDsh && !input.restoreDsh ? await resolveDshProfileConfig(profile) : undefined;
  const values = input.restoreDsh
    ? { baseUrl: '', apiKey: '', model: '' }
    : dshConfig?.values || (await resolveProfileValues(profile));
  const files: ConfigFilePreviewItem[] = await Promise.all(
    profile.files.map(async definition => {
      const state = await readFileState(normalizeConfigPath(definition.path));
      const rendered = renderDefinition(definition, values);
      let nextContent: string;
      if (isDsh) {
        const isPatch = definition.id === profile.files[0].id;
        nextContent = input.restoreDsh
          ? await prepareDshRollbackContent(state.path, state.content, isPatch)
          : isPatch
            ? applyPatchDocument(state.content, {
                baseUrl: values.baseUrl,
                models: dshConfig!.models,
                defaultModel: values.model,
                allowedModels: [],
                updateSelection: true,
                preserveSubagentSettings: true,
              })
            : applyCredentialDocument(state.exists ? state.content : null, values.apiKey);
      } else {
        nextContent = mergeConfigContent(definition, state, rendered.content, applyMode);
      }
      return {
        fileId: definition.id,
        ...state,
        nextContent,
        matchCounts: rendered.matchCounts,
        changed: state.content !== nextContent || (!state.exists && !input.restoreDsh),
      };
    })
  );
  const now = Date.now();
  const transaction: ConfigFilePreviewTransaction = {
    transactionId: randomUUID(),
    profileId: profile.id,
    profileRevision: profile.revision,
    profileFingerprint: transactionProfileFingerprint(profile),
    operation: input.restoreDsh ? 'dsh-rollback' : 'apply',
    dshConfigSignature: dshConfig ? hashContent(JSON.stringify(dshConfig)) : undefined,
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
  return serializeProfileMutation(async () => {
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
    let dshConfig: Awaited<ReturnType<typeof resolveDshProfileConfig>> | undefined;
    if (isDshConfigProfile(profile) && transaction.operation === 'apply') {
      await assertDshProfileInitialized();
      dshConfig = await resolveDshProfileConfig(profile);
      if (hashContent(JSON.stringify(dshConfig)) !== transaction.dshConfigSignature) {
        throw new Error('DSH 模型目录或接入参数已变化，请重新预览');
      }
    }
    const resolvedValues =
      transaction.operation === 'apply'
        ? dshConfig?.values || (await resolveProfileValues(profile))
        : undefined;
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
    await migrateLegacyConfigBackups(changed.map(file => file.path));
    for (const file of changed) {
      if (file.exists) {
        await backupConfigFile(file.path, file.content);
      }
    }

    const written: ConfigFilePreviewItem[] = [];
    const journalId = await prepareCliOperation(profile.id, changed);
    try {
      for (const file of changed) {
        if (!fileStateMatches(file, await readFileState(file.path)))
          throw new Error('File changed after preview: ' + file.path);
        await writeTextFileAtomically(file.path, file.nextContent, {
          mode: file.mode ?? undefined,
        });
        written.push(file);
      }
      if (
        transaction.operation === 'apply' ||
        transaction.operation === 'key-rotation' ||
        transaction.operation === 'dsh-rollback'
      ) {
        if (transaction.operation === 'key-rotation' && !transaction.nextLocalRouteCredential) {
          throw new Error('轮换事务缺少新凭证');
        }
        const profiles = await loadConfigFileProfiles();
        const index = profiles.findIndex(item => item.id === profile.id);
        if (index < 0) throw new Error('配置卡片已删除');
        const current = profiles[index];
        profiles[index] = {
          ...current,
          ...(dshConfig
            ? {
                dsh: {
                  ...current.dsh,
                  modelSourceId: dshConfig.modelSourceId,
                },
              }
            : {}),
          ...(transaction.operation === 'dsh-rollback'
            ? { lastApplied: undefined }
            : transaction.operation === 'key-rotation'
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
        const storage = getApplicationStorage();
        if (storage && journalId) {
          commitCliOperation(journalId, () =>
            storage.write(
              getConfigFileProfileStoragePath(),
              JSON.stringify({ version: 4, profiles })
            )
          );
          rebuildRouteCredentialIndex(profiles);
        } else await writeProfileStorage(profiles);
      }
      commitCliOperation(journalId);
    } catch (error) {
      const storage = getApplicationStorage();
      if (storage && journalId) {
        const conflicts = await recoverCliOperations(storage, journalId);
        if (conflicts.length)
          throw new Error(
            'Client apply failed; external changes were preserved and require review'
          );
        throw error;
      }
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
  });
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
  if (previous.exists) await backupConfigFile(pathname, previous.content);
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
  for (const item of originals) {
    if (item.state.exists) {
      await backupConfigFile(item.state.path, item.state.content);
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
