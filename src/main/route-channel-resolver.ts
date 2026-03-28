/**
 * 路由通道解析器
 * 输入: RouteRule + canonicalModel, UnifiedConfig (站点/账户/API Keys)
 * 输出: 满足约束的候选通道列表（含 resolvedModel）
 * 定位: 服务层 - 候选通道筛选与凭证解析
 */

import { unifiedConfigManager } from './unified-config-manager';
import { resolveRawModelForChannel } from './route-model-registry-service';
import type { RouteRule, RouteChannelKey, RouteCliType } from '../shared/types/route-proxy';
import type { AccountCredential, ApiKeyInfo, UnifiedSite } from '../shared/types/site';
import { createHash } from 'crypto';
import type { TokenService } from './token-service';

export type ResolvedChannel = RouteChannelKey & {
  cliType: RouteCliType;
  canonicalModel?: string;
  resolvedModel?: string;
};

let routeTokenService: TokenService | null = null;

export function configureRouteApiKeyResolver(tokenService: TokenService): void {
  routeTokenService = tokenService;
}

export function isRouteMaskedApiKeyValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  return normalized.includes('*') || normalized.includes('...') || normalized.includes('…');
}

export function resolveApiKeyId(info: ApiKeyInfo): string {
  if (info.id !== undefined && info.id !== null) return String(info.id);
  if (info.token_id !== undefined && info.token_id !== null) return String(info.token_id);
  const raw = info.key || info.token || '';
  if (raw) return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return 'unknown';
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

function resolveBrowserSlot(accountId: string): number | undefined {
  const account = unifiedConfigManager.getAccountById(accountId);
  if (!account) {
    return undefined;
  }

  const siteAccounts = unifiedConfigManager.getAccountsBySiteId(account.site_id);
  const slotIndex = siteAccounts.findIndex(item => item.id === accountId);
  return slotIndex >= 0 ? slotIndex : 0;
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
  if (currentValue && !isRouteMaskedApiKeyValue(currentValue)) {
    return currentValue;
  }

  if (!routeTokenService) {
    return null;
  }

  const userId = Number(account.user_id || site.user_id || 0);
  const accessToken = account.access_token || site.access_token || '';
  if (!userId || !accessToken) {
    return null;
  }

  const resolvedValue = await routeTokenService.resolveUsableApiKeyValue(
    site.url,
    userId,
    accessToken,
    info,
    {
      browserSlot: resolveBrowserSlot(account.id),
      allowBrowserFallback: true,
      challengeWaitMs: 10000,
    }
  );

  if (!resolvedValue) {
    return null;
  }

  if (!isRouteMaskedApiKeyValue(resolvedValue) && resolvedValue !== currentValue) {
    await persistResolvedApiKeyValue(account.id, resolveApiKeyId(info), resolvedValue);
  }

  return resolvedValue;
}

/**
 * 解析候选通道列表（支持 canonical model 过滤）
 */
export function resolveChannels(
  rule: RouteRule,
  canonicalModel?: string | null
): ResolvedChannel[] {
  const unifiedConfig = unifiedConfigManager.exportConfigSync();
  if (!unifiedConfig) return [];

  const { sites, accounts } = unifiedConfig;
  const channels: ResolvedChannel[] = [];

  for (const site of sites) {
    if (!site.enabled) continue;
    if (rule.allowedSiteIds?.length && !rule.allowedSiteIds.includes(site.id)) continue;

    const siteAccounts = accounts.filter(a => a.site_id === site.id && a.status === 'active');

    for (const account of siteAccounts) {
      if (rule.allowedAccountIds?.length && !rule.allowedAccountIds.includes(account.id)) continue;

      const compat = account.cached_data?.cli_compatibility;
      if (compat && compat[rule.cliType] === false) continue;

      // canonical model 过滤：检查该通道是否支持
      let resolvedModel: string | undefined;
      if (canonicalModel) {
        const raw = resolveRawModelForChannel({
          canonicalName: canonicalModel,
          siteId: site.id,
          accountId: account.id,
          cliType: rule.cliType,
        });
        if (!raw) continue; // 通道不支持此 canonical model
        resolvedModel = raw;
      }

      const apiKeys: ApiKeyInfo[] = account.cached_data?.api_keys || [];
      if (apiKeys.length === 0) {
        if (site.api_key && !isRouteMaskedApiKeyValue(site.api_key)) {
          const keyId = createHash('sha256').update(site.api_key).digest('hex').slice(0, 16);
          channels.push({
            routeRuleId: rule.id,
            siteId: site.id,
            accountId: account.id,
            apiKeyId: keyId,
            cliType: rule.cliType,
            canonicalModel: canonicalModel || undefined,
            resolvedModel,
          });
        }
        continue;
      }

      for (const apiKey of apiKeys) {
        if (apiKey.status !== undefined && apiKey.status !== 1) continue;
        if (rule.allowedApiKeyGroups?.length) {
          if (!apiKey.group || !rule.allowedApiKeyGroups.includes(apiKey.group)) continue;
        }

        channels.push({
          routeRuleId: rule.id,
          siteId: site.id,
          accountId: account.id,
          apiKeyId: resolveApiKeyId(apiKey),
          cliType: rule.cliType,
          canonicalModel: canonicalModel || undefined,
          resolvedModel,
        });
      }
    }
  }

  return channels;
}

/** 判断通道是否支持某 canonical model */
export function canChannelServeModel(params: {
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  canonicalModel: string;
}): boolean {
  return (
    resolveRawModelForChannel({
      canonicalName: params.canonicalModel,
      siteId: params.siteId,
      accountId: params.accountId,
      cliType: params.cliType,
    }) !== null
  );
}

/** 解析通道凭证 */
export async function resolveChannelCredentials(
  siteId: string,
  accountId: string,
  apiKeyId: string
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const unifiedConfig = unifiedConfigManager.exportConfigSync();
  if (!unifiedConfig) return null;

  const site = unifiedConfig.sites.find(s => s.id === siteId);
  if (!site) return null;

  const account = unifiedConfig.accounts.find(a => a.id === accountId);
  if (!account) return null;

  const apiKeys: ApiKeyInfo[] = account.cached_data?.api_keys || [];

  for (const info of apiKeys) {
    if (resolveApiKeyId(info) === apiKeyId) {
      const rawKey = await resolveAccountApiKeyValue(site, account, info);
      if (!rawKey) {
        return null;
      }
      return { baseUrl: site.url, apiKey: rawKey };
    }
  }

  if (site.api_key) {
    const keyId = createHash('sha256').update(site.api_key).digest('hex').slice(0, 16);
    if (keyId === apiKeyId && !isRouteMaskedApiKeyValue(site.api_key)) {
      return { baseUrl: site.url, apiKey: site.api_key };
    }
  }

  return null;
}
