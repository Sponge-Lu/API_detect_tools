/**
 * 模型注册表服务
 * 输入: UnifiedConfig (站点/账户 cached_data.models), 自定义 CLI 配置及其已拉取模型边界, 人工覆盖规则
 * 输出: canonical 模型映射表, 厂商分类, 原始↔canonical 双向解析
 * 定位: 服务层 - 扫描所有站点模型 → 厂商分类 → 映射表管理
 */

import Logger from './utils/logger';
import { unifiedConfigManager } from './unified-config-manager';
import { createHash } from 'crypto';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  CUSTOM_CLI_ROUTE_GROUP,
  loadCustomCliConfigStorage,
} from './custom-cli-config-service';
import type {
  RouteModelVendor,
  RouteModelSourceApiKeyRef,
  RouteModelSourceRef,
  RouteModelMappingOverride,
  RouteModelRegistryEntry,
  RouteModelRegistryConfig,
  RouteModelDisplayItem,
  RouteCliType,
} from '../shared/types/route-proxy';
import {
  DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME,
  inferRouteModelVendor,
  parseRouteOverrideDisplayItemId,
} from '../shared/types/route-proxy';
import { BUILTIN_GROUP_IDS, isApiKeyActive } from '../shared/types/site';
import type { AccountCredential, ApiKeyInfo, ModelPricingData } from '../shared/types/site';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

const log = Logger.scope('RouteModelRegistry');
const ROUTE_CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];
type RegistryDisplayMode = 'reseed' | 'preserve' | 'resetDefaults';

function normalizeModelToken(model: string): string {
  return model.trim();
}

