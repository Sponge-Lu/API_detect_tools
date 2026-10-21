import { randomUUID } from 'crypto';
import type { LocalApiKeyRecord } from '../shared/types/site';
import { normalizeCircledGroupLabel } from '../shared/utils/groupLabel';
import { unifiedConfigManager } from './unified-config-manager';
import { httpGet } from './utils/http-client';
import {
  buildApiKeyHeaders,
  buildVersionedApiUrl,
  resolveApiKeyForUse,
} from '../shared/utils/apiConfig';
import type { RouteAuthScheme } from '../shared/types/site';

const MODEL_FETCH_TIMEOUT_MS = 10000;
const accountMutationQueues = new Map<string, Promise<unknown>>();

async function serializeAccountMutation<T>(
  accountId: string,
  operation: () => Promise<T>
): Promise<T> {
  const task = (accountMutationQueues.get(accountId) || Promise.resolve()).then(
    operation,
    operation
  );
  accountMutationQueues.set(accountId, task);
  try {
    return await task;
  } finally {
    if (accountMutationQueues.get(accountId) === task) accountMutationQueues.delete(accountId);
  }
}

async function saveAccountKeys(accountId: string, records: LocalApiKeyRecord[]): Promise<void> {
  if (!(await unifiedConfigManager.updateAccount(accountId, { local_api_keys: records }))) {
    throw new Error(`Account not found: ${accountId}`);
  }
}

export type LocalApiKeyInput = Pick<
  LocalApiKeyRecord,
  'name' | 'key' | 'group' | 'groupMultiplier'
>;

export interface LocalApiKeyView extends Omit<LocalApiKeyRecord, 'key'> {
  maskedKey: string;
}

export interface LocalApiKeyRefreshResult {
  keyId: string;
  success: boolean;
  models: string[];
  error?: string;
}

function maskKey(key: string): string {
  if (key.length <= 10) return `${key.slice(0, 2)}****${key.slice(-2)}`;
  return `${key.slice(0, 6)}****${key.slice(-4)}`;
}

function toView(record: LocalApiKeyRecord): LocalApiKeyView {
  const { key, ...rest } = record;
  return { ...rest, maskedKey: maskKey(key) };
}

function normalizeInput(input: LocalApiKeyInput): LocalApiKeyInput {
  const key = input.key.trim();
  if (!key) throw new Error('API Key 不能为空');
  const multiplier = Number(input.groupMultiplier);
  return {
    name: input.name.trim() || '未命名 API Key',
    key,
    group: normalizeCircledGroupLabel(input.group),
    groupMultiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1,
  };
}

