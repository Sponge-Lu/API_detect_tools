/**
 * 路由通道解析器
 * 输入: RouteRule + canonicalModel, UnifiedConfig (站点/账户/API Keys)
 * 输出: 满足约束的候选通道列表（含 resolvedModel）
 * 定位: 服务层 - 候选通道筛选与凭证解析
 */

import { unifiedConfigManager } from './unified-config-manager';
import { resolveApiKeyId } from './route-model-registry-service';
import type {
  RouteRule,
  RouteChannelKey,
  RouteCliType,
  RouteModelDisplayItem,
  RouteModelRegistryConfig,
  RouteModelRegistryEntry,
  RouteModelSourceRef,
} from '../shared/types/route-proxy';
import {
  buildRouteVendorApiKeyPriorityKey,
  DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY,
  DEFAULT_ROUTE_VENDOR_SITE_PRIORITY,
} from '../shared/types/route-proxy';
import type { AccountCredential, ApiKeyInfo, UnifiedSite } from '../shared/types/site';
import type { TokenService } from './token-service';

export type ResolvedChannel = RouteChannelKey & {
  cliType: RouteCliType;
  canonicalModel?: string;
  resolvedModel?: string;
  sitePriority?: number;
  apiKeyPriority?: number;
  siteOrder?: number;
  apiKeyOrder?: number;
  originalModelIndex?: number;
};

function getProbeCompatibilityStatus(
  siteId: string,
  accountId: string,
  cliType: RouteCliType
): boolean | null {
  const routing = unifiedConfigManager.getRoutingConfig();
  const latestEntries = Object.values(routing.cliProbe.latest).filter(
    entry => entry.siteId === siteId && entry.accountId === accountId && entry.cliType === cliType
  );

  if (latestEntries.length === 0) {
    return null;
  }

  return latestEntries.some(entry => entry.lastSample.success);
}

function getRegistrySourcePool(registry: RouteModelRegistryConfig): RouteModelSourceRef[] {
  if (registry.sources.length > 0) {
    return registry.sources;
  }

  const dedupedSources = new Map<string, RouteModelSourceRef>();
  for (const entry of Object.values(registry.entries)) {
    for (const source of entry.sources) {
      if (!dedupedSources.has(source.sourceKey)) {
        dedupedSources.set(source.sourceKey, source);
      }
    }
  }

  return Array.from(dedupedSources.values());
}

function normalizeOriginalModelOrder(
  originalModelOrder: string[] | undefined,
  sourceKeys: string[],
  sourceByKey: Map<string, RouteModelSourceRef>
): string[] {
  const availableModels = sourceKeys
    .map(sourceKey => sourceByKey.get(sourceKey)?.originalModel)
    .filter((model): model is string => !!model);
  const availableModelSet = new Set(availableModels);
  const normalized = Array.from(
    new Set(
      (originalModelOrder || [])
        .map(model => model.trim())
        .filter(model => model.length > 0 && availableModelSet.has(model))
    )
  );

  for (const model of availableModels) {
    if (!normalized.includes(model)) {
      normalized.push(model);
    }
  }

  return normalized;
}

