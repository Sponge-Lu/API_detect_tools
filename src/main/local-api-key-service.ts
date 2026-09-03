import { randomUUID } from 'crypto';
import type { LocalApiKeyRecord } from '../shared/types/site';
import { normalizeCircledGroupLabel } from '../shared/utils/groupLabel';
import { unifiedConfigManager } from './unified-config-manager';
import { httpGet } from './utils/http-client';

const MODEL_FETCH_TIMEOUT_MS = 10000;

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
  await unifiedConfigManager.loadConfig();
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
  await unifiedConfigManager.updateAccount(accountId, {
    local_api_keys: [...(account.local_api_keys || []), record],
  });
  return listLocalApiKeys(accountId);
}

export async function updateLocalApiKey(
  accountId: string,
  keyId: string,
  input: LocalApiKeyInput
): Promise<LocalApiKeyView[]> {
  const account = await requireAccount(accountId);
  const normalized = normalizeInput(input);
  let found = false;
  const records = (account.local_api_keys || []).map(item => {
    if (item.id !== keyId) return item;
    found = true;
    return { ...item, ...normalized, updatedAt: Date.now() };
  });
  if (!found) throw new Error(`API key not found: ${keyId}`);
  await unifiedConfigManager.updateAccount(accountId, { local_api_keys: records });
  return listLocalApiKeys(accountId);
}

export async function deleteLocalApiKey(
  accountId: string,
  keyId: string
): Promise<LocalApiKeyView[]> {
  const account = await requireAccount(accountId);
  const records = (account.local_api_keys || []).filter(item => item.id !== keyId);
  if (records.length === (account.local_api_keys || []).length) {
    throw new Error(`API key not found: ${keyId}`);
  }
  await unifiedConfigManager.updateAccount(accountId, { local_api_keys: records });
  return listLocalApiKeys(accountId);
}

async function fetchModels(baseUrl: string, record: LocalApiKeyRecord): Promise<string[]> {
  const response = await httpGet(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
    timeout: MODEL_FETCH_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${record.key}`, 'Content-Type': 'application/json' },
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
    try {
      const models = await fetchModels(baseUrl, record);
      record.models = models;
      record.modelsFetchedAt = Date.now();
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
    await unifiedConfigManager.updateAccount(accountId, { local_api_keys: records });
  }
  return {
    keys: records.map(toView),
    models: Array.from(new Set(records.flatMap(record => record.models))),
    results,
  };
}
