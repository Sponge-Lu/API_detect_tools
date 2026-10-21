/**
 * 上游凭证解析器
 * 输入: 站点、账户和 API Key 标识
 * 输出: 真实上游 Base URL、API Key 与鉴权方案
 * 定位: 中性配置/凭证层；不启动路由、不选择通道、不记录路由运行态
 */

import { unifiedConfigManager } from './unified-config-manager';
import { loadCustomCliConfigStorage } from './custom-cli-config-service';
import { normalizeCustomCliApiKeys } from '../shared/types/custom-cli-config';
import type { AccountCredential, ApiKeyInfo, UnifiedSite } from '../shared/types/site';
import type { TokenService } from './token-service';
import { resolveApiKeyId } from './api-key-identity';
import { browserProfileManager } from './browser-profile-manager';
import { resolveApiKeyForUse } from '../shared/utils/apiConfig';
import { isApiKeyActive } from '../shared/types/site';

export type UpstreamAuthScheme = 'bearer' | 'x-api-key';
export type UpstreamCredentialTarget =
  | { kind: 'managed'; siteId: string; accountId: string; apiKeyId: string }
  | { kind: 'direct'; configId: string; apiKeyId?: string };
type ApiKeyValueResolver = Pick<TokenService, 'resolveUsableApiKeyValue'>;

let configuredTokenService: ApiKeyValueResolver | null = null;

export function configureUpstreamApiKeyResolver(tokenService: ApiKeyValueResolver): void {
  configuredTokenService = tokenService;
}

export function isMaskedApiKeyValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return normalized.includes('*') || normalized.includes('...') || normalized.includes('…');
}

function getStoredApiKeyValue(info: ApiKeyInfo | null | undefined): string {
  return info?.key || info?.token || '';
}

function withStoredApiKeyValue(info: ApiKeyInfo, rawKey: string): ApiKeyInfo {
  if ('token' in info && !('key' in info)) {
    return { ...info, token: rawKey };
  }

  return { ...info, key: rawKey };
}

async function resolveBrowserSlot(accountId: string): Promise<number | undefined> {
  const account = unifiedConfigManager.getAccountById(accountId);
  if (!account) {
    return undefined;
  }

  return (
    (await browserProfileManager.ensureAutomationSlot(account.site_id, accountId)) ?? undefined
  );
}

async function persistResolvedApiKeyValue(
  accountId: string,
  apiKeyId: string,
  rawKey: string
): Promise<void> {
  await unifiedConfigManager.updateAccountCachedData(accountId, current => {
    const currentApiKeys = current?.api_keys || [];
    return {
      ...(current || {}),
      api_keys: currentApiKeys.map(item =>
        resolveApiKeyId(item) === apiKeyId ? withStoredApiKeyValue(item, rawKey) : item
      ),
      last_refresh: Date.now(),
    };
  });
}

export async function resolveAccountApiKeyValue(
  site: UnifiedSite,
  account: AccountCredential,
  info: ApiKeyInfo
): Promise<string | null> {
  const currentValue = getStoredApiKeyValue(info);
  if (currentValue && !isMaskedApiKeyValue(currentValue)) {
    return resolveApiKeyForUse(currentValue, 'remote') || null;
  }

  if (!configuredTokenService) {
    return null;
  }

  const userId = Number(account.user_id || site.user_id || 0);
  const accessToken = account.access_token || site.access_token || '';
  if (!userId || !accessToken) {
    return null;
  }

  const resolvedValue = await configuredTokenService.resolveUsableApiKeyValue(
    site.url,
    userId,
    accessToken,
    info,
    {
      browserSlot: await resolveBrowserSlot(account.id),
      allowBrowserFallback: true,
      challengeWaitMs: 10000,
    }
  );

  if (!resolvedValue) {
    return null;
  }

  if (!isMaskedApiKeyValue(resolvedValue) && resolvedValue !== currentValue) {
    await persistResolvedApiKeyValue(account.id, resolveApiKeyId(info), resolvedValue);
  }

  return resolveApiKeyForUse(resolvedValue, 'remote') || null;
}

export async function resolveUpstreamCredentials(
  target: UpstreamCredentialTarget
): Promise<{ baseUrl: string; apiKey: string; authScheme?: UpstreamAuthScheme } | null> {
  if (target.kind === 'direct') {
    const storage = await loadCustomCliConfigStorage();
    const config = storage.configs.find(item => item.id === target.configId);
    const baseUrl = config?.baseUrl?.trim();
    const apiKeys = normalizeCustomCliApiKeys(config?.apiKeys, {
      legacyApiKey: config?.apiKey,
      legacyName: config?.name,
      legacyGroupMultiplier: config?.groupMultiplier,
    });
    const apiKey = (
      target.apiKeyId
        ? apiKeys.find(item => item.id === target.apiKeyId)?.key
        : config?.apiKey || apiKeys[0]?.key
    )?.trim();
    if (!baseUrl || !apiKey || isMaskedApiKeyValue(apiKey)) {
      return null;
    }

    return { baseUrl, apiKey, authScheme: config?.routeAuthScheme };
  }

  const unifiedConfig = unifiedConfigManager.exportConfigSync();
  if (!unifiedConfig) return null;

  const site = unifiedConfig.sites.find(item => item.id === target.siteId);
  if (!site) return null;

  const account = unifiedConfig.accounts.find(item => item.id === target.accountId);
  if (!account || account.site_id !== site.id) return null;

  const apiKeys: ApiKeyInfo[] = account.cached_data?.api_keys || [];

  for (const info of apiKeys) {
    if (resolveApiKeyId(info) === target.apiKeyId) {
      const rawKey = await resolveAccountApiKeyValue(site, account, info);
      if (!rawKey) {
        return null;
      }
      return { baseUrl: site.url, apiKey: rawKey, authScheme: account.routeAuthScheme };
    }
  }

  const localApiKey = (account.local_api_keys || []).find(info => info.id === target.apiKeyId);
  if (
    localApiKey &&
    isApiKeyActive({ enabled: localApiKey.status }) &&
    resolveApiKeyForUse(localApiKey.key, localApiKey.source)
  ) {
    return {
      baseUrl: site.url,
      apiKey: resolveApiKeyForUse(localApiKey.key, localApiKey.source),
      authScheme: account.routeAuthScheme,
    };
  }

  const legacyKey = account.api_key || site.api_key;
  if (legacyKey) {
    const keyId = resolveApiKeyId({ key: legacyKey });
    if (keyId === target.apiKeyId && !isMaskedApiKeyValue(legacyKey)) {
      return {
        baseUrl: site.url,
        apiKey: resolveApiKeyForUse(legacyKey),
        authScheme: account.routeAuthScheme,
      };
    }
  }

  return null;
}