function buildCanonicalDisplayItems(
  registry: RouteModelRegistryConfig,
  entry: RouteModelRegistryEntry
): RouteModelDisplayItem[] {
  const matchedItems = registry.displayItems.filter(
    item => item.canonicalName === entry.canonicalName
  );
  if (matchedItems.length > 0) {
    return matchedItems;
  }

  return [
    {
      id: `fallback:${entry.vendor}:${entry.canonicalName}`,
      vendor: entry.vendor,
      canonicalName: entry.canonicalName,
      sourceKeys: entry.sources.map(source => source.sourceKey),
      originalModelOrder: Array.from(new Set(entry.sources.map(source => source.originalModel))),
      mode: 'seeded',
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
  ];
}

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

function buildCanonicalModelChannels(
  rule: RouteRule,
  canonicalModel: string,
  unifiedConfig: ReturnType<typeof unifiedConfigManager.exportConfigSync>
): ResolvedChannel[] | null {
  if (!unifiedConfig) {
    return [];
  }

  const routing = unifiedConfigManager.getRoutingConfig();
  const registry = routing.modelRegistry;
  const entry = registry.entries[canonicalModel];
  if (!entry) {
    return null;
  }

  const sourceByKey = new Map(
    getRegistrySourcePool(registry).map(source => [source.sourceKey, source] as const)
  );
  const displayItems = buildCanonicalDisplayItems(registry, entry);
  const activeSiteById = new Map(
    unifiedConfig.sites.filter(site => site.enabled).map(site => [site.id, site] as const)
  );
  const activeAccountById = new Map(
    unifiedConfig.accounts
      .filter(account => account.status === 'active')
      .map(account => [account.id, account] as const)
  );
  const vendorPriorityConfig = registry.vendorPriorities[entry.vendor] || {
    sitePriorities: {},
    apiKeyPriorities: {},
  };

  const combinedOriginalModelOrder: string[] = [];
  const siteOrderById = new Map<string, number>();
  let nextSiteOrder = 0;
  let nextApiKeyOrder = 0;
  const channelGroups = new Map<
    string,
    {
      siteId: string;
      accountId: string;
      apiKeyId: string;
      siteOrder: number;
      apiKeyOrder: number;
      sitePriority: number;
      apiKeyPriority: number;
      originalModels: Set<string>;
    }
  >();

  for (const item of displayItems) {
    const orderedSourceKeys = item.sourceKeys.slice().sort((left, right) => {
      const originalOrder = normalizeOriginalModelOrder(
        item.originalModelOrder,
        item.sourceKeys,
        sourceByKey
      );
      const orderIndex = new Map(originalOrder.map((model, index) => [model, index]));
      const leftSource = sourceByKey.get(left);
      const rightSource = sourceByKey.get(right);
      const leftIndex = leftSource
        ? (orderIndex.get(leftSource.originalModel) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      const rightIndex = rightSource
        ? (orderIndex.get(rightSource.originalModel) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.localeCompare(right);
    });

    for (const model of normalizeOriginalModelOrder(
      item.originalModelOrder,
      orderedSourceKeys,
      sourceByKey
    )) {
      if (!combinedOriginalModelOrder.includes(model)) {
        combinedOriginalModelOrder.push(model);
      }
    }

    for (const sourceKey of orderedSourceKeys) {
      const source = sourceByKey.get(sourceKey);
      if (!source?.accountId) {
        continue;
      }

      const site = activeSiteById.get(source.siteId);
      const account = activeAccountById.get(source.accountId);
      if (!site || !account) {
        continue;
      }

      if (rule.allowedSiteIds?.length && !rule.allowedSiteIds.includes(site.id)) {
        continue;
      }

      if (rule.allowedAccountIds?.length && !rule.allowedAccountIds.includes(account.id)) {
        continue;
      }

      const compat = getProbeCompatibilityStatus(site.id, account.id, rule.cliType);
      if (compat === false) {
        continue;
      }

      const availableApiKeys = (source.availableApiKeys || []).filter(apiKey => {
        if (apiKey.accountId !== account.id) {
          return false;
        }

        if (rule.allowedApiKeyGroups?.length && !rule.allowedApiKeyGroups.includes(apiKey.group)) {
          return false;
        }

        return true;
      });

      for (const availableApiKey of availableApiKeys) {
        if (!siteOrderById.has(site.id)) {
          siteOrderById.set(site.id, nextSiteOrder++);
        }

        const channelKey = `${site.id}:${account.id}:${availableApiKey.apiKeyId}`;
        if (!channelGroups.has(channelKey)) {
          channelGroups.set(channelKey, {
            siteId: site.id,
            accountId: account.id,
            apiKeyId: availableApiKey.apiKeyId,
            siteOrder: siteOrderById.get(site.id)!,
            apiKeyOrder: nextApiKeyOrder++,
            sitePriority:
              vendorPriorityConfig.sitePriorities[site.id] ?? DEFAULT_ROUTE_VENDOR_SITE_PRIORITY,
            apiKeyPriority:
              vendorPriorityConfig.apiKeyPriorities[
                buildRouteVendorApiKeyPriorityKey(site.id, account.id, availableApiKey.apiKeyId)
              ] ?? DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY,
            originalModels: new Set<string>(),
          });
        }

        channelGroups.get(channelKey)!.originalModels.add(source.originalModel);
      }
    }
  }

  const channels: ResolvedChannel[] = [];
  for (const group of channelGroups.values()) {
    const orderedOriginalModels = combinedOriginalModelOrder.filter(model =>
      group.originalModels.has(model)
    );

    for (const model of Array.from(group.originalModels).sort((left, right) =>
      left.localeCompare(right)
    )) {
      if (!orderedOriginalModels.includes(model)) {
        orderedOriginalModels.push(model);
      }
    }

    orderedOriginalModels.forEach((resolvedModel, originalModelIndex) => {
      channels.push({
        routeRuleId: rule.id,
        siteId: group.siteId,
        accountId: group.accountId,
        apiKeyId: group.apiKeyId,
        cliType: rule.cliType,
        canonicalModel,
        resolvedModel,
        sitePriority: group.sitePriority,
        apiKeyPriority: group.apiKeyPriority,
        siteOrder: group.siteOrder,
        apiKeyOrder: group.apiKeyOrder,
        originalModelIndex,
      });
    });
  }

  return channels;
}

function buildGenericChannels(
  rule: RouteRule,
  canonicalModel: string | null | undefined,
  unifiedConfig: ReturnType<typeof unifiedConfigManager.exportConfigSync>
): ResolvedChannel[] {
  if (!unifiedConfig) {
    return [];
  }

  const channels: ResolvedChannel[] = [];
  let nextSiteOrder = 0;
  let nextApiKeyOrder = 0;

  for (const site of unifiedConfig.sites) {
    if (!site.enabled) {
      continue;
    }

    if (rule.allowedSiteIds?.length && !rule.allowedSiteIds.includes(site.id)) {
      continue;
    }

    const siteAccounts = unifiedConfig.accounts.filter(
      account => account.site_id === site.id && account.status === 'active'
    );

    for (const account of siteAccounts) {
      if (rule.allowedAccountIds?.length && !rule.allowedAccountIds.includes(account.id)) {
        continue;
      }

      const compat = getProbeCompatibilityStatus(site.id, account.id, rule.cliType);
      if (compat === false) {
        continue;
      }

      const apiKeys: ApiKeyInfo[] = account.cached_data?.api_keys || [];
      if (apiKeys.length === 0) {
        if (site.api_key && !isRouteMaskedApiKeyValue(site.api_key)) {
          channels.push({
            routeRuleId: rule.id,
            siteId: site.id,
            accountId: account.id,
            apiKeyId: resolveApiKeyId({ key: site.api_key }),
            cliType: rule.cliType,
            canonicalModel: canonicalModel || undefined,
            resolvedModel: canonicalModel || undefined,
            sitePriority: DEFAULT_ROUTE_VENDOR_SITE_PRIORITY,
            apiKeyPriority: DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY,
            siteOrder: nextSiteOrder,
            apiKeyOrder: nextApiKeyOrder++,
            originalModelIndex: 0,
          });
        }
        continue;
      }

      for (const apiKey of apiKeys) {
        if (apiKey.status !== undefined && Number(apiKey.status) !== 1) {
          continue;
        }

        if (rule.allowedApiKeyGroups?.length) {
          if (!apiKey.group || !rule.allowedApiKeyGroups.includes(apiKey.group)) {
            continue;
          }
        }

        channels.push({
          routeRuleId: rule.id,
          siteId: site.id,
          accountId: account.id,
          apiKeyId: resolveApiKeyId(apiKey),
          cliType: rule.cliType,
          canonicalModel: canonicalModel || undefined,
          resolvedModel: canonicalModel || undefined,
          sitePriority: DEFAULT_ROUTE_VENDOR_SITE_PRIORITY,
          apiKeyPriority: DEFAULT_ROUTE_VENDOR_API_KEY_PRIORITY,
          siteOrder: nextSiteOrder,
          apiKeyOrder: nextApiKeyOrder++,
          originalModelIndex: 0,
        });
      }
    }

    nextSiteOrder += 1;
  }

  return channels;
}

/**
 * 解析候选通道列表（支持 canonical model 过滤）
 */
export function resolveChannels(
  rule: RouteRule,
  canonicalModel?: string | null
): ResolvedChannel[] {
  const unifiedConfig = unifiedConfigManager.exportConfigSync();
  if (!unifiedConfig) {
    return [];
  }

  if (canonicalModel) {
    const canonicalChannels = buildCanonicalModelChannels(rule, canonicalModel, unifiedConfig);
    if (canonicalChannels) {
      return canonicalChannels;
    }
  }

  return buildGenericChannels(rule, canonicalModel, unifiedConfig);
}

/** 判断通道是否支持某 canonical model */
export function canChannelServeModel(params: {
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  canonicalModel: string;
}): boolean {
  const registry = unifiedConfigManager.getRoutingConfig().modelRegistry;
  const entry = registry.entries[params.canonicalModel];
  if (!entry) {
    return false;
  }

  const sourceByKey = new Map(
    getRegistrySourcePool(registry).map(source => [source.sourceKey, source] as const)
  );

  return buildCanonicalDisplayItems(registry, entry).some(item =>
    item.sourceKeys.some(sourceKey => {
      const source = sourceByKey.get(sourceKey);
      return (
        source?.siteId === params.siteId &&
        source.accountId === params.accountId &&
        (source.availableApiKeys?.length ?? 0) > 0
      );
    })
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
    const keyId = resolveApiKeyId({ key: site.api_key });
    if (keyId === apiKeyId && !isRouteMaskedApiKeyValue(site.api_key)) {
      return { baseUrl: site.url, apiKey: site.api_key };
    }
  }

  return null;
}