async function requireAccount(accountId: string) {
  await unifiedConfigManager.getConfig();
  const account = unifiedConfigManager.getAccountById(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  return account;
}

function extractModels(payload: unknown): string[] {
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return Array.from(
    new Set(
      values
        .map(item => {
          if (typeof item === 'string') return item;
          if (!item || typeof item !== 'object') return '';
          const value = item as { id?: unknown; name?: unknown };
          return typeof value.id === 'string'
            ? value.id
            : typeof value.name === 'string'
              ? value.name
              : '';
        })
        .filter(Boolean)
    )
  );
}

export async function listLocalApiKeys(accountId: string): Promise<LocalApiKeyView[]> {
  const account = await requireAccount(accountId);
  return (account.local_api_keys || []).map(toView);
}

export async function revealLocalApiKey(accountId: string, keyId: string): Promise<string> {
  const account = await requireAccount(accountId);
  const record = (account.local_api_keys || []).find(item => item.id === keyId);
  if (!record) throw new Error(`API key not found: ${keyId}`);
  return record.key;
}

export async function addLocalApiKey(
  accountId: string,
  input: LocalApiKeyInput
): Promise<LocalApiKeyView[]> {
  return serializeAccountMutation(accountId, async () => {
    const account = await requireAccount(accountId);
    const normalized = normalizeInput(input);
    const now = Date.now();
    const record: LocalApiKeyRecord = {
      id: `local_${randomUUID()}`,
      ...normalized,
      models: [],
      source: 'local',
      createdAt: now,
      updatedAt: now,
    };
    await saveAccountKeys(accountId, [...(account.local_api_keys || []), record]);
    return listLocalApiKeys(accountId);
  });
}

export async function updateLocalApiKey(
  accountId: string,
  keyId: string,
  input: LocalApiKeyInput
): Promise<LocalApiKeyView[]> {
  return serializeAccountMutation(accountId, async () => {
    const account = await requireAccount(accountId);
    const normalized = normalizeInput(input);
    let found = false;
    const records = (account.local_api_keys || []).map(item => {
      if (item.id !== keyId) return item;
      found = true;
      return {
        ...item,
        ...normalized,
        source: 'local' as const,
        updatedAt: Date.now(),
        ...(item.key !== normalized.key ? { models: [], modelsFetchedAt: undefined } : {}),
      };
    });
    if (!found) throw new Error(`API key not found: ${keyId}`);
    await saveAccountKeys(accountId, records);
    return listLocalApiKeys(accountId);
  });
}

export async function deleteLocalApiKey(
  accountId: string,
  keyId: string
): Promise<LocalApiKeyView[]> {
  return serializeAccountMutation(accountId, async () => {
    const account = await requireAccount(accountId);
    const records = (account.local_api_keys || []).filter(item => item.id !== keyId);
    if (records.length === (account.local_api_keys || []).length) {
      throw new Error(`API key not found: ${keyId}`);
    }
    await saveAccountKeys(accountId, records);
    return listLocalApiKeys(accountId);
  });
}

async function fetchModels(
  baseUrl: string,
  record: LocalApiKeyRecord,
  authScheme?: RouteAuthScheme
): Promise<string[]> {
  const apiKey = resolveApiKeyForUse(record.key, record.source);
  if (!apiKey) throw new Error('API Key 为空或被掩码隐藏');
  const response = await httpGet(buildVersionedApiUrl(baseUrl, 'models'), {
    timeout: MODEL_FETCH_TIMEOUT_MS,
    headers: { ...buildApiKeyHeaders(apiKey, authScheme), 'Content-Type': 'application/json' },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  const models = extractModels(response.data);
  if (models.length === 0) throw new Error('模型列表为空或无法解析');
  return models;
}

export async function refreshLocalApiKeys(
  accountId: string,
  baseUrl: string,
  keyId?: string
): Promise<{ keys: LocalApiKeyView[]; models: string[]; results: LocalApiKeyRefreshResult[] }> {
  const account = await requireAccount(accountId);
  const records = (account.local_api_keys || []).map(item => ({ ...item }));
  const targets = keyId ? records.filter(item => item.id === keyId) : records;
  if (keyId && targets.length === 0) throw new Error(`API key not found: ${keyId}`);
  const results: LocalApiKeyRefreshResult[] = [];
  for (const record of targets) {
    const requestStartedAt = Date.now();
    try {
      const models = await fetchModels(baseUrl, record, account.routeAuthScheme);
      record.models = models;
      record.modelsFetchedAt = requestStartedAt;
      record.updatedAt = Date.now();
      results.push({ keyId: record.id, success: true, models });
    } catch (error) {
      results.push({
        keyId: record.id,
        success: false,
        models: record.models,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (results.some(result => result.success)) {
    await serializeAccountMutation(accountId, async () => {
      const latest = unifiedConfigManager.getAccountById(accountId);
      const site = unifiedConfigManager
        .exportConfigSync()
        ?.sites.find(item => item.id === latest?.site_id);
      if (!latest || site?.url !== baseUrl || latest.routeAuthScheme !== account.routeAuthScheme) {
        throw new Error('配置已变更，请重新刷新模型');
      }
      const merged = (latest.local_api_keys || []).map(key => {
        const fetched = records.find(item => item.id === key.id && item.key === key.key);
        if (!fetched || !results.some(result => result.keyId === key.id && result.success))
          return key;
        if ((key.modelsFetchedAt || 0) > (fetched.modelsFetchedAt || 0)) return key;
        return { ...key, models: fetched.models, modelsFetchedAt: fetched.modelsFetchedAt };
      });
      await saveAccountKeys(accountId, merged);
      records.splice(0, records.length, ...merged);
    });
  }
  const latestRecords = (await requireAccount(accountId)).local_api_keys || [];
  return {
    keys: latestRecords.map(toView),
    models: Array.from(new Set(latestRecords.flatMap(record => record.models))),
    results,
  };
}
