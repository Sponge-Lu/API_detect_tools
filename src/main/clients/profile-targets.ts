import { resolveApiKeyForUse } from '../../shared/utils/apiConfig';

import type {
  ConfigFileProfile,
  ConfigFileTargetCatalogEntry,
  ConfigFileResolvedTargetValues,
} from '../../shared/types/config-file-profile';
import { normalizeConfigFileAuthMode } from '../../shared/types/config-file-profile';
import { normalizeCliTargetProtocol } from '../../shared/types/cli-config';

import { BUILTIN_GROUP_IDS, isApiKeyActive } from '../../shared/types/site';
import { isDshConfigProfile } from '../../shared/config/dsh-client-config';

import { resolveDshProfileConfig } from '../dsh-config-file-profile';

export async function resolveProfileValues(
  profile: ConfigFileProfile
): Promise<ConfigFileResolvedTargetValues> {
  if (isDshConfigProfile(profile)) return (await resolveDshProfileConfig(profile)).values;
  if (normalizeConfigFileAuthMode(profile.authMode) === 'official') {
    return {
      baseUrl: '',
      apiKey: '',
      model: profile.target.model || '',
      targetLabel: '官方账号登录',
      apiKeyName: '',
    };
  }
  const target = profile.target;
  const { unifiedConfigManager } = await import('../unified-config-manager');
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
    const { loadCustomCliConfigStorage } = await import('../custom-cli-config-service');
    const storage = await loadCustomCliConfigStorage();
    const config = storage.configs.find(item => item.id === target.configId);
    if (!config || !config.baseUrl.trim() || !resolveApiKeyForUse(config.apiKey))
      throw new Error('直连配置不可用');
    return {
      baseUrl: config.baseUrl,
      apiKey: resolveApiKeyForUse(config.apiKey),
      model: target.model || config.models[0] || config.manualModels?.[0] || '',
      targetLabel: catalogEntry.label,
      apiKeyName: config.name.trim() || '直连 API Key',
    };
  }
  const site = unifiedConfigManager.getSiteById(target.siteId);
  const account = unifiedConfigManager.getAccountById(target.accountId);
  if (!site || !account || account.site_id !== target.siteId) throw new Error('站点账户不存在');
  const legacyKey = account.api_key || site.api_key;
  const localKey = account.local_api_keys?.find(item => item.id === target.apiKeyId);
  const apiKeys = account.cached_data?.api_keys || [];
  const { resolveApiKeyId } = await import('../route-model-registry-service');
  if (!target.apiKeyId) throw new Error('请选择有效的 API Key');
  const apiKeyInfo = apiKeys.find(item => resolveApiKeyId(item) === target.apiKeyId);
  const isLegacyKey = legacyKey && resolveApiKeyId({ key: legacyKey }) === target.apiKeyId;
  if (!localKey && !isLegacyKey && (!apiKeyInfo || !isApiKeyActive(apiKeyInfo)))
    throw new Error('请选择有效的 API Key');
  const catalogApiKey = catalogEntry.apiKeys.find(key => key.id === target.apiKeyId);
  if (!catalogApiKey) {
    throw new Error('所选 API Key 已不可用，请重新选择');
  }
  const scopedModels = catalogApiKey.scopedModels;
  if (target.model && !scopedModels.includes(target.model)) {
    throw new Error('所选模型不属于当前 API Key 分组，请重新选择');
  }
  const { resolveAccountApiKeyValue } = await import('../route-channel-resolver');
  const apiKey = isLegacyKey
    ? resolveApiKeyForUse(legacyKey)
    : localKey
      ? resolveApiKeyForUse(localKey.key, localKey.source)
      : await resolveAccountApiKeyValue(site, account, apiKeyInfo!);
  if (!apiKey) throw new Error('无法解析 API Key 的真实值');
  return {
    baseUrl: site.url,
    apiKey: localKey || isLegacyKey ? apiKey : resolveApiKeyForUse(apiKey, 'remote'),
    model: target.model || scopedModels[0] || '',
    targetLabel: catalogEntry.label,
    apiKeyName: catalogApiKey.label,
  };
}

export function splitModelRestriction(value?: string): Set<string> | null {
  const values = String(value || '')
    .split(/[\s,|]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return values.length === 0 || values.includes('*') || values.includes('all')
    ? null
    : new Set(values);
}

export function collectScopedModels(
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
  const { unifiedConfigManager } = await import('../unified-config-manager');
  const { resolveApiKeyId } = await import('../route-model-registry-service');
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
      const allModels = Array.from(
        new Set([
          ...(account.cached_data?.models || []),
          ...(account.local_api_keys || []).flatMap(key => key.models),
        ])
      ).filter(Boolean);
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
      for (const key of account.local_api_keys || []) {
        if (
          !isApiKeyActive({ enabled: key.status }) ||
          !resolveApiKeyForUse(key.key, key.source) ||
          apiKeys.some(item => item.id === key.id)
        )
          continue;
        apiKeys.push({
          id: key.id,
          label: key.name || '本地 API Key',
          key: undefined,
          group: key.group || undefined,
          ratio: key.groupMultiplier,
          desc: undefined,
          scopedModels: key.models,
        });
      }
      const legacyKey = account.api_key || site.api_key;
      if (legacyKey && resolveApiKeyForUse(legacyKey)) {
        const id = resolveApiKeyId({ key: legacyKey });
        if (!apiKeys.some(key => key.id === id))
          apiKeys.push({
            id,
            label: '手动 API Key',
            key: undefined,
            group: undefined,
            ratio: undefined,
            desc: undefined,
            scopedModels: allModels,
          });
      }
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
  const { loadCustomCliConfigStorage } = await import('../custom-cli-config-service');
  for (const direct of (await loadCustomCliConfigStorage()).configs) {
    const unavailableReasons = [
      !direct.baseUrl.trim() ? '缺少 Base URL' : '',
      !resolveApiKeyForUse(direct.apiKey) ? '缺少有效 API Key' : '',
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