function normalizeDisplayItemOriginalModelOrder(
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
        .map(model => normalizeModelToken(model))
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

function expandDisplayItemSourceKeys(
  item: RouteModelDisplayItem,
  sourcePool: RouteModelSourceRef[],
  sourceByKey: Map<string, RouteModelSourceRef>
): string[] {
  const selectedModels = new Set(
    (item.originalModelOrder || []).map(model => normalizeModelToken(model)).filter(Boolean)
  );

  for (const sourceKey of item.sourceKeys) {
    const source = sourceByKey.get(sourceKey);
    if (source?.originalModel) {
      selectedModels.add(source.originalModel);
    }
  }

  if (selectedModels.size === 0) {
    return Array.from(new Set(item.sourceKeys.filter(sourceKey => sourceByKey.has(sourceKey))));
  }

  return sourcePool
    .filter(source => selectedModels.has(source.originalModel))
    .map(source => source.sourceKey);
}

function sortSourceKeysByOriginalModelOrder(
  sourceKeys: string[],
  originalModelOrder: string[] | undefined,
  sourceByKey: Map<string, RouteModelSourceRef>
): string[] {
  const originalOrder = normalizeDisplayItemOriginalModelOrder(
    originalModelOrder,
    sourceKeys,
    sourceByKey
  );
  const orderIndex = new Map(originalOrder.map((model, index) => [model, index]));

  return sourceKeys.slice().sort((left, right) => {
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
}

function getApiKeyDisplayName(apiKey: {
  name?: string;
  token_id?: number | string;
  id?: number | string;
}): string {
  const trimmedName = apiKey.name?.trim();
  if (trimmedName) {
    return trimmedName;
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return String(apiKey.token_id);
  }

  if (apiKey.id !== undefined && apiKey.id !== null) {
    return String(apiKey.id);
  }

  return '未命名 Key';
}

export function resolveApiKeyId(apiKey: {
  id?: number | string;
  token_id?: number | string;
  key?: string;
  token?: string;
}): string {
  if (apiKey.id !== undefined && apiKey.id !== null) {
    return String(apiKey.id);
  }

  if (apiKey.token_id !== undefined && apiKey.token_id !== null) {
    return String(apiKey.token_id);
  }

  const raw = apiKey.key || apiKey.token || '';
  if (raw) {
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  return 'unknown';
}

function parseApiKeyModelSet(value: string | undefined): Set<string> | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const tokens = trimmed
    .split(/[\s,|]+/)
    .map(token => token.trim())
    .filter(token => token.length > 0);

  if (tokens.length === 0 || tokens.includes('*') || tokens.includes('all')) {
    return null;
  }

  return new Set(tokens);
}

function apiKeySupportsOriginalModel(apiKey: ApiKeyInfo, originalModel: string): boolean {
  const modelSet = parseApiKeyModelSet(apiKey.models);
  if (!modelSet) {
    return true;
  }

  return modelSet.has(originalModel);
}

function buildApiKeyNamesByGroup(apiKeys: RouteModelSourceApiKeyRef[]): Record<string, string[]> {
  return apiKeys.reduce<Record<string, string[]>>((acc, apiKey) => {
    if (!acc[apiKey.group]) {
      acc[apiKey.group] = [];
    }

    if (!acc[apiKey.group]!.includes(apiKey.apiKeyName)) {
      acc[apiKey.group]!.push(apiKey.apiKeyName);
    }

    return acc;
  }, {});
}

function collectAvailableUserGroups(
  modelPricing: ModelPricingData | undefined,
  originalModel: string,
  userGroupKeys: string[]
): string[] {
  if (!modelPricing?.data) {
    return [...userGroupKeys];
  }

  const modelData = modelPricing.data[originalModel];
  if (!modelData) {
    return [...userGroupKeys];
  }

  const enableGroups = modelData.enable_groups || [];
  if (enableGroups.length === 0) {
    return [];
  }

  const userGroupSet = new Set(userGroupKeys);
  return enableGroups.filter(group => userGroupSet.has(group));
}

function collectAvailableApiKeys(
  account: AccountCredential,
  originalModel: string,
  availableUserGroups: string[]
): RouteModelSourceApiKeyRef[] {
  if (availableUserGroups.length === 0) {
    return [];
  }

  const allowedGroups = new Set(availableUserGroups);

  return (account.cached_data?.api_keys || [])
    .filter(apiKey => {
      const group = apiKey.group?.trim();
      return (
        !!group &&
        allowedGroups.has(group) &&
        isApiKeyActive(apiKey) &&
        apiKeySupportsOriginalModel(apiKey, originalModel)
      );
    })
    .map(apiKey => ({
      apiKeyId: resolveApiKeyId(apiKey),
      apiKeyName: getApiKeyDisplayName(apiKey),
      accountId: account.id,
      accountName: account.account_name,
      group: apiKey.group!.trim(),
    }));
}

function addCustomCliModelCandidate(
  modelsByName: Map<string, Set<RouteCliType>>,
  model: string | null | undefined,
  cliTypes: RouteCliType[],
  allowedModels?: Set<string>
): void {
  const normalized = model?.trim();
  if (!normalized || cliTypes.length === 0) {
    return;
  }
  if (allowedModels && !allowedModels.has(normalized)) {
    return;
  }

  const existing = modelsByName.get(normalized) ?? new Set<RouteCliType>();
  for (const cliType of cliTypes) {
    existing.add(cliType);
  }
  modelsByName.set(normalized, existing);
}

function collectCustomCliModelCandidates(
  config: CustomCliConfig
): Array<{ model: string; cliTypes: RouteCliType[] }> {
  const modelsByName = new Map<string, Set<RouteCliType>>();
  const enabledCliTypes = ROUTE_CLI_TYPES.filter(
    cliType => config.cliSettings?.[cliType]?.enabled !== false
  );
  const fetchedModelSet = new Set(
    (config.models || []).map(model => model.trim()).filter(model => model.length > 0)
  );
  const manualModelSet = new Set(
    (config.manualModels || []).map(model => model.trim()).filter(model => model.length > 0)
  );
  const hasFetchedModelList = fetchedModelSet.size > 0 || typeof config.lastModelFetch === 'number';
  const modelAllowlist = hasFetchedModelList
    ? new Set([...fetchedModelSet, ...manualModelSet])
    : undefined;

  for (const model of fetchedModelSet) {
    addCustomCliModelCandidate(modelsByName, model, enabledCliTypes);
  }

  for (const cliType of ROUTE_CLI_TYPES) {
    const setting = config.cliSettings?.[cliType];
    if (!setting?.enabled) {
      continue;
    }

    addCustomCliModelCandidate(modelsByName, setting.model, [cliType], modelAllowlist);
    for (const model of setting.testModels || []) {
      addCustomCliModelCandidate(modelsByName, model, [cliType], modelAllowlist);
    }
    for (const slot of setting.testState?.slots || []) {
      addCustomCliModelCandidate(modelsByName, slot?.model, [cliType], modelAllowlist);
    }
  }

  return Array.from(modelsByName.entries())
    .map(([model, cliTypes]) => ({
      model,
      cliTypes: ROUTE_CLI_TYPES.filter(cliType => cliTypes.has(cliType)),
    }))
    .filter(item => item.cliTypes.length > 0);
}

function upsertRegistryEntry(
  entries: Record<string, RouteModelRegistryEntry>,
  canonicalName: string,
  vendor: RouteModelVendor,
  source: RouteModelSourceRef,
  hasOverride: boolean,
  createdAt: number,
  updatedAt: number
): void {
  if (!entries[canonicalName]) {
    entries[canonicalName] = {
      canonicalName,
      vendor,
      aliases: [source.originalModel],
      sources: [source],
      hasOverride,
      createdAt,
      updatedAt,
    };
    return;
  }

  const entry = entries[canonicalName];
  if (!entry.aliases.includes(source.originalModel)) {
    entry.aliases.push(source.originalModel);
  }

  if (!entry.sources.some(item => item.sourceKey === source.sourceKey)) {
    entry.sources.push(source);
  }

  if (hasOverride) {
    entry.hasOverride = true;
  }

  entry.updatedAt = Math.max(entry.updatedAt, updatedAt);
}

function buildSeededDisplayItems(
  entries: Record<string, RouteModelRegistryEntry>,
  manualDisplayItems: RouteModelDisplayItem[],
  previousSeededDisplayItems: RouteModelDisplayItem[],
  now: number
): RouteModelDisplayItem[] {
  const manualCanonicalNames = new Set(manualDisplayItems.map(item => item.canonicalName));
  const seededEntry = entries[DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME];

  if (!seededEntry || manualCanonicalNames.has(seededEntry.canonicalName)) {
    return [];
  }

  const seededSources = seededEntry.sources.slice();
  const previousSeededItem = previousSeededDisplayItems.find(
    item => item.canonicalName === seededEntry.canonicalName
  );

  return [
    {
      id: `seeded:${seededEntry.canonicalName}`,
      vendor: seededEntry.vendor,
      canonicalName: seededEntry.canonicalName,
      sourceKeys: seededSources.map(source => source.sourceKey),
      originalModelOrder: Array.from(new Set(seededSources.map(source => source.originalModel))),
      priorityConfig: {
        sitePriorities: previousSeededItem?.priorityConfig?.sitePriorities ?? {},
        apiKeyPriorities: previousSeededItem?.priorityConfig?.apiKeyPriorities ?? {},
        ...(previousSeededItem?.priorityConfig?.disabledSiteIds?.length
          ? { disabledSiteIds: previousSeededItem.priorityConfig.disabledSiteIds }
          : {}),
        ...(previousSeededItem?.priorityConfig?.disabledApiKeyPriorityKeys?.length
          ? {
              disabledApiKeyPriorityKeys:
                previousSeededItem.priorityConfig.disabledApiKeyPriorityKeys,
            }
          : {}),
      },
      runtimeConfig: previousSeededItem?.runtimeConfig,
      mode: 'seeded' as const,
      createdAt: previousSeededItem?.createdAt ?? now,
      updatedAt: now,
    },
  ];
}

function buildDisplayItems(
  detectedEntries: Record<string, RouteModelRegistryEntry>,
  sourcePool: RouteModelSourceRef[],
  previousDisplayItems: RouteModelDisplayItem[] | undefined,
  now: number,
  mode: RegistryDisplayMode = 'reseed'
): RouteModelDisplayItem[] {
  const validSourceKeys = new Set(sourcePool.map(source => source.sourceKey));
  const sourceByKey = new Map(sourcePool.map(source => [source.sourceKey, source]));
  const previousItems =
    mode === 'resetDefaults'
      ? (previousDisplayItems ?? []).filter(
          item => item.canonicalName !== DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME
        )
      : (previousDisplayItems ?? []);
  const previousSeededDisplayItems = previousItems.filter(item => item.mode === 'seeded');

  const persistedDisplayItems = previousItems
    .map<RouteModelDisplayItem | null>(item => {
      const sourceKeys = Array.from(
        new Set(
          expandDisplayItemSourceKeys(item, sourcePool, sourceByKey).filter(sourceKey =>
            validSourceKeys.has(sourceKey)
          )
        )
      );
      if (sourceKeys.length === 0) {
        return null;
      }

      return {
        ...item,
        vendor: sourceByKey.get(sourceKeys[0])?.vendor ?? item.vendor,
        sourceKeys,
        originalModelOrder: normalizeDisplayItemOriginalModelOrder(
          item.originalModelOrder,
          sourceKeys,
          sourceByKey
        ),
      };
    })
    .filter((item): item is RouteModelDisplayItem => item !== null);

  if (mode === 'preserve') {
    return persistedDisplayItems;
  }

  const manualDisplayItems = persistedDisplayItems.filter(item => item.mode === 'manual');
  return [
    ...buildSeededDisplayItems(
      detectedEntries,
      manualDisplayItems,
      previousSeededDisplayItems,
      now
    ),
    ...manualDisplayItems,
  ];
}

function buildEntriesFromDisplayItems(
  displayItems: RouteModelDisplayItem[],
  sourcePool: RouteModelSourceRef[],
  overrideBySource: Map<string, RouteModelMappingOverride>
): Record<string, RouteModelRegistryEntry> {
  const entries: Record<string, RouteModelRegistryEntry> = {};
  const sourceByKey = new Map(sourcePool.map(source => [source.sourceKey, source]));

  for (const item of displayItems) {
    const sources = sortSourceKeysByOriginalModelOrder(
      item.sourceKeys,
      item.originalModelOrder,
      sourceByKey
    )
      .map(sourceKey => sourceByKey.get(sourceKey))
      .filter((source): source is RouteModelSourceRef => !!source);

    if (sources.length === 0) {
      continue;
    }

    for (const source of sources) {
      upsertRegistryEntry(
        entries,
        item.canonicalName,
        item.vendor,
        source,
        overrideBySource.has(source.sourceKey),
        item.createdAt,
        item.updatedAt
      );
    }
  }

  return entries;
}

async function rebuildModelRegistryInternal(
  force?: boolean,
  displayMode: RegistryDisplayMode = 'reseed'
): Promise<RouteModelRegistryConfig> {
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) throw new Error('Config not loaded');

  const routing = unifiedConfigManager.getRoutingConfig();
  const existing = routing.modelRegistry;

  if (
    !force &&
    existing.lastAggregatedAt &&
    Date.now() - existing.lastAggregatedAt < 5 * 60 * 1000
  ) {
    return existing;
  }

  const now = Date.now();
  const detectedEntries: Record<string, RouteModelRegistryEntry> = {};
  const sourcePool: RouteModelSourceRef[] = [];
  const overrides =
    displayMode === 'resetDefaults'
      ? existing.overrides.filter(
          override => override.canonicalName !== DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME
        )
      : existing.overrides;

  const overrideBySource = new Map<string, RouteModelMappingOverride>();
  for (const o of overrides) {
    overrideBySource.set(o.sourceKey, o);
  }

  const { sites, accounts } = config;

  for (const site of sites) {
    if (
      site.enabled === false ||
      (site.group || BUILTIN_GROUP_IDS.DEFAULT) === BUILTIN_GROUP_IDS.UNAVAILABLE
    ) {
      continue;
    }

    const siteAccounts = accounts.filter(a => a.site_id === site.id && a.status === 'active');
    for (const account of siteAccounts) {
      const models = account.cached_data?.models || [];
      const userGroupKeys = Object.keys(account.cached_data?.user_groups || {});
      const modelPricing = account.cached_data?.model_pricing;

      for (const model of models) {
        const availableUserGroups = collectAvailableUserGroups(modelPricing, model, userGroupKeys);
        const availableApiKeys = collectAvailableApiKeys(account, model, availableUserGroups);
        const apiKeyNamesByGroup = buildApiKeyNamesByGroup(availableApiKeys);
        const apiKeyGroups = Array.from(new Set(availableApiKeys.map(apiKey => apiKey.group)));
        processModelSource(detectedEntries, sourcePool, overrideBySource, {
          siteId: site.id,
          siteName: site.name,
          accountId: account.id,
          accountName: account.account_name,
          sourceType: 'account',
          originalModel: model,
          apiKeyGroups,
          apiKeyNamesByGroup,
          userGroupKeys: availableUserGroups,
          availableUserGroups,
          availableApiKeys,
          now,
        });
      }
    }

    if (siteAccounts.length === 0 && site.cached_data?.models) {
      for (const model of site.cached_data.models) {
        processModelSource(detectedEntries, sourcePool, overrideBySource, {
          siteId: site.id,
          siteName: site.name,
          sourceType: 'site',
          originalModel: model,
          now,
        });
      }
    }
  }

  const customCliStorage = await loadCustomCliConfigStorage();
  for (const customConfig of customCliStorage.configs) {
    const baseUrl = customConfig.baseUrl?.trim() ?? '';
    const apiKey = customConfig.apiKey?.trim() ?? '';
    if (!baseUrl || !apiKey) {
      continue;
    }

    const displayName = customConfig.name?.trim() || baseUrl || customConfig.id;
    const siteId = buildCustomCliRouteSiteId(customConfig.id);
    const accountId = buildCustomCliRouteAccountId(customConfig.id);
    const apiKeyId = buildCustomCliRouteApiKeyId(customConfig.id);
    const siteName = `自定义 CLI / ${displayName}`;
    const accountName = '自定义 CLI';
    const apiKeyName = `${displayName} Key`;

    for (const { model, cliTypes } of collectCustomCliModelCandidates(customConfig)) {
      processModelSource(detectedEntries, sourcePool, overrideBySource, {
        siteId,
        siteName,
        accountId,
        accountName,
        sourceType: 'customCli',
        originalModel: model,
        availableCliTypes: cliTypes,
        apiKeyGroups: [CUSTOM_CLI_ROUTE_GROUP],
        apiKeyNamesByGroup: {
          [CUSTOM_CLI_ROUTE_GROUP]: [apiKeyName],
        },
        userGroupKeys: [CUSTOM_CLI_ROUTE_GROUP],
        availableUserGroups: [CUSTOM_CLI_ROUTE_GROUP],
        availableApiKeys: [
          {
            apiKeyId,
            apiKeyName,
            accountId,
            accountName,
            group: CUSTOM_CLI_ROUTE_GROUP,
          },
        ],
        now,
      });
    }
  }

  const displayItems = buildDisplayItems(
    detectedEntries,
    sourcePool,
    existing.displayItems,
    now,
    displayMode
  );

  const registry: RouteModelRegistryConfig = {
    version: 1,
    sources: sourcePool,
    entries: buildEntriesFromDisplayItems(displayItems, sourcePool, overrideBySource),
    overrides,
    displayItems,
    vendorPriorities: existing.vendorPriorities ?? {},
    lastAggregatedAt: now,
  };

  await unifiedConfigManager.updateRouteModelRegistry(registry);
  log.info(`Model registry rebuilt: ${Object.keys(registry.entries).length} canonical models`);
  return registry;
}

/** 按前缀+关键词两阶段推断厂商 */
export function inferVendorFromModel(model: string): RouteModelVendor {
  return inferRouteModelVendor(model);
}

/**
 * 归一化模型名称为 canonical 形式
 * 规则：
 * 1. 去除 provider/ 前缀（如 "anthropic/claude-..."）
 * 2. 统一分隔符：. → -
 * 3. 去除末尾日期戳（如 -20251001, -20250219）
 * 4. 去除末尾 @版本 后缀（如 @2025-01-01）
 * 5. 去除末尾 :latest 等标签
 * 6. 统一版本号格式（4.5 → 4-5, 3.5 → 3-5）
 * 7. 规范化名称段顺序（把散落的版本号收拢）
 *
 * 示例:
 *   claude-haiku-4-5-20251001 → claude-haiku-4-5
 *   claude-haiku-4.5          → claude-haiku-4-5
 *   claude-4.5-haiku          → claude-4-5-haiku (保留原始段序)
 *   gpt-4o-mini-2024-07-18   → gpt-4o-mini
 *   deepseek/deepseek-chat    → deepseek-chat
 */
export function buildCanonicalName(rawModel: string, _vendor: RouteModelVendor): string {
  let name = normalizeModelToken(rawModel);

  // 1. 去除 provider/ 前缀
  name = name.replace(/^[^/]+\//, '');

  // 2. 去除 @version 后缀
  name = name.replace(/@[\w.-]+$/, '');

  // 3. 去除 :tag 后缀 (如 :latest, :free)
  name = name.replace(/:[\w.-]+$/, '');

  // 4. 统一分隔符: 把 '.' 在版本号上下文中替换为 '-'
  //    匹配模式: 数字.数字 → 数字-数字
  name = name.replace(/(\d)\.(\d)/g, '$1-$2');

  // 5. 去除末尾日期戳 (8位连续数字，如 20251001, 20240718)
  name = name.replace(/-(\d{8})$/, '');

  // 6. 去除末尾完整日期 (如 -2024-07-18)
  name = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');

  // 7. 转小写统一
  name = name.toLowerCase();

  // 8. 去除多余连字符
  name = name.replace(/-+/g, '-').replace(/^-|-$/g, '');

  return name;
}

/** 生成 source key */
function buildSourceKey(
  siteId: string,
  accountId: string | undefined,
  originalModel: string
): string {
  return `${siteId}:${accountId || 'site'}:${normalizeModelToken(originalModel)}`;
}

/**
 * 扫描所有站点/账户 cached_data.models 重建 registry
 */
export async function rebuildModelRegistry(force?: boolean): Promise<RouteModelRegistryConfig> {
  return rebuildModelRegistryInternal(force, 'reseed');
}

export async function resetModelRegistryDefaults(): Promise<RouteModelRegistryConfig> {
  const registry = await rebuildModelRegistryInternal(true, 'resetDefaults');
  await unifiedConfigManager.ensureRouteRuleForCliModelSelection(
    'claudeCode',
    DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME
  );
  return registry;
}

export async function syncModelRegistrySources(force?: boolean): Promise<RouteModelRegistryConfig> {
  return rebuildModelRegistryInternal(force, 'preserve');
}

function processModelSource(
  detectedEntries: Record<string, RouteModelRegistryEntry>,
  sourcePool: RouteModelSourceRef[],
  overrideBySource: Map<string, RouteModelMappingOverride>,
  params: {
    siteId: string;
    siteName: string;
    accountId?: string;
    accountName?: string;
    sourceType: 'account' | 'site' | 'customCli';
    originalModel: string;
    availableCliTypes?: RouteCliType[];
    apiKeyGroups?: string[];
    apiKeyNamesByGroup?: Record<string, string[]>;
    userGroupKeys?: string[];
    availableUserGroups?: string[];
    availableApiKeys?: RouteModelSourceApiKeyRef[];
    now: number;
  }
): void {
  const {
    siteId,
    siteName,
    accountId,
    accountName,
    sourceType,
    originalModel,
    availableCliTypes,
    apiKeyGroups,
    apiKeyNamesByGroup,
    userGroupKeys,
    availableUserGroups,
    availableApiKeys,
    now,
  } = params;
  const sourceKey = buildSourceKey(siteId, accountId, originalModel);
  const override = overrideBySource.get(sourceKey);

  // exclude 操作：跳过此来源
  if (override?.action === 'exclude') return;

  const vendor = inferVendorFromModel(originalModel);
  let canonicalName: string;

  if (override?.action === 'pin' || override?.action === 'rename') {
    canonicalName = override.canonicalName;
  } else {
    canonicalName = buildCanonicalName(originalModel, vendor);
  }

  const source: RouteModelSourceRef = {
    sourceKey,
    siteId,
    siteName,
    accountId,
    accountName,
    sourceType,
    originalModel,
    vendor,
    availableCliTypes,
    apiKeyGroups,
    apiKeyNamesByGroup: apiKeyNamesByGroup
      ? Object.fromEntries(
          Object.entries(apiKeyNamesByGroup).map(([group, names]) => [group, [...names]])
        )
      : undefined,
    userGroupKeys,
    availableUserGroups,
    availableApiKeys: availableApiKeys?.map(apiKey => ({ ...apiKey })),
    firstSeenAt: now,
    lastSeenAt: now,
  };

  if (!sourcePool.some(item => item.sourceKey === sourceKey)) {
    sourcePool.push(source);
  }

  upsertRegistryEntry(detectedEntries, canonicalName, vendor, source, !!override, now, now);
}

/** 获取当前 registry */
export function getModelRegistry(): RouteModelRegistryConfig {
  return unifiedConfigManager.getRoutingConfig().modelRegistry;
}

/** 按厂商过滤 registry 条目 */
export function listModelRegistryEntries(vendor?: RouteModelVendor): RouteModelRegistryEntry[] {
  const { entries } = getModelRegistry();
  const list = Object.values(entries);
  if (!vendor) return list;
  return list.filter(e => e.vendor === vendor);
}

/** 将原始模型名解析为 canonical 名称 */
export function resolveCanonicalName(params: {
  rawModel: string;
  siteId: string;
  accountId?: string;
}): string {
  const { rawModel, siteId, accountId } = params;
  const registry = getModelRegistry();
  const normalizedRawModel = normalizeModelToken(rawModel);

  // 1. 检查人工覆盖
  const sourceKey = buildSourceKey(siteId, accountId, normalizedRawModel);
  const sourceOverride = registry.overrides.find(override => override.sourceKey === sourceKey);
  if (sourceOverride?.action === 'pin' || sourceOverride?.action === 'rename') {
    return sourceOverride.canonicalName;
  }

  // 2. 在 registry entries 中查找
  for (const entry of Object.values(registry.entries)) {
    if (entry.aliases.includes(normalizedRawModel)) {
      // 检查是否来自同一站点/账户
      const matched = entry.sources.some(
        s =>
          s.siteId === siteId &&
          (!accountId || s.accountId === accountId) &&
          s.originalModel === normalizedRawModel
      );
      if (matched) return entry.canonicalName;
    }
  }

  // 3. Fallback: 自动生成
  const vendor = inferVendorFromModel(normalizedRawModel);
  return buildCanonicalName(normalizedRawModel, vendor);
}

/** 为通道解析实际应发给上游的原始模型名 */
export function resolveRawModelForChannel(params: {
  canonicalName: string;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
}): string | null {
  const { canonicalName, siteId, accountId } = params;
  const registry = getModelRegistry();
  const entry = registry.entries[canonicalName];
  if (!entry) return null;

  // 优先匹配同站点同账户的来源
  const exactMatch = entry.sources.find(s => s.siteId === siteId && s.accountId === accountId);
  if (exactMatch) return exactMatch.originalModel;

  // 次优：同站点任意账户
  const siteMatch = entry.sources.find(s => s.siteId === siteId);
  if (siteMatch) return siteMatch.originalModel;

  // 最后 fallback：canonical 本身（可能上游能识别）
  return canonicalName;
}

/** 新增/更新人工覆盖 */
export async function upsertModelMappingOverride(
  override: RouteModelMappingOverride
): Promise<RouteModelMappingOverride> {
  const savedOverride = await unifiedConfigManager.upsertRouteModelMappingOverride(override);
  await syncModelRegistrySources(true);
  return savedOverride;
}

export async function upsertModelDisplayItem(
  displayItem: RouteModelDisplayItem
): Promise<RouteModelRegistryConfig> {
  await unifiedConfigManager.upsertRouteModelDisplayItem(displayItem);
  return syncModelRegistrySources(true);
}

export async function deleteModelDisplayItem(
  displayItemId: string
): Promise<RouteModelRegistryConfig | null> {
  const registry = getModelRegistry();
  const displayItem = registry.displayItems.find(item => item.id === displayItemId);
  if (!displayItem) {
    const canonicalName = parseRouteOverrideDisplayItemId(displayItemId);
    if (!canonicalName) {
      return null;
    }

    const overrides = registry.overrides.filter(
      override => override.action !== 'exclude' && override.canonicalName === canonicalName
    );
    if (overrides.length === 0) {
      return null;
    }

    for (const override of overrides) {
      await unifiedConfigManager.deleteRouteModelMappingOverride(override.id);
    }

    return syncModelRegistrySources(true);
  }

  const canonicalName = displayItem.canonicalName.trim();
  const sourceKeys = new Set(displayItem.sourceKeys);
  const overridesToDelete = registry.overrides.filter(item => {
    if (sourceKeys.has(item.sourceKey)) {
      return true;
    }

    return item.action !== 'exclude' && item.canonicalName.trim() === canonicalName;
  });

  for (const override of overridesToDelete) {
    await unifiedConfigManager.deleteRouteModelMappingOverride(override.id);
  }

  const deleted = await unifiedConfigManager.deleteRouteModelDisplayItem(displayItemId);
  if (!deleted) {
    return null;
  }

  return syncModelRegistrySources(true);
}

/** 删除人工覆盖 */
export async function deleteModelMappingOverride(overrideId: string): Promise<boolean> {
  const deleted = await unifiedConfigManager.deleteRouteModelMappingOverride(overrideId);
  if (deleted) {
    await syncModelRegistrySources(true);
  }
  return deleted;
}
