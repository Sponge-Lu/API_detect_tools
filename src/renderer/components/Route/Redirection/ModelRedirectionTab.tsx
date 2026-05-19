/**
 * 模型重定向区块
 * 平铺展示重定向卡片，并在详情弹窗内维护当前卡片的站点 / API key 优先级
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { resolveModelPricing } from '../../../utils/modelPricing';
import { AppButton } from '../../AppButton/AppButton';
import { AppModal } from '../../AppModal/AppModal';
import {
  CreateApiKeyDialog,
  type NewApiTokenForm,
} from '../../CreateApiKeyDialog/CreateApiKeyDialog';
import {
  buildRouteOverrideDisplayItemId,
  buildRouteApiKeyPriorityKey,
  DEFAULT_ROUTE_RUNTIME_CONFIG,
  DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME,
  inferRouteModelVendor,
  normalizeRouteRuntimeConfig,
} from '../../../../shared/types/route-proxy';
import type {
  RouteDisplayItemPriorityConfig,
  RouteCliProbeLatest,
  RouteModelDisplayItem,
  RouteModelMappingOverride,
  RouteModelRegistryConfig,
  RouteModelRegistryEntry,
  RouteModelSourceRef,
  RoutePathState,
  RouteRuntimeConfig,
  RoutingConfig,
} from '../../../../shared/types/route-proxy';
import type {
  AccountCredential,
  ModelPriceInfo,
  ModelPricingData,
  SiteConfig,
  UnifiedConfig,
  UserGroupInfo,
} from '../../../../shared/types/site';

interface RedirectCandidateGroup {
  originalModel: string;
  sourceKeys: string[];
  siteCount: number;
  sourceCount: number;
}

interface RedirectDisplayItemView {
  item: RouteModelDisplayItem;
  entry: RouteModelRegistryEntry | null;
  displayName: string;
  selectedOriginalModels: string[];
}

interface RedirectEditorContext {
  mode: 'create' | 'edit';
  displayItemId?: string;
  displayItemMode?: RouteModelDisplayItem['mode'];
  initialSourceKeys: string[];
  displayItemCreatedAt?: number;
}

interface RedirectEditorDraft {
  canonicalName: string;
  selectedOriginalModels: string[];
}

interface RedirectEditorErrors {
  canonicalName?: string;
  selectedOriginalModels?: string;
}

interface DisplayItemDetailState {
  entry: RouteModelRegistryEntry;
  item: RouteModelDisplayItem;
}

interface RouteRuntimeRuleState {
  item: RouteModelDisplayItem;
  displayName: string;
}

interface RouteRuntimeRuleDraft {
  maxAttemptsPerRoutePath: string;
  successRateWindowMinutes: string;
  disableDurationMinutes: string;
  minSuccessRatePercent: string;
}

interface RouteRuntimeRuleErrors {
  maxAttemptsPerRoutePath?: string;
  successRateWindowMinutes?: string;
  disableDurationMinutes?: string;
  minSuccessRatePercent?: string;
}

interface DetailApiKeyRow {
  key: string;
  apiKeyId: string;
  apiKeyName: string;
  accountId: string;
  accountName?: string;
  group: string;
  groupRatio?: number;
  supportedOriginalModels: string[];
  modelPriceLabels: Record<string, string>;
  modelTestResults: Record<string, string>;
}

interface DetailMissingApiKeyHint {
  key: string;
  accountId: string;
  accountName?: string;
  group: string;
  originalModels: string[];
}

interface DetailSiteGroup {
  key: string;
  siteId: string;
  siteName: string;
  siteBalance?: number;
  supportedOriginalModels: string[];
  apiKeys: DetailApiKeyRow[];
  missingGroupHints: DetailMissingApiKeyHint[];
}

interface PriorityDraft {
  sitePriorities: Record<string, string>;
  apiKeyPriorities: Record<string, string>;
}

interface RoutePathSuspensionLabel {
  originalModel: string;
  label: string;
  title: string;
}

interface CreateApiKeyDialogState {
  site: SiteConfig;
  account: AccountCredential;
  groups: Record<string, UserGroupInfo>;
  defaultGroup: string;
}

const QUOTA_CONVERSION_FACTOR = 500000;

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `redirect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatBalanceDisplay(balance: number | undefined): string | null {
  if (balance === undefined || balance === null || !Number.isFinite(balance)) {
    return null;
  }

  if (balance === -1) {
    return '无限额度';
  }

  if (Math.abs(balance) >= 100_000) {
    return `$${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(balance)}`;
  }

  return `$${balance.toFixed(2)}`;
}

function formatGroupRatio(ratio: number | undefined): string | null {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) {
    return null;
  }

  return `×${Number.isInteger(ratio) ? ratio : ratio.toFixed(2)}`;
}

function formatApiKeyAccountName(accountName: string | undefined, accountId: string): string {
  return accountName?.trim() === '默认账户' ? '默认' : accountName || accountId;
}

function formatPriceValue(price: number): string {
  if (price === 0) {
    return '0';
  }

  if (Math.abs(price) >= 1) {
    return Number(price.toFixed(2)).toString();
  }

  if (Math.abs(price) >= 0.01) {
    return Number(price.toFixed(4)).toString();
  }

  return Number(price.toFixed(6)).toString();
}

function formatInputOutputPrice(
  inputPrice: number | null,
  outputPrice: number | null
): string | null {
  const parts: string[] = [];
  if (inputPrice !== null) {
    parts.push(`↑$${formatPriceValue(inputPrice)}`);
  }
  if (outputPrice !== null) {
    parts.push(`↓$${formatPriceValue(outputPrice)}`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function resolveModelPriceLabel(pricingData: ModelPriceInfo | undefined): string | null {
  if (!pricingData) {
    return null;
  }

  const pricing = resolveModelPricing(pricingData);
  if (pricing.mode === 'perCall') {
    return pricing.callPrice !== null ? `$${formatPriceValue(pricing.callPrice)}/次` : null;
  }

  return formatInputOutputPrice(pricing.inputPrice, pricing.outputPrice);
}

function getModelPriceInfo(
  modelPricing: ModelPricingData | undefined,
  originalModel: string
): ModelPriceInfo | undefined {
  return modelPricing?.data?.[originalModel];
}

function addModelPriceLabel(
  labels: Map<string, string>,
  originalModel: string,
  label: string | null
): void {
  if (!label || labels.has(originalModel)) {
    return;
  }

  labels.set(originalModel, label);
}

function formatShortTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return '--:--';
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatProbeStatus(entry: RouteCliProbeLatest | undefined): string {
  if (!entry) {
    return '未测试';
  }

  if (entry.lastSample.success) {
    return '测试通过';
  }

  return entry.lastSample.statusCode ? `测试失败 HTTP${entry.lastSample.statusCode}` : '测试失败';
}

function getModelProbeStatus(params: {
  routingConfig?: RoutingConfig | null;
  siteId: string;
  accountId: string;
  canonicalName: string;
  originalModel: string;
}): string {
  const { routingConfig, siteId, accountId, canonicalName, originalModel } = params;
  const latestEntries = Object.values(routingConfig?.cliProbe?.latest || {})
    .filter(
      entry =>
        entry.siteId === siteId &&
        entry.accountId === accountId &&
        (entry.canonicalModel === canonicalName || entry.rawModel === originalModel)
    )
    .sort((left, right) => right.lastSample.testedAt - left.lastSample.testedAt);

  const successfulEntry = latestEntries.find(entry => entry.lastSample.success);
  return formatProbeStatus(successfulEntry || latestEntries[0]);
}

function formatModelListWithProbeStatus(
  models: string[],
  modelTestResults?: Record<string, string>,
  modelPriceLabels?: Record<string, string>,
  modelRoutePathSuspensions?: Record<string, string[]>
): string {
  return models
    .map(model => {
      const details = [
        modelPriceLabels?.[model],
        modelTestResults?.[model],
        ...(modelRoutePathSuspensions?.[model] || []),
      ].filter(Boolean);
      return details.length > 0 ? `${model}（${details.join(' / ')}）` : model;
    })
    .join('、');
}

function groupSuspensionLabelsByModel(
  suspensions: RoutePathSuspensionLabel[]
): Record<string, string[]> {
  return suspensions.reduce<Record<string, string[]>>((acc, suspension) => {
    acc[suspension.originalModel] = [...(acc[suspension.originalModel] || []), suspension.label];
    return acc;
  }, {});
}

function getActiveRoutePathSuspensionLabels(params: {
  states: Record<string, RoutePathState> | undefined;
  item: RouteModelDisplayItem;
  siteId: string;
  accountId?: string;
  apiKeyId?: string;
  originalModels: string[];
  now: number;
}): RoutePathSuspensionLabel[] {
  const { states, item, siteId, accountId, apiKeyId, originalModels, now } = params;
  if (!states) {
    return [];
  }

  const originalModelSet = new Set(originalModels);
  const runtimeConfig = normalizeRouteRuntimeConfig(item.runtimeConfig);

  return Object.values(states)
    .filter(
      state =>
        state.canonicalModel === item.canonicalName &&
        state.siteId === siteId &&
        (!accountId || state.accountId === accountId) &&
        (!apiKeyId || state.apiKeyId === apiKeyId) &&
        (!state.resolvedModel || originalModelSet.has(state.resolvedModel)) &&
        Boolean(state.disabledUntil && state.disabledUntil > now)
    )
    .sort((left, right) => (left.disabledUntil || 0) - (right.disabledUntil || 0))
    .map(state => {
      const rate = Math.round((state.successRate ?? 0) * 100);
      const timeLabel = formatShortTime(state.disabledUntil);

      return {
        originalModel: state.resolvedModel || item.canonicalName,
        label: `暂停至 ${timeLabel}`,
        title: `${state.resolvedModel || item.canonicalName} 暂停至 ${timeLabel}（${runtimeConfig.successRateWindowMinutes}分钟成功率 ${rate}%）`,
      };
    });
}

function countActiveRoutePathStatesForItem(params: {
  states: Record<string, RoutePathState> | undefined;
  item: RouteModelDisplayItem;
  now: number;
}): number {
  const { states, item, now } = params;
  if (!states) {
    return 0;
  }

  return Object.values(states).filter(
    state =>
      state.canonicalModel === item.canonicalName &&
      Boolean(state.disabledUntil && state.disabledUntil > now)
  ).length;
}

function getPriorityValue(value: string | number | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round(parsed));
}

function buildDefaultSiteOrderIndex(detailSiteGroups: DetailSiteGroup[]): Map<string, number> {
  return new Map(
    detailSiteGroups
      .map((group, index) => ({ group, index }))
      .sort((left, right) => {
        const leftHasApiKeys = left.group.apiKeys.length > 0;
        const rightHasApiKeys = right.group.apiKeys.length > 0;

        if (leftHasApiKeys !== rightHasApiKeys) {
          return leftHasApiKeys ? -1 : 1;
        }

        return left.index - right.index;
      })
      .map((entry, order) => [entry.group.siteId, order] as const)
  );
}

function getPrioritySortValue(
  key: string,
  priorities: Record<string, string | number | undefined>,
  defaultOrderIndex: Map<string, number>
): number {
  const explicitPriority = getPriorityValue(priorities[key]);
  if (explicitPriority !== null) {
    return explicitPriority;
  }

  const explicitValues = Object.values(priorities)
    .map(getPriorityValue)
    .filter((value): value is number => value !== null);
  const fallbackBase = explicitValues.length > 0 ? Math.max(...explicitValues) + 1 : 0;
  return fallbackBase + (defaultOrderIndex.get(key) ?? Number.MAX_SAFE_INTEGER);
}

function sortApiKeysByPriority(
  apiKeys: DetailApiKeyRow[],
  apiKeyPriorities: Record<string, string | number | undefined>
): DetailApiKeyRow[] {
  const defaultOrderIndex = new Map(apiKeys.map((apiKey, index) => [apiKey.key, index] as const));

  return apiKeys.slice().sort((left, right) => {
    const leftPriority = getPrioritySortValue(left.key, apiKeyPriorities, defaultOrderIndex);
    const rightPriority = getPrioritySortValue(right.key, apiKeyPriorities, defaultOrderIndex);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return (
      (defaultOrderIndex.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
      (defaultOrderIndex.get(right.key) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

function sortDetailGroupsByPriority(
  detailSiteGroups: DetailSiteGroup[],
  priorityDraft: PriorityDraft | RouteDisplayItemPriorityConfig
): DetailSiteGroup[] {
  const defaultOrderIndex = buildDefaultSiteOrderIndex(detailSiteGroups);

  return detailSiteGroups
    .slice()
    .sort((left, right) => {
      const leftPriority = getPrioritySortValue(
        left.siteId,
        priorityDraft.sitePriorities,
        defaultOrderIndex
      );
      const rightPriority = getPrioritySortValue(
        right.siteId,
        priorityDraft.sitePriorities,
        defaultOrderIndex
      );

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return (
        (defaultOrderIndex.get(left.siteId) ?? Number.MAX_SAFE_INTEGER) -
        (defaultOrderIndex.get(right.siteId) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map(group => ({
      ...group,
      apiKeys: sortApiKeysByPriority(group.apiKeys, priorityDraft.apiKeyPriorities),
    }));
}

function buildSequentialPriorityDraft(detailSiteGroups: DetailSiteGroup[]): PriorityDraft {
  return {
    sitePriorities: Object.fromEntries(
      detailSiteGroups.map((group, index) => [group.siteId, String(index)])
    ),
    apiKeyPriorities: Object.fromEntries(
      detailSiteGroups.flatMap(group =>
        group.apiKeys.map((apiKey, index) => [apiKey.key, String(index)])
      )
    ),
  };
}

function createDisplayOrderPriorityDraft(
  detailSiteGroups: DetailSiteGroup[],
  priorityConfig: RouteDisplayItemPriorityConfig
): PriorityDraft {
  return buildSequentialPriorityDraft(sortDetailGroupsByPriority(detailSiteGroups, priorityConfig));
}

function moveArrayItem<T>(items: T[], currentIndex: number, targetIndex: number): T[] {
  if (
    currentIndex < 0 ||
    currentIndex >= items.length ||
    targetIndex < 0 ||
    targetIndex >= items.length ||
    currentIndex === targetIndex
  ) {
    return items;
  }

  const nextItems = items.slice();
  const [item] = nextItems.splice(currentIndex, 1);
  nextItems.splice(targetIndex, 0, item!);
  return nextItems;
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

function expandDisplayItemSourceKeys(
  displayItem: RouteModelDisplayItem,
  sourcePool: RouteModelSourceRef[],
  sourceByKey: Map<string, RouteModelSourceRef>
): string[] {
  const selectedModels = new Set(
    (displayItem.originalModelOrder || [])
      .map(model => model.trim())
      .filter(model => model.length > 0)
  );

  for (const sourceKey of displayItem.sourceKeys) {
    const source = sourceByKey.get(sourceKey);
    if (source?.originalModel) {
      selectedModels.add(source.originalModel);
    }
  }

  if (selectedModels.size === 0) {
    return Array.from(
      new Set(displayItem.sourceKeys.filter(sourceKey => sourceByKey.has(sourceKey)))
    );
  }

  return sourcePool
    .filter(source => selectedModels.has(source.originalModel))
    .map(source => source.sourceKey);
}

function buildDisplayItemEntry(
  displayItem: RouteModelDisplayItem,
  sourcePool: RouteModelSourceRef[],
  sourceByKey: Map<string, RouteModelSourceRef>,
  overrideBySource: Map<string, RouteModelMappingOverride>
): RouteModelRegistryEntry | null {
  const expandedSourceKeys = expandDisplayItemSourceKeys(displayItem, sourcePool, sourceByKey);
  const originalModelOrder = normalizeOriginalModelOrder(
    displayItem.originalModelOrder,
    expandedSourceKeys,
    sourceByKey
  );
  const orderIndex = new Map(originalModelOrder.map((model, index) => [model, index]));

  const sources = expandedSourceKeys
    .slice()
    .sort((left, right) => {
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
    })
    .map(sourceKey => sourceByKey.get(sourceKey))
    .filter((source): source is RouteModelSourceRef => !!source);

  if (sources.length === 0) {
    return null;
  }

  return {
    canonicalName: displayItem.canonicalName,
    vendor: displayItem.vendor,
    aliases: Array.from(new Set(sources.map(source => source.originalModel))),
    sources,
    hasOverride: sources.some(source => overrideBySource.has(source.sourceKey)),
    createdAt: displayItem.createdAt,
    updatedAt: displayItem.updatedAt,
  };
}

function buildRedirectCandidateGroups(sources: RouteModelSourceRef[]): RedirectCandidateGroup[] {
  const groups = new Map<string, { sourceKeys: Set<string>; siteIds: Set<string> }>();

  for (const source of sources) {
    if (!groups.has(source.originalModel)) {
      groups.set(source.originalModel, {
        sourceKeys: new Set<string>(),
        siteIds: new Set<string>(),
      });
    }

    groups.get(source.originalModel)!.sourceKeys.add(source.sourceKey);
    groups.get(source.originalModel)!.siteIds.add(source.siteId);
  }

  return Array.from(groups.entries())
    .map(([originalModel, group]) => ({
      originalModel,
      sourceKeys: Array.from(group.sourceKeys),
      siteCount: group.siteIds.size,
      sourceCount: group.sourceKeys.size,
    }))
    .sort((left, right) => left.originalModel.localeCompare(right.originalModel));
}

function buildFallbackDisplayItems(registry: RouteModelRegistryConfig): RouteModelDisplayItem[] {
  const exampleEntry = registry.entries[DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME];
  if (!exampleEntry || registry.lastAggregatedAt) {
    return [];
  }

  return [
    {
      id: `fallback:${exampleEntry.canonicalName}`,
      vendor: exampleEntry.vendor,
      canonicalName: exampleEntry.canonicalName,
      sourceKeys: exampleEntry.sources.map(source => source.sourceKey),
      originalModelOrder: Array.from(
        new Set(exampleEntry.sources.map(source => source.originalModel))
      ),
      priorityConfig: {
        sitePriorities: {},
        apiKeyPriorities: {},
      },
      mode: 'seeded',
      createdAt: exampleEntry.createdAt,
      updatedAt: exampleEntry.updatedAt,
    },
  ];
}

function buildOverrideDisplayItems(
  registry: RouteModelRegistryConfig,
  sourceByKey: Map<string, RouteModelSourceRef>,
  excludedCanonicalNames: Set<string>
): RouteModelDisplayItem[] {
  const groups = new Map<
    string,
    {
      sources: RouteModelSourceRef[];
      createdAt: number;
      updatedAt: number;
    }
  >();

  for (const override of registry.overrides) {
    if (override.action === 'exclude' || !override.canonicalName) {
      continue;
    }

    const canonicalName = override.canonicalName.trim();
    if (!canonicalName || excludedCanonicalNames.has(canonicalName)) {
      continue;
    }

    const source = sourceByKey.get(override.sourceKey);
    if (!source) {
      continue;
    }

    const group = groups.get(canonicalName) ?? {
      sources: [],
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    };
    if (!group.sources.some(item => item.sourceKey === source.sourceKey)) {
      group.sources.push(source);
    }
    group.createdAt = Math.min(group.createdAt, override.createdAt);
    group.updatedAt = Math.max(group.updatedAt, override.updatedAt);
    groups.set(canonicalName, group);
  }

  return Array.from(groups.entries()).map(([canonicalName, group]) => {
    const entry = registry.entries[canonicalName];
    const sourcesByKey = new Map<string, RouteModelSourceRef>();
    for (const source of entry?.sources ?? []) {
      sourcesByKey.set(source.sourceKey, source);
    }
    for (const source of group.sources) {
      sourcesByKey.set(source.sourceKey, source);
    }
    const sources = Array.from(sourcesByKey.values());

    return {
      id: buildRouteOverrideDisplayItemId(canonicalName),
      vendor: entry?.vendor ?? group.sources[0]?.vendor ?? inferRouteModelVendor(canonicalName),
      canonicalName,
      sourceKeys: Array.from(new Set(sources.map(source => source.sourceKey))),
      originalModelOrder: Array.from(new Set(sources.map(source => source.originalModel))),
      priorityConfig: {
        sitePriorities: {},
        apiKeyPriorities: {},
      },
      mode: 'manual',
      createdAt: entry?.createdAt ?? group.createdAt,
      updatedAt: entry?.updatedAt ?? group.updatedAt,
    };
  });
}

export function buildDisplayItemViews(
  registry?: RouteModelRegistryConfig
): RedirectDisplayItemView[] {
  if (!registry) {
    return [];
  }

  const sourcePool = getRegistrySourcePool(registry);
  const overrideBySource = new Map(
    registry.overrides.map(override => [override.sourceKey, override])
  );
  const sourceByKey = new Map(sourcePool.map(source => [source.sourceKey, source]));
  const overrideSourceKeysByCanonicalName = new Map<string, string[]>();
  for (const override of registry.overrides) {
    const canonicalName = override.canonicalName.trim();
    if (override.action === 'exclude' || !canonicalName || !sourceByKey.has(override.sourceKey)) {
      continue;
    }

    const sourceKeys = overrideSourceKeysByCanonicalName.get(canonicalName) ?? [];
    sourceKeys.push(override.sourceKey);
    overrideSourceKeysByCanonicalName.set(canonicalName, sourceKeys);
  }

  const visibleDisplayItems = registry.displayItems.filter(
    item =>
      item.mode === 'manual' ||
      item.canonicalName === DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME
  );
  const baseDisplayItems =
    visibleDisplayItems.length > 0 ? visibleDisplayItems : buildFallbackDisplayItems(registry);
  const displayItems = [
    ...baseDisplayItems,
    ...buildOverrideDisplayItems(
      registry,
      sourceByKey,
      new Set(baseDisplayItems.map(item => item.canonicalName))
    ),
  ];

  return displayItems.map(item => {
    const itemWithOverrideSources: RouteModelDisplayItem = {
      ...item,
      sourceKeys: Array.from(
        new Set([
          ...item.sourceKeys,
          ...(overrideSourceKeysByCanonicalName.get(item.canonicalName) ?? []),
        ])
      ),
    };
    const expandedSourceKeys = expandDisplayItemSourceKeys(
      itemWithOverrideSources,
      sourcePool,
      sourceByKey
    );
    const expandedItem: RouteModelDisplayItem = {
      ...itemWithOverrideSources,
      sourceKeys: expandedSourceKeys,
      originalModelOrder: normalizeOriginalModelOrder(
        itemWithOverrideSources.originalModelOrder,
        expandedSourceKeys,
        sourceByKey
      ),
    };
    const entry = buildDisplayItemEntry(expandedItem, sourcePool, sourceByKey, overrideBySource);
    const selectedOriginalModels = entry
      ? normalizeOriginalModelOrder(
          expandedItem.originalModelOrder,
          expandedItem.sourceKeys,
          new Map(entry.sources.map(source => [source.sourceKey, source] as const))
        )
      : Array.from(new Set(expandedItem.originalModelOrder || []));

    return {
      item: expandedItem,
      entry,
      displayName: expandedItem.canonicalName,
      selectedOriginalModels,
    };
  });
}

export function buildRecommendedCliModelOptions(
  registry?: RouteModelRegistryConfig
): RouteModelRegistryEntry[] {
  const dedupedEntries = new Map<string, RouteModelRegistryEntry>();

  for (const displayItem of buildDisplayItemViews(registry)) {
    const entry =
      displayItem.entry ??
      ({
        canonicalName: displayItem.item.canonicalName,
        vendor: displayItem.item.vendor,
        aliases: displayItem.selectedOriginalModels,
        sources: [],
        hasOverride: false,
        createdAt: displayItem.item.createdAt,
        updatedAt: displayItem.item.updatedAt,
      } satisfies RouteModelRegistryEntry);

    if (!dedupedEntries.has(entry.canonicalName)) {
      dedupedEntries.set(entry.canonicalName, entry);
    }
  }

  return Array.from(dedupedEntries.values());
}

export function shouldRefreshRegistrySourceDetails(registry?: RouteModelRegistryConfig): boolean {
  if (!registry) {
    return false;
  }

  return getRegistrySourcePool(registry).some(source => {
    if (source.sourceType !== 'account') {
      return false;
    }

    return source.availableUserGroups === undefined || source.availableApiKeys === undefined;
  });
}

export function shouldRefreshRegistryDisplayItems(registry?: RouteModelRegistryConfig): boolean {
  if (!registry) {
    return false;
  }

  if (getRegistrySourcePool(registry).length === 0) {
    return false;
  }

  return registry.displayItems.some(item => {
    if ((item.originalModelOrder?.length ?? 0) === 0) {
      return true;
    }

    return (
      item.mode === 'seeded' &&
      item.canonicalName !== DEFAULT_ROUTE_REDIRECTION_EXAMPLE_CANONICAL_NAME
    );
  });
}

function formatSourceSummary(sources: RouteModelSourceRef[]): string {
  const siteCount = new Set(sources.map(source => source.siteId)).size;
  return `${siteCount} 站点 · ${sources.length} 来源`;
}

function buildDetailSiteAccountGroups(
  detailState: DisplayItemDetailState | null,
  fullConfig?: UnifiedConfig | null,
  routingConfig?: RoutingConfig | null
): DetailSiteGroup[] {
  if (!detailState) {
    return [];
  }

  const { entry, item } = detailState;
  const siteById = new Map((fullConfig?.sites || []).map(site => [site.id, site] as const));
  const accountById = new Map(
    (fullConfig?.accounts || []).map(account => [account.id, account] as const)
  );
  const sourceByKey = new Map(entry.sources.map(source => [source.sourceKey, source] as const));
  const selectedOriginalModels = normalizeOriginalModelOrder(
    item.originalModelOrder,
    item.sourceKeys,
    sourceByKey
  );
  const selectedModelSet = new Set(selectedOriginalModels);
  const grouped = new Map<
    string,
    {
      siteId: string;
      siteName: string;
      accountIds: Set<string>;
      supportedOriginalModels: Set<string>;
      apiKeys: Map<
        string,
        {
          apiKeyId: string;
          apiKeyName: string;
          accountId: string;
          accountName?: string;
          group: string;
          groupRatio?: number;
          supportedOriginalModels: Set<string>;
          modelPriceLabels: Map<string, string>;
          modelTestResults: Map<string, string>;
        }
      >;
      missingGroupHints: Map<string, DetailMissingApiKeyHint>;
    }
  >();

  for (const source of entry.sources) {
    if (!source.accountId || !selectedModelSet.has(source.originalModel)) {
      continue;
    }

    const groupKey = source.siteId;
    const siteGroup =
      grouped.get(groupKey) ||
      (() => {
        const next = {
          siteId: source.siteId,
          siteName: source.siteName,
          accountIds: new Set<string>(),
          supportedOriginalModels: new Set<string>(),
          apiKeys: new Map<
            string,
            {
              apiKeyId: string;
              apiKeyName: string;
              accountId: string;
              accountName?: string;
              group: string;
              groupRatio?: number;
              supportedOriginalModels: Set<string>;
              modelPriceLabels: Map<string, string>;
              modelTestResults: Map<string, string>;
            }
          >(),
          missingGroupHints: new Map<string, DetailMissingApiKeyHint>(),
        };
        grouped.set(groupKey, next);
        return next;
      })();

    siteGroup.supportedOriginalModels.add(source.originalModel);
    siteGroup.accountIds.add(source.accountId);
    const account = accountById.get(source.accountId);
    const site = siteById.get(source.siteId);
    const modelPricing = account?.cached_data?.model_pricing ?? site?.cached_data?.model_pricing;
    const modelPriceLabel = resolveModelPriceLabel(
      getModelPriceInfo(modelPricing, source.originalModel)
    );

    const eligibleApiKeys = (source.availableApiKeys || []).filter(
      apiKey => apiKey.accountId === source.accountId
    );
    const availableGroups = new Set(
      (source.availableUserGroups || []).map(group => group.trim()).filter(Boolean)
    );
    const groupsWithApiKeys = new Set<string>();

    for (const apiKey of eligibleApiKeys) {
      const normalizedGroup = apiKey.group.trim();
      groupsWithApiKeys.add(normalizedGroup);
      const groupRatio =
        account?.cached_data?.user_groups?.[normalizedGroup]?.ratio ??
        site?.cached_data?.user_groups?.[normalizedGroup]?.ratio;

      const key = buildRouteApiKeyPriorityKey(source.siteId, apiKey.accountId, apiKey.apiKeyId);
      const apiKeyRow =
        siteGroup.apiKeys.get(key) ||
        (() => {
          const next = {
            apiKeyId: apiKey.apiKeyId,
            apiKeyName: apiKey.apiKeyName,
            accountId: apiKey.accountId,
            accountName: apiKey.accountName,
            group: normalizedGroup,
            groupRatio,
            supportedOriginalModels: new Set<string>(),
            modelPriceLabels: new Map<string, string>(),
            modelTestResults: new Map<string, string>(),
          };
          siteGroup.apiKeys.set(key, next);
          return next;
        })();

      apiKeyRow.supportedOriginalModels.add(source.originalModel);
      addModelPriceLabel(apiKeyRow.modelPriceLabels, source.originalModel, modelPriceLabel);
      apiKeyRow.modelTestResults.set(
        source.originalModel,
        getModelProbeStatus({
          routingConfig,
          siteId: source.siteId,
          accountId: apiKey.accountId,
          canonicalName: item.canonicalName,
          originalModel: source.originalModel,
        })
      );
    }

    for (const userGroup of availableGroups) {
      if (!groupsWithApiKeys.has(userGroup)) {
        const hintKey = `${source.accountId}:${userGroup}`;
        const existingHint = siteGroup.missingGroupHints.get(hintKey);

        if (existingHint) {
          if (!existingHint.originalModels.includes(source.originalModel)) {
            existingHint.originalModels.push(source.originalModel);
          }
          continue;
        }

        siteGroup.missingGroupHints.set(hintKey, {
          key: hintKey,
          accountId: source.accountId,
          accountName: source.accountName,
          group: userGroup,
          originalModels: [source.originalModel],
        });
      }
    }
  }

  return Array.from(grouped.entries())
    .map(([key, group]) => {
      const accountBalances = Array.from(group.accountIds)
        .map(accountId => accountById.get(accountId)?.cached_data?.balance)
        .filter((balance): balance is number => typeof balance === 'number');
      const siteBalance =
        accountBalances.length > 0
          ? accountBalances.reduce((sum, balance) => sum + balance, 0)
          : siteById.get(group.siteId)?.cached_data?.balance;

      return {
        key,
        siteId: group.siteId,
        siteName: group.siteName,
        siteBalance,
        supportedOriginalModels: Array.from(group.supportedOriginalModels),
        apiKeys: Array.from(group.apiKeys.entries())
          .map(([apiKeyKey, apiKey]) => ({
            key: apiKeyKey,
            apiKeyId: apiKey.apiKeyId,
            apiKeyName: apiKey.apiKeyName,
            accountId: apiKey.accountId,
            accountName: apiKey.accountName,
            group: apiKey.group,
            groupRatio: apiKey.groupRatio,
            supportedOriginalModels: Array.from(apiKey.supportedOriginalModels),
            modelPriceLabels: Object.fromEntries(apiKey.modelPriceLabels),
            modelTestResults: Object.fromEntries(apiKey.modelTestResults),
          }))
          .sort((left, right) => {
            if (left.apiKeyName !== right.apiKeyName) {
              return left.apiKeyName.localeCompare(right.apiKeyName);
            }

            if (left.group !== right.group) {
              return left.group.localeCompare(right.group);
            }

            return left.key.localeCompare(right.key);
          }),
        missingGroupHints: Array.from(group.missingGroupHints.values()).sort((left, right) => {
          if ((left.accountName || '') !== (right.accountName || '')) {
            return (left.accountName || '').localeCompare(right.accountName || '');
          }

          if (left.group !== right.group) {
            return left.group.localeCompare(right.group);
          }

          return left.originalModels.join(',').localeCompare(right.originalModels.join(','));
        }),
      };
    })
    .sort((left, right) => left.siteName.localeCompare(right.siteName));
}

function createEmptyDraft(): RedirectEditorDraft {
  return {
    canonicalName: '',
    selectedOriginalModels: [],
  };
}

function createEmptyPriorityDraft(): RouteDisplayItemPriorityConfig {
  return {
    sitePriorities: {},
    apiKeyPriorities: {},
  };
}

function createRouteRuntimeRuleDraft(
  runtimeConfig?: Partial<RouteRuntimeConfig> | null
): RouteRuntimeRuleDraft {
  const normalized = normalizeRouteRuntimeConfig(runtimeConfig);

  return {
    maxAttemptsPerRoutePath: String(normalized.maxAttemptsPerRoutePath),
    successRateWindowMinutes: String(normalized.successRateWindowMinutes),
    disableDurationMinutes: String(normalized.disableDurationMinutes),
    minSuccessRatePercent: String(Math.round(normalized.minSuccessRate * 100)),
  };
}

function formatRouteRuntimeSummary(runtimeConfig?: Partial<RouteRuntimeConfig> | null): string {
  const normalized = normalizeRouteRuntimeConfig(runtimeConfig);
  return `路径 ${normalized.maxAttemptsPerRoutePath} 次 / 窗口 ${normalized.successRateWindowMinutes} 分钟 / 禁用 ${normalized.disableDurationMinutes} 分钟 / ${Math.round(normalized.minSuccessRate * 100)}%`;
}

function createDefaultNewApiKeyForm(group = 'default'): NewApiTokenForm {
  return {
    name: '',
    group,
    unlimitedQuota: true,
    quota: '',
    expiredTime: '',
  };
}

export function ModelRedirectionTab() {
  const {
    config,
    rebuildModelRegistry,
    syncModelRegistrySources,
    upsertMappingOverride,
    upsertDisplayItem,
    deleteDisplayItem,
    deleteMappingOverride,
    resetPathStates,
  } = useRouteStore(
    useShallow(store => ({
      config: store.config,
      rebuildModelRegistry: store.rebuildModelRegistry,
      syncModelRegistrySources: store.syncModelRegistrySources,
      upsertMappingOverride: store.upsertMappingOverride,
      upsertDisplayItem: store.upsertDisplayItem,
      deleteDisplayItem: store.deleteDisplayItem,
      deleteMappingOverride: store.deleteMappingOverride,
      resetPathStates: store.resetPathStates,
    }))
  );
  const [syncingSources, setSyncingSources] = useState(false);
  const [resettingDefaults, setResettingDefaults] = useState(false);
  const [resettingPathCanonicalName, setResettingPathCanonicalName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDisplayItemId, setSelectedDisplayItemId] = useState<string | null>(null);
  const [editorContext, setEditorContext] = useState<RedirectEditorContext | null>(null);
  const [sourceDetailState, setSourceDetailState] = useState<DisplayItemDetailState | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<PriorityDraft>({
    sitePriorities: {},
    apiKeyPriorities: {},
  });
  const [selectedPrioritySiteId, setSelectedPrioritySiteId] = useState<string | null>(null);
  const [expandedMissingKeySiteIds, setExpandedMissingKeySiteIds] = useState<
    Record<string, boolean>
  >({});
  const [draft, setDraft] = useState<RedirectEditorDraft>(createEmptyDraft);
  const [errors, setErrors] = useState<RedirectEditorErrors>({});
  const [candidateQuery, setCandidateQuery] = useState('');
  const [priorityDetailConfig, setPriorityDetailConfig] = useState<UnifiedConfig | null>(null);
  const [routeRuleState, setRouteRuleState] = useState<RouteRuntimeRuleState | null>(null);
  const [routeRuleDraft, setRouteRuleDraft] = useState<RouteRuntimeRuleDraft>(() =>
    createRouteRuntimeRuleDraft()
  );
  const [routeRuleErrors, setRouteRuleErrors] = useState<RouteRuntimeRuleErrors>({});
  const [createApiKeyState, setCreateApiKeyState] = useState<CreateApiKeyDialogState | null>(null);
  const [newApiKeyForm, setNewApiKeyForm] = useState<NewApiTokenForm>(() =>
    createDefaultNewApiKeyForm()
  );
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const redirectNameInputId = useId();
  const searchInputId = useId();

  const registry = config?.modelRegistry;
  const displayItems = useMemo(() => buildDisplayItemViews(registry), [registry]);
  const selectedDisplayItem = useMemo(() => {
    if (displayItems.length === 0) {
      return null;
    }

    return (
      displayItems.find(displayItem => displayItem.item.id === selectedDisplayItemId) ??
      displayItems[0] ??
      null
    );
  }, [displayItems, selectedDisplayItemId]);
  const candidateGroups = useMemo(
    () => (registry ? buildRedirectCandidateGroups(getRegistrySourcePool(registry)) : []),
    [registry]
  );
  const shouldAutoRefreshSourceDetails = useMemo(
    () => shouldRefreshRegistrySourceDetails(registry),
    [registry]
  );
  const shouldAutoRefreshDisplayItems = useMemo(
    () => shouldRefreshRegistryDisplayItems(registry),
    [registry]
  );
  const shouldBootstrapRegistry = useMemo(
    () => displayItems.length === 0 && !registry?.lastAggregatedAt,
    [displayItems.length, registry?.lastAggregatedAt]
  );
  const overrideBySource = useMemo(
    () =>
      new Map<string, RouteModelMappingOverride>(
        (registry?.overrides ?? []).map(override => [override.sourceKey, override])
      ),
    [registry?.overrides]
  );
  const detailSiteGroups = useMemo(
    () => buildDetailSiteAccountGroups(sourceDetailState, priorityDetailConfig, config),
    [config, priorityDetailConfig, sourceDetailState]
  );
  const sortedDetailSiteGroups = useMemo(() => {
    return sortDetailGroupsByPriority(detailSiteGroups, priorityDraft);
  }, [detailSiteGroups, priorityDraft]);

  useEffect(() => {
    const nextSelectedId = selectedDisplayItem?.item.id ?? null;
    if (selectedDisplayItemId !== nextSelectedId) {
      setSelectedDisplayItemId(nextSelectedId);
    }
  }, [selectedDisplayItem, selectedDisplayItemId]);

  useEffect(() => {
    if (!sourceDetailState || detailSiteGroups.length === 0) {
      return;
    }

    const normalizedDraft = buildSequentialPriorityDraft(sortedDetailSiteGroups);
    const draftMatches =
      JSON.stringify(normalizedDraft.sitePriorities) ===
        JSON.stringify(priorityDraft.sitePriorities) &&
      JSON.stringify(normalizedDraft.apiKeyPriorities) ===
        JSON.stringify(priorityDraft.apiKeyPriorities);

    if (!draftMatches) {
      setPriorityDraft(normalizedDraft);
    }

    if (
      !selectedPrioritySiteId ||
      !detailSiteGroups.some(group => group.siteId === selectedPrioritySiteId)
    ) {
      setSelectedPrioritySiteId(sortedDetailSiteGroups[0]?.siteId ?? null);
    }
  }, [
    detailSiteGroups,
    priorityDraft.apiKeyPriorities,
    priorityDraft.sitePriorities,
    selectedPrioritySiteId,
    sortedDetailSiteGroups,
    sourceDetailState,
  ]);
  const filteredCandidates = useMemo(() => {
    if (!candidateQuery.trim()) {
      return candidateGroups;
    }

    const query = candidateQuery.trim().toLowerCase();
    return candidateGroups.filter(candidate =>
      candidate.originalModel.toLowerCase().includes(query)
    );
  }, [candidateGroups, candidateQuery]);

  const closeEditor = useCallback(() => {
    setEditorContext(null);
    setDraft(createEmptyDraft());
    setErrors({});
    setCandidateQuery('');
  }, []);

  const closeSourceDetails = useCallback(() => {
    setSourceDetailState(null);
    setPriorityDetailConfig(null);
    setPriorityDraft({
      sitePriorities: {},
      apiKeyPriorities: {},
    });
    setSelectedPrioritySiteId(null);
    setExpandedMissingKeySiteIds({});
  }, []);

  const closeRouteRules = useCallback(() => {
    setRouteRuleState(null);
    setRouteRuleDraft(createRouteRuntimeRuleDraft());
    setRouteRuleErrors({});
  }, []);

  const closeCreateApiKeyDialog = useCallback(() => {
    setCreateApiKeyState(null);
    setNewApiKeyForm(createDefaultNewApiKeyForm());
    setCreatingApiKey(false);
  }, []);

  const toggleMissingKeyHints = useCallback((siteId: string) => {
    setExpandedMissingKeySiteIds(current => ({
      ...current,
      [siteId]: !current[siteId],
    }));
  }, []);

  const refreshOpenSourceDetails = useCallback(
    (
      nextRegistry: RouteModelRegistryConfig,
      currentDetailState: DisplayItemDetailState | null = sourceDetailState
    ) => {
      if (!currentDetailState) {
        return;
      }

      const nextView = buildDisplayItemViews(nextRegistry).find(
        view =>
          view.item.id === currentDetailState.item.id ||
          view.item.canonicalName === currentDetailState.item.canonicalName
      );

      if (!nextView?.entry) {
        closeSourceDetails();
        return;
      }

      setSourceDetailState({
        item: nextView.item,
        entry: nextView.entry,
      });
    },
    [closeSourceDetails, sourceDetailState]
  );

  const openSourceDetails = useCallback(
    (item: RouteModelDisplayItem, entry: RouteModelRegistryEntry) => {
      const priorityConfig = item.priorityConfig ?? createEmptyPriorityDraft();
      const initialDetailGroups = buildDetailSiteAccountGroups({ item, entry }, null, config);
      const nextPriorityDraft = createDisplayOrderPriorityDraft(
        initialDetailGroups,
        priorityConfig
      );
      const initialSortedGroups = sortDetailGroupsByPriority(
        initialDetailGroups,
        nextPriorityDraft
      );

      setSourceDetailState({ item, entry });
      setPriorityDetailConfig(null);
      setPriorityDraft(nextPriorityDraft);
      setSelectedPrioritySiteId(initialSortedGroups[0]?.siteId ?? null);
      setExpandedMissingKeySiteIds({});

      void window.electronAPI
        .loadConfig()
        .then(fullConfig => {
          setPriorityDetailConfig(fullConfig as UnifiedConfig);
        })
        .catch(() => {
          setPriorityDetailConfig(null);
        });
    },
    [config]
  );

  useEffect(() => {
    if (!selectedDisplayItem?.entry) {
      closeSourceDetails();
      return;
    }

    openSourceDetails(selectedDisplayItem.item, selectedDisplayItem.entry);
  }, [closeSourceDetails, openSourceDetails, selectedDisplayItem]);

  const openRouteRules = useCallback((item: RouteModelDisplayItem, displayName: string) => {
    setRouteRuleState({ item, displayName });
    setRouteRuleDraft(createRouteRuntimeRuleDraft(item.runtimeConfig));
    setRouteRuleErrors({});
  }, []);

  const openCreateApiKeyDialog = useCallback(
    async (siteGroup: DetailSiteGroup, hint: DetailMissingApiKeyHint) => {
      try {
        const fullConfig = (await window.electronAPI.loadConfig()) as UnifiedConfig;
        const site = fullConfig.sites.find(currentSite => currentSite.id === siteGroup.siteId);
        const account = fullConfig.accounts.find(
          currentAccount => currentAccount.id === hint.accountId
        );

        if (!site || !account) {
          throw new Error('无法定位对应站点或账户');
        }

        const groups = {
          ...(account.cached_data?.user_groups || {}),
        };
        if (!groups[hint.group]) {
          groups[hint.group] = {
            desc: '路由优先级弹窗创建',
            ratio: 1,
          };
        }

        const siteConfig: SiteConfig = {
          id: site.id,
          name: `${site.name} / ${account.account_name}`,
          url: site.url,
          site_type: site.site_type,
          api_key: '',
          system_token: account.access_token,
          user_id: account.user_id,
          enabled: site.enabled,
          group: site.group,
          has_checkin: site.has_checkin,
          force_enable_checkin: site.force_enable_checkin,
          extra_links: site.extra_links,
          auto_refresh: site.auto_refresh,
          auto_refresh_interval: site.auto_refresh_interval,
        };

        setCreateApiKeyState({
          site: siteConfig,
          account,
          groups,
          defaultGroup: hint.group,
        });
        setNewApiKeyForm(createDefaultNewApiKeyForm(hint.group));
      } catch (error: unknown) {
        toast.error(`打开创建 API key 弹窗失败: ${getErrorMessage(error)}`);
      }
    },
    []
  );

  const openCreateEditor = useCallback(() => {
    setEditorContext({
      mode: 'create',
      initialSourceKeys: [],
    });
    setDraft(createEmptyDraft());
    setErrors({});
    setCandidateQuery('');
  }, []);

  const openEditEditor = useCallback(
    (displayItem: RouteModelDisplayItem, entry: RouteModelRegistryEntry | null) => {
      if (!entry) {
        toast.error('当前重定向项缺少可编辑的来源，请先同步来源或重置默认重定向');
        return;
      }

      const sourceByKey = new Map(entry.sources.map(source => [source.sourceKey, source] as const));
      const selectedOriginalModels = normalizeOriginalModelOrder(
        displayItem.originalModelOrder,
        displayItem.sourceKeys,
        sourceByKey
      );

      setEditorContext({
        mode: 'edit',
        displayItemId: displayItem.id,
        displayItemMode: displayItem.mode,
        initialSourceKeys: displayItem.sourceKeys,
        displayItemCreatedAt: displayItem.createdAt,
      });
      setDraft({
        canonicalName: entry.canonicalName,
        selectedOriginalModels,
      });
      setErrors({});
      setCandidateQuery('');
    },
    []
  );

  const handleSyncSources = useCallback(async () => {
    setSyncingSources(true);
    try {
      const syncedRegistry = await syncModelRegistrySources(true);
      if (!syncedRegistry) {
        throw new Error('无法同步模型来源');
      }
      toast.success('模型来源已同步，现有规则未被覆盖');
    } catch (error: unknown) {
      toast.error(`同步失败: ${getErrorMessage(error)}`);
    } finally {
      setSyncingSources(false);
    }
  }, [syncModelRegistrySources]);

  const handleResetDefaults = useCallback(async () => {
    setResettingDefaults(true);
    try {
      const rebuiltRegistry = await rebuildModelRegistry(true, { resetDefaults: true });
      if (!rebuiltRegistry) {
        throw new Error('无法重置默认重定向');
      }
      toast.success('默认模型重定向已重置，Claude Code 路由规则已修复');
    } catch (error: unknown) {
      toast.error(`重置失败: ${getErrorMessage(error)}`);
    } finally {
      setResettingDefaults(false);
    }
  }, [rebuildModelRegistry]);

  const handleResetRoutePaths = useCallback(
    async (item: RouteModelDisplayItem, displayName: string) => {
      setResettingPathCanonicalName(item.canonicalName);
      try {
        const cleared = await resetPathStates({ canonicalModel: item.canonicalName });
        if (cleared === null) {
          throw new Error('无法恢复路由路径');
        }

        toast.success(
          cleared > 0
            ? `${displayName} 已恢复 ${cleared} 条路由路径`
            : `${displayName} 没有需要恢复的路由路径`
        );
      } catch (error: unknown) {
        toast.error(`恢复失败: ${getErrorMessage(error)}`);
      } finally {
        setResettingPathCanonicalName(null);
      }
    },
    [resetPathStates]
  );

  const handleCreateApiKeySubmit = useCallback(async () => {
    if (!createApiKeyState) {
      return;
    }

    const name = newApiKeyForm.name.trim();
    if (!name) {
      toast.warning('请填写令牌名称');
      return;
    }

    const accessToken = createApiKeyState.account.access_token;
    const userIdNum = Number.parseInt(createApiKeyState.account.user_id || '0', 10);
    if (!accessToken || !userIdNum) {
      toast.error('当前账户缺少可用 access token 或 user id');
      return;
    }

    let remainQuota = 0;
    if (!newApiKeyForm.unlimitedQuota) {
      const quotaNumber = Number.parseFloat(newApiKeyForm.quota);
      if (!Number.isFinite(quotaNumber) || quotaNumber <= 0) {
        toast.warning('请输入大于 0 的额度（单位：美元）');
        return;
      }

      remainQuota = Math.floor(quotaNumber * QUOTA_CONVERSION_FACTOR);
    }

    let expiredTime = -1;
    if (newApiKeyForm.expiredTime) {
      const nextExpiredTime = new Date(newApiKeyForm.expiredTime);
      if (Number.isNaN(nextExpiredTime.getTime())) {
        toast.warning('请输入有效的过期时间');
        return;
      }
      if (nextExpiredTime.getTime() <= Date.now()) {
        toast.warning('过期时间必须晚于当前时间');
        return;
      }

      expiredTime = Math.floor(nextExpiredTime.getTime() / 1000);
    }

    setCreatingApiKey(true);
    try {
      const resp = await window.electronAPI.token?.createApiToken?.(
        createApiKeyState.site.url,
        userIdNum,
        accessToken,
        {
          name,
          remain_quota: remainQuota,
          expired_time: expiredTime,
          unlimited_quota: newApiKeyForm.unlimitedQuota,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
          group: newApiKeyForm.group || createApiKeyState.defaultGroup,
        },
        createApiKeyState.account.id
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '创建 API Key 失败');
      }

      const syncedRegistry = await syncModelRegistrySources(true);
      if (!syncedRegistry) {
        throw new Error('API Key 已创建，但刷新模型来源失败');
      }

      refreshOpenSourceDetails(syncedRegistry);
      toast.success('API Key 创建成功');
      closeCreateApiKeyDialog();
    } catch (error: unknown) {
      toast.error(`创建 API Key 失败: ${getErrorMessage(error)}`);
    } finally {
      setCreatingApiKey(false);
    }
  }, [
    closeCreateApiKeyDialog,
    createApiKeyState,
    newApiKeyForm.expiredTime,
    newApiKeyForm.group,
    newApiKeyForm.name,
    newApiKeyForm.quota,
    newApiKeyForm.unlimitedQuota,
    refreshOpenSourceDetails,
    syncModelRegistrySources,
  ]);

  useEffect(() => {
    if (!config) {
      return;
    }

    if (shouldBootstrapRegistry || shouldAutoRefreshDisplayItems) {
      void handleResetDefaults();
      return;
    }

    if (shouldAutoRefreshSourceDetails) {
      void handleSyncSources();
    }
  }, [
    config,
    handleResetDefaults,
    handleSyncSources,
    shouldBootstrapRegistry,
    shouldAutoRefreshDisplayItems,
    shouldAutoRefreshSourceDetails,
  ]);

  const toggleOriginalModel = useCallback((originalModel: string) => {
    setDraft(current => {
      const selected = current.selectedOriginalModels.includes(originalModel)
        ? current.selectedOriginalModels.filter(item => item !== originalModel)
        : [...current.selectedOriginalModels, originalModel];

      return {
        ...current,
        selectedOriginalModels: selected,
      };
    });
    setErrors(current => ({ ...current, selectedOriginalModels: undefined }));
  }, []);

  const stopNestedScrollPropagation = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorContext) {
      return;
    }

    const canonicalName = draft.canonicalName.trim();
    const nextErrors: RedirectEditorErrors = {};
    if (!canonicalName) {
      nextErrors.canonicalName = '请输入重定向名称';
    }

    if (draft.selectedOriginalModels.length === 0) {
      nextErrors.selectedOriginalModels = '请至少勾选一个原始模型';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const conflictDisplayItem = displayItems.find(
      displayItem =>
        displayItem.item.canonicalName === canonicalName &&
        displayItem.item.id !== editorContext.displayItemId
    );
    if (conflictDisplayItem) {
      setErrors(current => ({
        ...current,
        canonicalName: '该重定向名称已存在，请直接编辑已有卡片',
      }));
      return;
    }

    const candidateMap = new Map(
      candidateGroups.map(candidate => [candidate.originalModel, candidate] as const)
    );
    const selectedSourceKeys = new Set<string>();
    for (const originalModel of draft.selectedOriginalModels) {
      const candidate = candidateMap.get(originalModel);
      if (!candidate) {
        continue;
      }

      for (const sourceKey of candidate.sourceKeys) {
        selectedSourceKeys.add(sourceKey);
      }
    }

    if (selectedSourceKeys.size === 0) {
      setErrors(current => ({
        ...current,
        selectedOriginalModels: '所选模型没有可写入的来源',
      }));
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      for (const sourceKey of editorContext.initialSourceKeys) {
        if (selectedSourceKeys.has(sourceKey)) {
          continue;
        }

        const existingOverride = overrideBySource.get(sourceKey);
        if (existingOverride) {
          const deleted = await deleteMappingOverride(existingOverride.id);
          if (!deleted) {
            throw new Error(`无法删除来源 ${sourceKey} 的旧重定向`);
          }
        }
      }

      const existingDisplayItem = displayItems.find(
        item => item.item.id === editorContext.displayItemId
      )?.item;
      const savedRegistry = await upsertDisplayItem({
        id: editorContext.displayItemId ?? createLocalId(),
        vendor: inferRouteModelVendor(canonicalName),
        canonicalName,
        sourceKeys: Array.from(selectedSourceKeys),
        originalModelOrder: [...draft.selectedOriginalModels],
        priorityConfig: existingDisplayItem?.priorityConfig ?? createEmptyPriorityDraft(),
        runtimeConfig: existingDisplayItem?.runtimeConfig,
        mode: editorContext.displayItemMode ?? 'manual',
        createdAt: editorContext.displayItemCreatedAt ?? now,
        updatedAt: now,
      });
      if (!savedRegistry) {
        throw new Error('无法保存重定向展示项');
      }

      for (const sourceKey of selectedSourceKeys) {
        const existingOverride = overrideBySource.get(sourceKey);
        const savedOverride = await upsertMappingOverride({
          id: existingOverride?.id ?? createLocalId(),
          sourceKey,
          canonicalName,
          action: 'rename',
          note: existingOverride?.note,
          createdAt: existingOverride?.createdAt ?? now,
          updatedAt: now,
        });
        if (!savedOverride) {
          throw new Error(`无法保存来源 ${sourceKey} 的重定向`);
        }
      }

      toast.success(editorContext.mode === 'edit' ? '模型重定向已更新' : '模型重定向已新增');
      closeEditor();
    } catch (error: unknown) {
      toast.error(`保存失败: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [
    closeEditor,
    candidateGroups,
    deleteMappingOverride,
    displayItems,
    draft.canonicalName,
    draft.selectedOriginalModels,
    editorContext,
    upsertDisplayItem,
    overrideBySource,
    upsertMappingOverride,
  ]);

  const handleDelete = useCallback(
    async (displayItemId: string) => {
      setSaving(true);
      try {
        const deletedRegistry = await deleteDisplayItem(displayItemId);
        if (!deletedRegistry) {
          throw new Error('无法删除重定向模型');
        }

        if (editorContext?.displayItemId === displayItemId) {
          closeEditor();
        }

        toast.success('重定向模型已删除');
      } catch (error: unknown) {
        toast.error(`删除失败: ${getErrorMessage(error)}`);
      } finally {
        setSaving(false);
      }
    },
    [closeEditor, deleteDisplayItem, editorContext?.displayItemId]
  );

  const movePrioritySite = useCallback(
    (siteId: string, target: 'up' | 'down' | 'first' | 'last') => {
      const currentIndex = sortedDetailSiteGroups.findIndex(group => group.siteId === siteId);
      const targetIndex =
        target === 'first'
          ? 0
          : target === 'last'
            ? sortedDetailSiteGroups.length - 1
            : target === 'up'
              ? currentIndex - 1
              : currentIndex + 1;
      const reorderedGroups = moveArrayItem(sortedDetailSiteGroups, currentIndex, targetIndex);

      setSelectedPrioritySiteId(siteId);
      setPriorityDraft(buildSequentialPriorityDraft(reorderedGroups));
    },
    [sortedDetailSiteGroups]
  );

  const moveSelectedPrioritySite = useCallback(
    (target: 'up' | 'down' | 'first' | 'last') => {
      if (!selectedPrioritySiteId) {
        return;
      }

      movePrioritySite(selectedPrioritySiteId, target);
    },
    [movePrioritySite, selectedPrioritySiteId]
  );

  const movePriorityApiKey = useCallback(
    (siteId: string, apiKeyKey: string, target: 'up' | 'down') => {
      const siteGroup = sortedDetailSiteGroups.find(group => group.siteId === siteId);
      if (!siteGroup) {
        return;
      }

      const currentIndex = siteGroup.apiKeys.findIndex(apiKey => apiKey.key === apiKeyKey);
      const targetIndex = target === 'up' ? currentIndex - 1 : currentIndex + 1;
      const reorderedApiKeys = moveArrayItem(siteGroup.apiKeys, currentIndex, targetIndex);

      setPriorityDraft(current => ({
        ...current,
        apiKeyPriorities: {
          ...current.apiKeyPriorities,
          ...Object.fromEntries(
            reorderedApiKeys.map((apiKey, index) => [apiKey.key, String(index)])
          ),
        },
      }));
    },
    [sortedDetailSiteGroups]
  );

  const handleSaveDetails = useCallback(async () => {
    if (!sourceDetailState) {
      return;
    }

    const priorityConfig: RouteDisplayItemPriorityConfig = {
      sitePriorities: Object.fromEntries(
        sortedDetailSiteGroups.map((group, index) => [group.siteId, index])
      ),
      apiKeyPriorities: Object.fromEntries(
        sortedDetailSiteGroups.flatMap(group =>
          group.apiKeys.map((apiKey, index) => [apiKey.key, index])
        )
      ),
    };

    setSaving(true);
    try {
      const savedRegistry = await upsertDisplayItem({
        ...sourceDetailState.item,
        priorityConfig,
        updatedAt: Date.now(),
      });
      if (!savedRegistry) {
        throw new Error('无法保存重定向优先级');
      }

      toast.success('重定向优先级已更新');
    } catch (error: unknown) {
      toast.error(`保存失败: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [sortedDetailSiteGroups, sourceDetailState, upsertDisplayItem]);

  const handleSaveRouteRules = useCallback(async () => {
    if (!routeRuleState) {
      return;
    }

    const maxAttemptsPerRoutePath = Number.parseInt(routeRuleDraft.maxAttemptsPerRoutePath, 10);
    const successRateWindowMinutes = Number.parseInt(routeRuleDraft.successRateWindowMinutes, 10);
    const disableDurationMinutes = Number.parseInt(routeRuleDraft.disableDurationMinutes, 10);
    const minSuccessRatePercent = Number.parseFloat(routeRuleDraft.minSuccessRatePercent);
    const nextErrors: RouteRuntimeRuleErrors = {};

    if (
      !Number.isFinite(maxAttemptsPerRoutePath) ||
      maxAttemptsPerRoutePath < 1 ||
      maxAttemptsPerRoutePath > 10
    ) {
      nextErrors.maxAttemptsPerRoutePath = '请输入 1-10 的整数';
    }

    if (
      !Number.isFinite(successRateWindowMinutes) ||
      successRateWindowMinutes < 1 ||
      successRateWindowMinutes > 1440
    ) {
      nextErrors.successRateWindowMinutes = '请输入 1-1440 的整数';
    }

    if (
      !Number.isFinite(disableDurationMinutes) ||
      disableDurationMinutes < 1 ||
      disableDurationMinutes > 1440
    ) {
      nextErrors.disableDurationMinutes = '请输入 1-1440 的整数';
    }

    if (
      !Number.isFinite(minSuccessRatePercent) ||
      minSuccessRatePercent < 0 ||
      minSuccessRatePercent > 100
    ) {
      nextErrors.minSuccessRatePercent = '请输入 0-100 的数字';
    }

    if (Object.keys(nextErrors).length > 0) {
      setRouteRuleErrors(nextErrors);
      return;
    }

    const runtimeConfig = normalizeRouteRuntimeConfig({
      maxAttemptsPerRoutePath,
      successRateWindowMinutes,
      disableDurationMinutes,
      minSuccessRate: minSuccessRatePercent / 100,
    });

    setSaving(true);
    try {
      const savedRegistry = await upsertDisplayItem({
        ...routeRuleState.item,
        runtimeConfig,
        updatedAt: Date.now(),
      });
      if (!savedRegistry) {
        throw new Error('无法保存路由规则');
      }

      toast.success('路由规则已更新');
      closeRouteRules();
    } catch (error: unknown) {
      toast.error(`保存失败: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }, [closeRouteRules, routeRuleDraft, routeRuleState, upsertDisplayItem]);

  const selectedPrioritySiteIndex = selectedPrioritySiteId
    ? sortedDetailSiteGroups.findIndex(group => group.siteId === selectedPrioritySiteId)
    : -1;
  const now = Date.now();
  const selectedEntry = selectedDisplayItem?.entry ?? null;
  const selectedActiveSuspensionCount = selectedDisplayItem
    ? countActiveRoutePathStatesForItem({
        states: config?.routePathStates,
        item: selectedDisplayItem.item,
        now,
      })
    : 0;
  const isResettingSelectedRoutePaths = selectedDisplayItem
    ? resettingPathCanonicalName === selectedDisplayItem.item.canonicalName
    : false;

  if (!config) {
    return null;
  }

  return (
    <>
      <div
        data-testid="redirect-workspace"
        className="overflow-hidden border border-[var(--line-soft)] bg-[var(--surface-1)]"
      >
        <div
          data-testid="redirect-two-pane-layout"
          className="grid min-h-[520px] xl:grid-cols-[minmax(240px,0.62fr)_minmax(0,1.38fr)]"
        >
          <div
            data-testid="redirect-list-pane"
            className="flex min-h-0 flex-col border-b border-[var(--line-soft)] xl:border-b-0 xl:border-r"
          >
            <div
              data-testid="redirect-list-toolbar"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)]">重定向模型</div>
                <div className="text-[11px] text-[var(--text-secondary)]">
                  {displayItems.length} 项
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <AppButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="!h-7 !min-h-7 !px-2"
                  onClick={handleSyncSources}
                  disabled={syncingSources || resettingDefaults}
                >
                  {syncingSources ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>同步来源</span>
                </AppButton>
                <AppButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="!h-7 !min-h-7 !px-2"
                  onClick={openCreateEditor}
                  disabled={resettingDefaults || syncingSources || saving}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>新增重定向</span>
                </AppButton>
              </div>
            </div>

            {displayItems.length > 0 ? (
              <div
                data-testid="redirect-card-list"
                className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {displayItems.map(displayItem => {
                  const entry = displayItem.entry;
                  const isSelected = selectedDisplayItem?.item.id === displayItem.item.id;

                  return (
                    <button
                      key={displayItem.item.id}
                      type="button"
                      data-testid="redirect-list-row"
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => setSelectedDisplayItemId(displayItem.item.id)}
                      className={`block w-full border-b border-[var(--line-soft)]/80 border-l-2 px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'border-l-[var(--accent)] bg-[var(--accent-soft-strong)] shadow-[inset_4px_0_0_var(--accent)]'
                          : 'border-l-transparent hover:bg-[var(--surface-2)]'
                      }`}
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <code className="min-w-0 truncate font-mono text-[13px] font-semibold text-[var(--text-primary)]">
                          {displayItem.displayName}
                        </code>
                        {displayItem.item.mode === 'manual' ? (
                          <span className="shrink-0 rounded-full bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] text-[var(--warning)]">
                            手工新增
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                            默认示例
                          </span>
                        )}
                        {entry ? (
                          <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                            {formatSourceSummary(entry.sources)}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                            来源待同步
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                        {formatRouteRuntimeSummary(displayItem.item.runtimeConfig)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
                <div className="text-sm font-medium text-[var(--text-primary)]">暂无模型重定向</div>
                <p className="max-w-sm text-xs text-[var(--text-secondary)]">
                  先同步来源拉取当前站点模型；其他重定向请手动新增。
                </p>
              </div>
            )}
          </div>

          <div
            data-testid="redirect-detail-pane"
            className="min-h-0 overflow-y-auto bg-[var(--surface-1)]"
          >
            {selectedDisplayItem ? (
              <div className="min-h-full">
                <div
                  data-testid="redirect-detail-actions"
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <code className="block truncate font-mono text-sm font-semibold text-[var(--text-primary)]">
                      {selectedDisplayItem.displayName}
                    </code>
                    <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      {selectedEntry ? formatSourceSummary(selectedEntry.sources) : '来源待同步'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-7 !min-h-7 !px-2"
                      onClick={() =>
                        void handleResetRoutePaths(
                          selectedDisplayItem.item,
                          selectedDisplayItem.displayName
                        )
                      }
                      disabled={
                        saving ||
                        isResettingSelectedRoutePaths ||
                        selectedActiveSuspensionCount === 0
                      }
                      aria-label={`恢复 ${selectedDisplayItem.displayName} 路由路径`}
                      title={
                        selectedActiveSuspensionCount > 0
                          ? `恢复 ${selectedActiveSuspensionCount} 条暂停路径`
                          : '没有暂停路径'
                      }
                    >
                      {isResettingSelectedRoutePaths ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      <span>恢复路径</span>
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="!h-7 !min-h-7 !px-2"
                      onClick={() =>
                        openRouteRules(selectedDisplayItem.item, selectedDisplayItem.displayName)
                      }
                      disabled={saving || isResettingSelectedRoutePaths}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>路由规则</span>
                    </AppButton>
                    <button
                      type="button"
                      onClick={() =>
                        openEditEditor(selectedDisplayItem.item, selectedDisplayItem.entry)
                      }
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`编辑 ${selectedDisplayItem.displayName}`}
                      title="编辑模型重定向"
                      disabled={saving || isResettingSelectedRoutePaths}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(selectedDisplayItem.item.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] text-[var(--text-secondary)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`删除 ${selectedDisplayItem.displayName}`}
                      title="删除重定向模型"
                      disabled={saving || isResettingSelectedRoutePaths}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="border-b border-[var(--line-soft)] px-3 py-2">
                  <div className="mb-1.5 text-xs font-semibold text-[var(--text-primary)]">
                    原始模型
                  </div>
                  <div
                    data-testid="redirect-detail-original-models"
                    className="flex flex-wrap gap-x-1.5 gap-y-1"
                  >
                    {selectedDisplayItem.selectedOriginalModels.length > 0 ? (
                      selectedDisplayItem.selectedOriginalModels.map(originalModel => (
                        <div
                          key={`${selectedDisplayItem.item.id}:${originalModel}`}
                          className="max-w-full border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-0"
                        >
                          <code className="font-mono text-[11px] leading-4 text-[var(--text-secondary)]">
                            {originalModel}
                          </code>
                        </div>
                      ))
                    ) : (
                      <span className="border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {selectedDisplayItem.item.canonicalName}
                      </span>
                    )}
                  </div>
                </div>

                <div data-testid="redirect-detail-priority" className="px-3 py-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        优先级排序
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        站点与 API Key 按当前顺序尝试。
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <AppButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2"
                        onClick={() => moveSelectedPrioritySite('first')}
                        disabled={selectedPrioritySiteIndex <= 0}
                      >
                        <ChevronsUp className="h-3.5 w-3.5" />
                        <span>移到第一个</span>
                      </AppButton>
                      <AppButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2"
                        onClick={() => moveSelectedPrioritySite('up')}
                        disabled={selectedPrioritySiteIndex <= 0}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span>上移</span>
                      </AppButton>
                      <AppButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2"
                        onClick={() => moveSelectedPrioritySite('down')}
                        disabled={
                          selectedPrioritySiteIndex < 0 ||
                          selectedPrioritySiteIndex >= sortedDetailSiteGroups.length - 1
                        }
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span>下移</span>
                      </AppButton>
                      <AppButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2"
                        onClick={() => moveSelectedPrioritySite('last')}
                        disabled={
                          selectedPrioritySiteIndex < 0 ||
                          selectedPrioritySiteIndex >= sortedDetailSiteGroups.length - 1
                        }
                      >
                        <ChevronsDown className="h-3.5 w-3.5" />
                        <span>移到末尾</span>
                      </AppButton>
                      <AppButton
                        type="button"
                        size="sm"
                        onClick={handleSaveDetails}
                        loading={saving}
                      >
                        保存优先级
                      </AppButton>
                    </div>
                  </div>

                  {sortedDetailSiteGroups.length > 0 ? (
                    <div className="overflow-hidden" data-testid="priority-detail-compact-list">
                      <div className="grid grid-cols-[minmax(0,calc(43%_+_80px))_minmax(0,calc(57%_-_50px))_118px] gap-2 border-y border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <span>来源</span>
                        <span>覆盖模型</span>
                        <span className="text-right">优先级</span>
                      </div>
                      <div>
                        {sortedDetailSiteGroups.map((siteGroup, siteIndex) => {
                          const isSelected = selectedPrioritySiteId === siteGroup.siteId;
                          const missingHintsExpanded = Boolean(
                            expandedMissingKeySiteIds[siteGroup.siteId]
                          );

                          return (
                            <section
                              key={siteGroup.key}
                              className="border-t border-[var(--line-soft)] first:border-t-0"
                              data-testid="priority-detail-site-group"
                            >
                              <div
                                className={`grid cursor-pointer grid-cols-[minmax(0,calc(43%_+_80px))_minmax(0,calc(57%_-_50px))_118px] items-center gap-2 border-l-4 px-2.5 py-1.5 transition-colors ${
                                  isSelected
                                    ? 'border-l-[var(--accent)] bg-[var(--accent-soft)]/45'
                                    : 'border-l-[var(--accent)] bg-[var(--surface-2)]/70 hover:bg-[var(--surface-2)]'
                                }`}
                                onClick={() => setSelectedPrioritySiteId(siteGroup.siteId)}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="radio"
                                    name="priority-site-selection"
                                    className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                                    style={{ accentColor: 'var(--accent)' }}
                                    aria-label={`选择 ${siteGroup.siteName}`}
                                    checked={isSelected}
                                    onClick={event => event.stopPropagation()}
                                    onChange={() => setSelectedPrioritySiteId(siteGroup.siteId)}
                                  />
                                  <span className="shrink-0 rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                                    站点
                                  </span>
                                  <span className="flex min-w-0 items-center text-[13px] font-semibold text-[var(--text-primary)]">
                                    <span
                                      className="min-w-0 max-w-[8em] truncate"
                                      title={siteGroup.siteName}
                                    >
                                      {siteGroup.siteName}
                                    </span>
                                    {formatBalanceDisplay(siteGroup.siteBalance) ? (
                                      <span className="shrink-0">
                                        （{formatBalanceDisplay(siteGroup.siteBalance)}）
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                                <div className="min-w-0" aria-hidden="true" />
                                <div className="flex items-center justify-end">
                                  <span
                                    className="min-w-7 rounded-full bg-[var(--surface-1)] px-1.5 py-0.5 text-center text-xs font-semibold text-[var(--text-primary)]"
                                    data-testid="priority-detail-site-priority"
                                    aria-label={`${siteGroup.siteName} 优先级 ${siteIndex}`}
                                  >
                                    {siteIndex}
                                  </span>
                                </div>
                              </div>

                              {siteGroup.apiKeys.map((apiKey, apiKeyIndex) => {
                                const apiKeySuspensions = getActiveRoutePathSuspensionLabels({
                                  states: config.routePathStates,
                                  item: selectedDisplayItem.item,
                                  siteId: siteGroup.siteId,
                                  accountId: apiKey.accountId,
                                  apiKeyId: apiKey.apiKeyId,
                                  originalModels: apiKey.supportedOriginalModels,
                                  now,
                                });
                                const apiKeySuspensionLabels =
                                  groupSuspensionLabelsByModel(apiKeySuspensions);
                                const formattedModelList = formatModelListWithProbeStatus(
                                  apiKey.supportedOriginalModels,
                                  apiKey.modelTestResults,
                                  apiKey.modelPriceLabels,
                                  apiKeySuspensionLabels
                                );

                                return (
                                  <div
                                    key={apiKey.key}
                                    className="grid grid-cols-[minmax(0,calc(43%_+_80px))_minmax(0,calc(57%_-_50px))_118px] items-center gap-2 border-t border-[var(--line-soft)]/70 bg-[var(--surface-1)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                                    data-testid="priority-detail-api-key-row"
                                  >
                                    <div className="min-w-0 pl-5">
                                      <div className="flex min-w-0 items-center gap-1">
                                        <span className="h-5 w-px shrink-0 bg-[var(--line-soft)]" />
                                        <div className="flex shrink-0 flex-col items-center gap-px">
                                          <button
                                            type="button"
                                            className="rounded-[var(--radius-sm)] p-0 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                                            aria-label={`${apiKey.apiKeyName} 上移`}
                                            title="上移"
                                            disabled={apiKeyIndex === 0}
                                            onClick={() =>
                                              movePriorityApiKey(siteGroup.siteId, apiKey.key, 'up')
                                            }
                                          >
                                            <ChevronUp className="h-2.5 w-2.5" />
                                          </button>
                                          <button
                                            type="button"
                                            className="rounded-[var(--radius-sm)] p-0 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
                                            aria-label={`${apiKey.apiKeyName} 下移`}
                                            title="下移"
                                            disabled={apiKeyIndex === siteGroup.apiKeys.length - 1}
                                            onClick={() =>
                                              movePriorityApiKey(
                                                siteGroup.siteId,
                                                apiKey.key,
                                                'down'
                                              )
                                            }
                                          >
                                            <ChevronDown className="h-2.5 w-2.5" />
                                          </button>
                                        </div>
                                        <span className="shrink-0 rounded border border-[var(--line-soft)] bg-[var(--surface-2)] px-1 py-px text-[9px] font-bold leading-3">
                                          API Key
                                        </span>
                                        <span className="min-w-0 truncate">
                                          {`${apiKey.apiKeyName}（${[
                                            formatApiKeyAccountName(
                                              apiKey.accountName,
                                              apiKey.accountId
                                            ),
                                            apiKey.group,
                                            formatGroupRatio(apiKey.groupRatio),
                                          ]
                                            .filter(Boolean)
                                            .join(' / ')}）`}
                                        </span>
                                      </div>
                                    </div>
                                    <div
                                      className="min-w-0 truncate"
                                      title={
                                        apiKeySuspensions.length > 0
                                          ? apiKeySuspensions
                                              .map(suspension => suspension.title)
                                              .join(' / ')
                                          : formattedModelList
                                      }
                                    >
                                      {formattedModelList}
                                    </div>
                                    <div className="min-w-0" aria-hidden="true" />
                                  </div>
                                );
                              })}

                              {siteGroup.missingGroupHints.length > 0 ? (
                                <div className="border-t border-[var(--warning)]/25 bg-[var(--warning-soft)]/20 text-xs text-[var(--text-secondary)]">
                                  <button
                                    type="button"
                                    className="grid w-full grid-cols-[minmax(0,calc(43%_+_80px))_minmax(0,calc(57%_-_50px))_118px] items-center gap-2 px-2.5 py-1 text-left transition-colors hover:bg-[var(--warning-soft)]/35 focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px]"
                                    aria-expanded={missingHintsExpanded}
                                    aria-controls={`priority-missing-key-hints-${siteGroup.siteId}`}
                                    aria-label={`${siteGroup.siteName} ${
                                      missingHintsExpanded ? '收起' : '展开'
                                    }缺少 Key`}
                                    onClick={() => toggleMissingKeyHints(siteGroup.siteId)}
                                    data-testid="priority-detail-missing-key-toggle"
                                  >
                                    <div className="col-span-2 flex min-w-0 items-center gap-2 pl-5">
                                      <span className="h-5 w-px shrink-0 bg-[var(--warning)]/35" />
                                      <span className="shrink-0 rounded-full border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
                                        缺少 Key
                                      </span>
                                      <span className="min-w-0 truncate">
                                        {siteGroup.missingGroupHints.length} 个用户组未创建可用 API
                                        key
                                      </span>
                                    </div>
                                    <span className="flex translate-x-[50px] items-center justify-start gap-1 text-[11px] font-medium text-[var(--warning)]">
                                      <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${
                                          missingHintsExpanded ? '' : '-rotate-90'
                                        }`}
                                        aria-hidden="true"
                                      />
                                      {missingHintsExpanded ? '收起' : '展开'}
                                    </span>
                                  </button>
                                  {missingHintsExpanded ? (
                                    <div id={`priority-missing-key-hints-${siteGroup.siteId}`}>
                                      {siteGroup.missingGroupHints.map(hint => (
                                        <div
                                          key={`${siteGroup.key}:${hint.key}`}
                                          className="grid grid-cols-[minmax(0,calc(43%_+_80px))_minmax(0,calc(57%_-_50px))_118px] items-center gap-2 border-t border-[var(--warning)]/15 px-2.5 py-1"
                                          data-testid="priority-detail-missing-key-row"
                                        >
                                          <div className="col-span-2 flex min-w-0 items-center gap-2 pl-5">
                                            <span className="h-5 w-px shrink-0 bg-[var(--warning)]/35" />
                                            <span className="shrink-0 rounded-full border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
                                              缺少 Key
                                            </span>
                                            <span className="min-w-0 truncate">
                                              {hint.accountName || hint.accountId} / {hint.group}（
                                              {hint.originalModels.join('、')}）未创建可用 API key
                                            </span>
                                          </div>
                                          <AppButton
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            className="!h-6 !min-h-6 w-14 shrink-0 translate-x-[50px] justify-self-start px-0"
                                            onClick={() =>
                                              void openCreateApiKeyDialog(siteGroup, hint)
                                            }
                                            disabled={creatingApiKey}
                                          >
                                            创建
                                          </AppButton>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div
                                      id={`priority-missing-key-hints-${siteGroup.siteId}`}
                                      hidden
                                    ></div>
                                  )}
                                </div>
                              ) : null}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-4 text-sm text-[var(--text-secondary)]">
                      当前重定向还没有可配置优先级的可用站点、账户或 API key。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-full items-center justify-center px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
                请选择左侧重定向模型。
              </div>
            )}
          </div>
        </div>
      </div>

      <AppModal
        isOpen={editorContext !== null}
        onClose={closeEditor}
        title={editorContext?.mode === 'edit' ? '编辑模型重定向' : '新增模型重定向'}
        size="xl"
        className="!h-[72vh] !max-h-[72vh] !max-w-4xl"
        contentClassName="!flex !min-h-0 !max-h-none !flex-1 !overflow-hidden !px-0 !py-0"
        footer={
          <div className="flex justify-end gap-2">
            <AppButton type="button" variant="secondary" onClick={closeEditor} disabled={saving}>
              取消
            </AppButton>
            <AppButton type="button" onClick={handleSave} loading={saving}>
              {editorContext?.mode === 'edit' ? '保存修改' : '新增重定向'}
            </AppButton>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 basis-0 flex-col gap-3 px-5 py-3">
          <div
            data-testid="redirect-editor-input-row"
            className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start"
          >
            <label
              htmlFor={redirectNameInputId}
              className="text-sm font-medium text-[var(--text-primary)] md:pt-2"
            >
              重定向名称
            </label>
            <div className="min-w-0 space-y-1">
              <input
                id={redirectNameInputId}
                type="text"
                value={draft.canonicalName}
                onChange={event => {
                  setDraft(current => ({ ...current, canonicalName: event.target.value }));
                  setErrors(current => ({ ...current, canonicalName: undefined }));
                }}
                placeholder="例如：claude-sonnet-4-6"
                className={`w-full rounded-[var(--radius-md)] border bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:ring-2 ${
                  errors.canonicalName
                    ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger-soft)]'
                    : 'border-[var(--line-soft)] focus:border-[var(--accent)] focus:ring-[var(--accent-soft)]'
                }`}
                autoFocus
              />
              {errors.canonicalName ? (
                <div className="text-xs text-[var(--danger)]">{errors.canonicalName}</div>
              ) : null}
            </div>

            <label
              htmlFor={searchInputId}
              className="text-sm font-medium text-[var(--text-primary)] md:pt-2"
            >
              原始名称
            </label>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                id={searchInputId}
                type="text"
                value={candidateQuery}
                onChange={event => setCandidateQuery(event.target.value)}
                placeholder="搜索模型..."
                aria-label="搜索原始名称"
                className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] py-1.5 pl-9 pr-10 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
              />
              {candidateQuery ? (
                <button
                  type="button"
                  onClick={() => setCandidateQuery('')}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                  aria-label="清空搜索"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 basis-0 flex-col gap-1.5">
            <div className="flex min-h-0 flex-1 basis-0 flex-col gap-2 md:flex-row">
              <section className="flex min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] md:min-h-0 md:w-[38%] md:min-w-[18rem]">
                <div
                  data-testid="selected-original-models-header"
                  className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-[var(--text-primary)]">
                      已选原始模型
                    </div>
                    <span className="rounded-full bg-[var(--surface-1)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                      已选 {draft.selectedOriginalModels.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(current => ({ ...current, selectedOriginalModels: [] }));
                      setErrors(current => ({ ...current, selectedOriginalModels: undefined }));
                    }}
                    className="text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={draft.selectedOriginalModels.length === 0}
                  >
                    清空已选
                  </button>
                </div>
                <div
                  data-testid="selected-original-models-list"
                  className="min-h-[9rem] max-h-56 overflow-y-auto overscroll-contain px-3 py-2 [scrollbar-gutter:stable] md:min-h-0 md:max-h-none md:flex-1 md:basis-0"
                  onWheelCapture={stopNestedScrollPropagation}
                >
                  {draft.selectedOriginalModels.length > 0 ? (
                    <div className="flex flex-wrap content-start gap-1.5">
                      {draft.selectedOriginalModels.map(originalModel => (
                        <span
                          key={originalModel}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--accent)]/20 bg-[var(--accent-soft)]/70 px-2 py-0.5"
                        >
                          <code className="truncate font-mono text-[11px] text-[var(--text-primary)]">
                            {originalModel}
                          </code>
                          <button
                            type="button"
                            onClick={() => toggleOriginalModel(originalModel)}
                            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--danger)]"
                            aria-label={`取消选择 ${originalModel}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                      还没有选择原始模型
                    </div>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
                <div
                  data-testid="original-model-candidate-header"
                  className="flex min-h-10 items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2"
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">原始模型</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {filteredCandidates.length} 个候选
                  </div>
                </div>
                <div
                  data-testid="original-model-candidate-list"
                  className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain p-2.5"
                  onWheelCapture={stopNestedScrollPropagation}
                >
                  <div className="space-y-1.5">
                    {filteredCandidates.length > 0 ? (
                      filteredCandidates.map(candidate => {
                        const checked = draft.selectedOriginalModels.includes(
                          candidate.originalModel
                        );

                        return (
                          <label
                            key={candidate.originalModel}
                            className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 transition-colors ${
                              checked
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)]/60'
                                : 'border-[var(--line-soft)] bg-[var(--surface-2)] hover:border-[var(--icon-muted)]'
                            }`}
                          >
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                  : 'border-[var(--line-soft)] bg-[var(--surface-1)] text-transparent'
                              }`}
                            >
                              <Check className="h-3 w-3" />
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleOriginalModel(candidate.originalModel)}
                            />

                            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                              <code className="min-w-0 flex-1 font-mono text-[12px] text-[var(--text-primary)]">
                                {candidate.originalModel}
                              </code>
                              <div className="shrink-0 text-right text-[11px] text-[var(--text-secondary)]">
                                {candidate.siteCount} 站点 / {candidate.sourceCount} 来源
                              </div>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className="px-3 py-6 text-center text-sm text-[var(--text-secondary)]">
                        无匹配结果
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {errors.selectedOriginalModels ? (
              <div className="text-xs text-[var(--danger)]">{errors.selectedOriginalModels}</div>
            ) : null}
          </div>
        </div>
      </AppModal>

      <AppModal
        isOpen={routeRuleState !== null}
        onClose={closeRouteRules}
        title={routeRuleState ? `${routeRuleState.displayName} 路由规则` : '路由规则'}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <AppButton type="button" variant="secondary" onClick={closeRouteRules}>
              取消
            </AppButton>
            <AppButton type="button" onClick={handleSaveRouteRules} loading={saving}>
              保存路由规则
            </AppButton>
          </div>
        }
      >
        <div className="space-y-3 px-1 py-1.5">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              每条路由路径尝试次数
            </span>
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={routeRuleDraft.maxAttemptsPerRoutePath}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  maxAttemptsPerRoutePath: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  maxAttemptsPerRoutePath: undefined,
                }));
              }}
              placeholder={String(DEFAULT_ROUTE_RUNTIME_CONFIG.maxAttemptsPerRoutePath)}
              aria-label="每条路由路径尝试次数"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.maxAttemptsPerRoutePath ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.maxAttemptsPerRoutePath}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              禁用路由时间（分钟）
            </span>
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={routeRuleDraft.disableDurationMinutes}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  disableDurationMinutes: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  disableDurationMinutes: undefined,
                }));
              }}
              placeholder={String(DEFAULT_ROUTE_RUNTIME_CONFIG.disableDurationMinutes)}
              aria-label="禁用路由时间（分钟）"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.disableDurationMinutes ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.disableDurationMinutes}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              成功率计算时间（分钟）
            </span>
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={routeRuleDraft.successRateWindowMinutes}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  successRateWindowMinutes: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  successRateWindowMinutes: undefined,
                }));
              }}
              placeholder={String(DEFAULT_ROUTE_RUNTIME_CONFIG.successRateWindowMinutes)}
              aria-label="成功率计算时间（分钟）"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.successRateWindowMinutes ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.successRateWindowMinutes}
              </span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              最低成功率（%）
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={routeRuleDraft.minSuccessRatePercent}
              onChange={event => {
                setRouteRuleDraft(current => ({
                  ...current,
                  minSuccessRatePercent: event.target.value,
                }));
                setRouteRuleErrors(current => ({
                  ...current,
                  minSuccessRatePercent: undefined,
                }));
              }}
              placeholder={String(Math.round(DEFAULT_ROUTE_RUNTIME_CONFIG.minSuccessRate * 100))}
              aria-label="最低成功率（%）"
              className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
            />
            {routeRuleErrors.minSuccessRatePercent ? (
              <span className="text-xs text-[var(--danger)]">
                {routeRuleErrors.minSuccessRatePercent}
              </span>
            ) : null}
          </label>
        </div>
      </AppModal>

      {createApiKeyState ? (
        <CreateApiKeyDialog
          site={createApiKeyState.site}
          form={newApiKeyForm}
          groups={createApiKeyState.groups}
          creating={creatingApiKey}
          onFormChange={partial =>
            setNewApiKeyForm(current => ({
              ...current,
              ...partial,
            }))
          }
          onSubmit={() => void handleCreateApiKeySubmit()}
          onClose={closeCreateApiKeyDialog}
        />
      ) : null}
    </>
  );
}
