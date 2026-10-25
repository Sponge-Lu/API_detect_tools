import { resolveModelPricing } from '../../../utils/modelPricing';

import { expandRouteModelSourceKeys } from '../../../../shared/utils/routeModelGrouping';
import { type NewApiTokenForm } from '../../CreateApiKeyDialog/CreateApiKeyDialog';
import {
  buildRouteOverrideDisplayItemId,
  buildRouteApiKeyPriorityKey,
  DEFAULT_ROUTE_RUNTIME_CONFIG,
  inferRouteModelVendor,
  normalizeRouteRuntimeConfig,
  ROUTE_SUCCESSFUL_PATH_AFFINITY_MS,
} from '../../../../shared/types/route-proxy';
import type {
  RouteDisplayItemPriorityConfig,
  RouteModelDisplayItem,
  RouteModelAutoCollect,
  RouteModelMappingOverride,
  RouteModelRegistryConfig,
  RouteModelRegistryEntry,
  RouteModelSourceRef,
  RouteRequestLogItem,
  RouteInstance,
  RoutePathDisabledReason,
  RoutePathState,
  RouteSessionChannelBinding,
  RouteRuntimeConfig,
} from '../../../../shared/types/route-proxy';
import {
  normalizeCustomCliApiKeys,
  normalizeCustomCliGroupMultiplier,
  type CustomCliConfig,
} from '../../../../shared/types/custom-cli-config';
import type {
  ModelPriceInfo,
  ModelPricingData,
  UnifiedConfig,
} from '../../../../shared/types/site';
import { normalizeCliTargetProtocol } from '../../../../shared/types/cli-config';
import {
  formatRouteSessionLabel,
  sessionColorForSession,
  type RouteSessionOrdinalMap,
} from '../../../utils/routeSessionOrdinal';
import {
  parseCustomCliRouteApiKeyId,
  parseCustomCliRouteConfigId,
} from '../../../../shared/utils/customCliRouteId';

export interface RedirectCandidateGroup {
  originalModel: string;
  sourceKeys: string[];
  siteCount: number;
  sourceCount: number;
}

export interface RedirectDisplayItemView {
  item: RouteModelDisplayItem;
  entry: RouteModelRegistryEntry | null;
  displayName: string;
  selectedOriginalModels: string[];
}

export interface RedirectEditorDraft {
  canonicalName: string;
  selectedOriginalModels: string[];
  autoCollect?: RouteModelAutoCollect;
}

export interface DisplayItemDetailState {
  entry: RouteModelRegistryEntry;
  item: RouteModelDisplayItem;
}

export interface RouteRuntimeRuleDraft {
  maxAttemptsPerRoutePath: string;
  successRateWindowMinutes: string;
  disableDurationMinutes: string;
  minSuccessRatePercent: string;
}

export interface DetailApiKeyRow {
  key: string;
  apiKeyId: string;
  apiKeyName: string;
  accountId: string;
  accountName?: string;
  group: string;
  groupRatio?: number;
  groupMultiplier?: number;
  sourceType?: RouteModelSourceRef['sourceType'];
  supportedOriginalModels: string[];
  modelPriceLabels: Record<string, string>;
}

export interface DetailMissingApiKeyHint {
  key: string;
  accountId: string;
  accountName?: string;
  group: string;
  originalModels: string[];
}

export interface DetailSiteGroup {
  key: string;
  siteId: string;
  siteName: string;
  sourceType?: RouteModelSourceRef['sourceType'];
  siteBalance?: number;
  supportedOriginalModels: string[];
  apiKeys: DetailApiKeyRow[];
  missingGroupHints: DetailMissingApiKeyHint[];
}

export interface SiteOnlySourceNotice {
  key: string;
  siteName: string;
  originalModels: string[];
}

export interface PriorityDraft {
  sitePriorities: Record<string, string>;
  apiKeyPriorities: Record<string, string>;
  disabledSiteIds?: string[];
  disabledApiKeyPriorityKeys?: string[];
}

export type PriorityDisableState = Pick<
  PriorityDraft,
  'disabledSiteIds' | 'disabledApiKeyPriorityKeys'
>;

export interface PriorityDraftInput {
  sitePriorities?: Record<string, string | number | undefined>;
  apiKeyPriorities?: Record<string, string | number | undefined>;
  disabledSiteIds?: string[];
  disabledApiKeyPriorityKeys?: string[];
}

export interface RoutePathSuspensionLabel {
  originalModel: string;
  label: string;
  title: string;
  reason: RoutePathDisabledReason;
  disabledUntil: number;
}

/** 优先级表中一个原始模型的展示数据：价格是静态配置，暂停是运行态，两者分开承载 */
export interface PriorityModelEntry {
  model: string;
  priceLabel?: string;
  suspension?: { reason: RoutePathDisabledReason; disabledUntil: number };
}

export type PriorityRowStatus =
  | { kind: 'suspended'; reason: RoutePathDisabledReason; disabledUntil: number }
  | { kind: 'partial'; suspended: number; total: number; disabledUntil: number }
  | null;

export interface PriorityHitRoutePath {
  routeRuleId?: string;
  canonicalModel: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
  resolvedModel?: string;
  targetProtocol?: RouteRequestLogItem['targetProtocol'];
  lastSuccessAt: number;
}

export function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `redirect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function formatBalanceDisplay(balance: number | undefined): string | null {
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

export function formatGroupRatio(ratio: number | undefined): string | null {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) {
    return null;
  }

  return `×${Number.isInteger(ratio) ? ratio : ratio.toFixed(2)}`;
}

export function formatApiKeyAccountName(
  accountName: string | undefined,
  accountId: string
): string {
  return accountName?.trim() === '默认账户' ? '默认' : accountName || accountId;
}

export function formatPriceValue(price: number): string {
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

export function formatInputOutputPrice(
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

export function resolveModelPriceLabel(pricingData: ModelPriceInfo | undefined): string | null {
  if (!pricingData) {
    return null;
  }

  const pricing = resolveModelPricing(pricingData);
  if (pricing.mode === 'perCall') {
    return pricing.callPrice !== null ? `$${formatPriceValue(pricing.callPrice)}/次` : null;
  }

  return formatInputOutputPrice(pricing.inputPrice, pricing.outputPrice);
}

export function getModelPriceInfo(
  modelPricing: ModelPricingData | undefined,
  originalModel: string
): ModelPriceInfo | undefined {
  return modelPricing?.data?.[originalModel];
}

export function addModelPriceLabel(
  labels: Map<string, string>,
  originalModel: string,
  label: string | null
): void {
  if (!label || labels.has(originalModel)) {
    return;
  }

  labels.set(originalModel, label);
}

export function getCustomCliConfigForSource(
  source: RouteModelSourceRef,
  customCliConfigs?: CustomCliConfig[]
): CustomCliConfig | null {
  if (source.sourceType !== 'customCli') {
    return null;
  }

  const configId = parseCustomCliRouteConfigId(source.siteId);
  if (!configId) {
    return null;
  }

  return (customCliConfigs || []).find(item => item.id === configId) ?? null;
}

export function resolveCustomCliModelPriceLabel(
  source: RouteModelSourceRef,
  customCliConfigs?: CustomCliConfig[]
): string | null {
  const config = getCustomCliConfigForSource(source, customCliConfigs);
  if (!config) {
    return null;
  }

  return resolveModelPriceLabel(getModelPriceInfo(config.modelPricing, source.originalModel));
}

export function formatDirectMultiplier(multiplier: number | undefined): string | null {
  if (multiplier === undefined || multiplier === null || !Number.isFinite(multiplier)) {
    return null;
  }

  const normalized = Number(multiplier.toFixed(3));
  return `×${Number.isInteger(normalized) ? normalized : normalized.toString()}`;
}

export function formatPrioritySiteName(source: RouteModelSourceRef): string {
  if (source.sourceType !== 'customCli') {
    return source.siteName;
  }

  return source.siteName.replace(/^自定义\s*CLI\s*\/\s*/u, '').trim() || source.siteName;
}

export function formatPriorityApiKeyDetails(apiKey: DetailApiKeyRow): string {
  if (apiKey.sourceType === 'customCli') {
    const directMultiplier = formatDirectMultiplier(apiKey.groupMultiplier);
    return directMultiplier ? `${apiKey.apiKeyName}（${directMultiplier}）` : apiKey.apiKeyName;
  }

  const details = [
    formatApiKeyAccountName(apiKey.accountName, apiKey.accountId),
    apiKey.group,
    formatGroupRatio(apiKey.groupRatio),
  ]
    .filter(Boolean)
    .join(' / ');

  return details ? `${apiKey.apiKeyName}（${details}）` : apiKey.apiKeyName;
}

export function formatShortTime(timestamp: number | undefined): string {
  if (!timestamp) {
    return '--:--';
  }

  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ROUTE_PATH_DISABLED_REASON_LABELS: Record<
  Exclude<RoutePathDisabledReason, 'success_rate_below_threshold'>,
  string
> = {
  upstream_credential_rejected: '暂停·密钥无效',
  upstream_model_unavailable: '暂停·模型不可用',
  upstream_quota_exhausted: '暂停·余额耗尽',
};

/** 成功率原因需带上该项配置的阈值，故徽章短词走函数而非静态映射 */
export function formatRoutePathDisabledReasonLabel(
  reason: RoutePathDisabledReason,
  minSuccessRate?: number
): string {
  if (reason === 'success_rate_below_threshold') {
    return `暂停·成功率<${Math.round(
      (minSuccessRate ?? DEFAULT_ROUTE_RUNTIME_CONFIG.minSuccessRate) * 100
    )}%`;
  }
  return ROUTE_PATH_DISABLED_REASON_LABELS[reason];
}

export const ROUTE_PATH_DISABLED_REASON_TEXT: Record<RoutePathDisabledReason, string> = {
  upstream_credential_rejected: '上游拒绝该密钥',
  upstream_model_unavailable: '上游无此模型',
  upstream_quota_exhausted: '上游余额不足',
  success_rate_below_threshold: '成功率低于阈值',
};

/** 剩余时长优于绝对时刻：用户不必心算 */
export function formatRemainingDuration(disabledUntil: number, now: number): string {
  const remainingMs = Math.max(0, disabledUntil - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

/** 括号内只保留价格；暂停状态由行徽章与模型删除线承载，不再混入文本流 */
export function buildPriorityModelEntries(
  models: string[],
  modelPriceLabels?: Record<string, string>,
  suspensionsByModel?: Record<string, RoutePathSuspensionLabel[]>
): PriorityModelEntry[] {
  return models.map(model => {
    const suspension = suspensionsByModel?.[model]?.[0];
    return {
      model,
      priceLabel: modelPriceLabels?.[model],
      ...(suspension
        ? { suspension: { reason: suspension.reason, disabledUntil: suspension.disabledUntil } }
        : {}),
    };
  });
}

export function derivePriorityRowStatus(
  entries: PriorityModelEntry[],
  suspensions: RoutePathSuspensionLabel[]
): PriorityRowStatus {
  const suspended = entries.filter(entry => entry.suspension);
  if (suspended.length === 0) {
    return null;
  }

  const earliestUntil = Math.min(...suspended.map(entry => entry.suspension!.disabledUntil));
  if (suspended.length < entries.length) {
    return {
      kind: 'partial',
      suspended: suspended.length,
      total: entries.length,
      disabledUntil: earliestUntil,
    };
  }

  // 全部暂停时取占比最高的原因；同票时取最早恢复的一条，保证渲染稳定不闪烁。
  const byReason = new Map<RoutePathDisabledReason, { count: number; until: number }>();
  for (const entry of suspended) {
    const { reason, disabledUntil } = entry.suspension!;
    const current = byReason.get(reason);
    byReason.set(reason, {
      count: (current?.count ?? 0) + 1,
      until: Math.min(current?.until ?? disabledUntil, disabledUntil),
    });
  }
  const dominant = [...byReason.entries()].sort(
    (left, right) => right[1].count - left[1].count || left[1].until - right[1].until
  )[0];

  return {
    kind: 'suspended',
    reason: dominant?.[0] ?? suspensions[0]?.reason ?? 'success_rate_below_threshold',
    disabledUntil: dominant?.[1].until ?? earliestUntil,
  };
}

export function groupSuspensionLabelsByModel(
  suspensions: RoutePathSuspensionLabel[]
): Record<string, RoutePathSuspensionLabel[]> {
  return suspensions.reduce<Record<string, RoutePathSuspensionLabel[]>>((acc, suspension) => {
    acc[suspension.originalModel] = [...(acc[suspension.originalModel] || []), suspension];
    return acc;
  }, {});
}

export interface PrioritySessionDot {
  instanceId: string;
  displayName: string;
  color: string;
  channelKey: string;
}

export function buildSessionChannelKey(channel: {
  siteId?: string;
  accountId?: string;
  apiKeyId?: string;
}): string {
  return [channel.siteId || '', channel.accountId || '', channel.apiKeyId || ''].join('|');
}

/** 绑定 + 会话实例 → 色点。展示名沿用请求日志的解析顺序。 */
/**
 * 只展示绑定在**当前重定向模型**上的会话：会话 B 用的是模型 B，
 * 不能出现在模型 A 的优先级表里。绑定的 canonicalModel 每次成功都会刷新，
 * 因此它反映会话当前实际走的模型。
 */
export function buildPrioritySessionDots(
  bindings: RouteSessionChannelBinding[] | undefined,
  instances: Record<string, RouteInstance> | undefined,
  canonicalModel: string | undefined,
  ordinals?: RouteSessionOrdinalMap
): PrioritySessionDot[] {
  if (!bindings?.length || !canonicalModel) {
    return [];
  }

  return bindings
    .filter(binding => binding.canonicalModel === canonicalModel)
    .map(binding => {
      const instance = instances?.[binding.instanceId];
      if (!instance || instance.routingState !== 'active') {
        return null;
      }
      const routeKey = instance.routeKey;

      const agentName =
        instance.display.customAgentName ||
        instance.display.observedAgentName ||
        routeKey?.agentId ||
        binding.instanceId;
      const ordinal = ordinals?.[binding.instanceId];

      return {
        instanceId: binding.instanceId,
        // 同一客户端的多个会话窗口靠编号区分，编号与会话卡片上的一致
        displayName: formatRouteSessionLabel(agentName, ordinal),
        color: sessionColorForSession(routeKey?.agentId ?? binding.instanceId, ordinal),
        channelKey: buildSessionChannelKey(binding),
      };
    })
    .filter((dot): dot is PrioritySessionDot => dot !== null);
}

export function getActiveRoutePathSuspensionLabels(params: {
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
      const reason: RoutePathDisabledReason =
        state.disabledReason ?? 'success_rate_below_threshold';
      const model = state.resolvedModel || item.canonicalName;
      const reasonText =
        reason === 'success_rate_below_threshold'
          ? `成功率低于阈值${Math.round(runtimeConfig.minSuccessRate * 100)}%`
          : ROUTE_PATH_DISABLED_REASON_TEXT[reason];

      return {
        originalModel: model,
        reason,
        disabledUntil: state.disabledUntil!,
        label: formatRoutePathDisabledReasonLabel(reason, runtimeConfig.minSuccessRate),
        title: `${model} ${reasonText}，暂停至 ${timeLabel}（${runtimeConfig.successRateWindowMinutes}分钟成功率 ${rate}%）`,
      };
    });
}

export function countActiveRoutePathStatesForItem(params: {
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

export function isRouteFirstHitPathLog(item: RouteRequestLogItem): item is RouteRequestLogItem & {
  canonicalModel: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
} {
  return (
    item.attempt === 1 &&
    Boolean(item.canonicalModel?.trim()) &&
    Boolean(item.siteId?.trim()) &&
    Boolean(item.accountId?.trim()) &&
    Boolean(item.apiKeyId?.trim())
  );
}

export function isNewerRouteRequestLog(
  candidate: RouteRequestLogItem,
  current: RouteRequestLogItem | undefined
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.createdAt !== current.createdAt) {
    return candidate.createdAt > current.createdAt;
  }

  return candidate.id.localeCompare(current.id) > 0;
}

export function upsertFirstHitPathLog(
  current: Record<string, RouteRequestLogItem>,
  item: RouteRequestLogItem,
  displayItemViews?: RedirectDisplayItemView[],
  localInvalidationCutoffs?: Record<string, number>
): Record<string, RouteRequestLogItem> {
  if (!isRouteFirstHitPathLog(item)) {
    return current;
  }

  if (displayItemViews) {
    const displayItemView = displayItemViews.find(
      currentView => currentView.item.canonicalName === item.canonicalModel
    );
    if (
      !displayItemView?.entry ||
      !getPriorityHitRoutePathFromLog(
        displayItemView.item,
        displayItemView.entry,
        item,
        localInvalidationCutoffs?.[item.canonicalModel]
      )
    ) {
      return current;
    }
  }

  const existing = current[item.canonicalModel];
  if (!isNewerRouteRequestLog(item, existing)) {
    return current;
  }

  return {
    ...current,
    [item.canonicalModel]: item,
  };
}

export function buildFirstHitPathLogsByCanonicalName(
  logs: RouteRequestLogItem[],
  registry?: RouteModelRegistryConfig,
  localInvalidationCutoffs?: Record<string, number>
): Record<string, RouteRequestLogItem> {
  const displayItemViews = registry ? buildDisplayItemViews(registry) : undefined;
  return logs.reduce<Record<string, RouteRequestLogItem>>(
    (acc, item) => upsertFirstHitPathLog(acc, item, displayItemViews, localInvalidationCutoffs),
    {}
  );
}

export function isPriorityHitPathInEntry(
  entry: RouteModelRegistryEntry,
  path: Pick<PriorityHitRoutePath, 'siteId' | 'accountId' | 'apiKeyId'>
): boolean {
  return entry.sources.some(
    source =>
      source.siteId === path.siteId &&
      source.accountId === path.accountId &&
      source.availableApiKeys?.some(
        apiKey => apiKey.accountId === path.accountId && apiKey.apiKeyId === path.apiKeyId
      )
  );
}

export function getPriorityHitInvalidationBoundary(
  item: RouteModelDisplayItem,
  localInvalidationCutoff?: number
): number | undefined {
  const persistedBoundary = item.priorityConfig?.affinityInvalidatedAt;
  if (persistedBoundary === undefined) {
    return localInvalidationCutoff;
  }
  if (localInvalidationCutoff === undefined) {
    return persistedBoundary;
  }
  return Math.max(persistedBoundary, localInvalidationCutoff);
}

export function isPriorityHitAfterInvalidationBoundary(
  requestSelectionStartedAt: number | undefined,
  boundary: number | undefined
): boolean {
  return (
    boundary === undefined ||
    (requestSelectionStartedAt !== undefined && requestSelectionStartedAt > boundary)
  );
}

export function getPriorityHitRoutePathFromState(params: {
  states: Record<string, RoutePathState> | undefined;
  item: RouteModelDisplayItem;
  entry: RouteModelRegistryEntry;
  now: number;
  localInvalidationCutoff?: number;
}): PriorityHitRoutePath | null {
  const { states, item, entry, now, localInvalidationCutoff } = params;
  if (!states) {
    return null;
  }

  const affinityCutoff = now - ROUTE_SUCCESSFUL_PATH_AFFINITY_MS;
  const invalidationBoundary = getPriorityHitInvalidationBoundary(item, localInvalidationCutoff);
  let selected: PriorityHitRoutePath | null = null;

  for (const state of Object.values(states)) {
    const canonicalModel = state.canonicalModel?.trim();
    const siteId = state.siteId?.trim();
    const accountId = state.accountId?.trim();
    const apiKeyId = state.apiKeyId?.trim();
    const lastSuccessAt = state.lastSuccessAt ?? 0;

    if (
      canonicalModel !== item.canonicalName ||
      !siteId ||
      !accountId ||
      !apiKeyId ||
      state.lastOutcome !== 'success' ||
      lastSuccessAt <= affinityCutoff ||
      !isPriorityHitAfterInvalidationBoundary(
        state.lastSuccessRequestStartedAt,
        invalidationBoundary
      ) ||
      !isPriorityHitPathInEntry(entry, { siteId, accountId, apiKeyId }) ||
      (state.affinitySuppressedUntil ?? 0) > now ||
      (state.disabledUntil ?? 0) > now
    ) {
      continue;
    }

    if (!selected || lastSuccessAt > selected.lastSuccessAt) {
      selected = {
        routeRuleId: state.routeRuleId,
        canonicalModel: item.canonicalName,
        siteId,
        accountId,
        apiKeyId,
        resolvedModel: state.resolvedModel,
        targetProtocol: state.targetProtocol,
        lastSuccessAt,
      };
    }
  }

  return selected;
}

export function getPriorityHitApiKeyKeyFromRouteLog(
  item: RouteModelDisplayItem,
  entry: RouteModelRegistryEntry,
  localInvalidationCutoff: number | undefined,
  logItem: RouteRequestLogItem | undefined
): string | null {
  return getPriorityHitApiKeyKey(
    getPriorityHitRoutePathFromLog(item, entry, logItem, localInvalidationCutoff)
  );
}

export function getPriorityHitApiKeyKey(hitPath: PriorityHitRoutePath | null): string | null {
  if (!hitPath) {
    return null;
  }

  return buildRouteApiKeyPriorityKey(hitPath.siteId, hitPath.accountId, hitPath.apiKeyId);
}

export function getPriorityHitRoutePathFromLog(
  item: RouteModelDisplayItem,
  entry: RouteModelRegistryEntry,
  logItem: RouteRequestLogItem | undefined,
  localInvalidationCutoff?: number
): PriorityHitRoutePath | null {
  if (!logItem || !isRouteFirstHitPathLog(logItem)) {
    return null;
  }

  const invalidationBoundary = getPriorityHitInvalidationBoundary(item, localInvalidationCutoff);
  if (
    logItem.canonicalModel !== item.canonicalName ||
    !isPriorityHitAfterInvalidationBoundary(
      logItem.requestSelectionStartedAt,
      invalidationBoundary
    ) ||
    !isPriorityHitPathInEntry(entry, logItem)
  ) {
    return null;
  }

  return {
    routeRuleId: logItem.routeRuleId,
    canonicalModel: item.canonicalName,
    siteId: logItem.siteId,
    accountId: logItem.accountId,
    apiKeyId: logItem.apiKeyId,
    resolvedModel: logItem.resolvedModel,
    targetProtocol: logItem.targetProtocol,
    lastSuccessAt: logItem.createdAt,
  };
}

export function getPriorityHitRoutePathResetParams(hitPath: PriorityHitRoutePath | null): {
  canonicalModel: string;
  siteId: string;
  accountId: string;
  apiKeyId: string;
  targetProtocol?: RouteRequestLogItem['targetProtocol'];
} | null {
  if (!hitPath) {
    return null;
  }

  // Reset the route channel, not just one upstream model variant under the same channel.
  return {
    canonicalModel: hitPath.canonicalModel,
    siteId: hitPath.siteId,
    accountId: hitPath.accountId,
    apiKeyId: hitPath.apiKeyId,
    targetProtocol: normalizeCliTargetProtocol(hitPath.targetProtocol),
  };
}

export function getPriorityValue(value: string | number | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round(parsed));
}

export function normalizePriorityKeyList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(values.map(value => String(value).trim()).filter(value => value.length > 0))
  );
}

export function normalizePriorityRecordToDraft(
  priorities: Record<string, string | number | undefined> | undefined
): Record<string, string> {
  if (!priorities) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(priorities)
      .map(([key, priority]) => [key.trim(), getPriorityValue(priority)] as const)
      .filter(
        (entry): entry is readonly [string, number] => entry[0].length > 0 && entry[1] !== null
      )
      .map(([key, priority]) => [key, String(priority)])
  );
}

export function isPrioritySiteDisabled(
  group: Pick<DetailSiteGroup, 'siteId'>,
  priorityDraft: Pick<PriorityDisableState, 'disabledSiteIds'>
): boolean {
  return normalizePriorityKeyList(priorityDraft.disabledSiteIds).includes(group.siteId);
}

export function isPriorityApiKeyDisabled(
  apiKey: Pick<DetailApiKeyRow, 'key'>,
  priorityDraft: Pick<PriorityDisableState, 'disabledApiKeyPriorityKeys'>
): boolean {
  return normalizePriorityKeyList(priorityDraft.disabledApiKeyPriorityKeys).includes(apiKey.key);
}

export function getEnabledPriorityApiKeys(
  group: DetailSiteGroup,
  priorityDraft: Pick<PriorityDisableState, 'disabledApiKeyPriorityKeys'>
): DetailApiKeyRow[] {
  return group.apiKeys.filter(apiKey => !isPriorityApiKeyDisabled(apiKey, priorityDraft));
}

export function hasEnabledPriorityApiKeys(
  group: DetailSiteGroup,
  priorityDraft: Pick<PriorityDisableState, 'disabledApiKeyPriorityKeys'>
): boolean {
  return getEnabledPriorityApiKeys(group, priorityDraft).length > 0;
}

export function canSortPrioritySite(
  group: DetailSiteGroup,
  priorityDraft: PriorityDisableState
): boolean {
  return (
    !isPrioritySiteDisabled(group, priorityDraft) && hasEnabledPriorityApiKeys(group, priorityDraft)
  );
}

export function buildDefaultSiteOrderIndex(
  detailSiteGroups: DetailSiteGroup[],
  priorityDraft: PriorityDisableState
): Map<string, number> {
  return new Map(
    detailSiteGroups
      .map((group, index) => ({ group, index }))
      .sort((left, right) => {
        const leftSortable = canSortPrioritySite(left.group, priorityDraft);
        const rightSortable = canSortPrioritySite(right.group, priorityDraft);

        if (leftSortable !== rightSortable) {
          return leftSortable ? -1 : 1;
        }

        return left.index - right.index;
      })
      .map((entry, order) => [entry.group.siteId, order] as const)
  );
}

export function getPrioritySortValue(
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

export function sortApiKeysByPriority(
  apiKeys: DetailApiKeyRow[],
  apiKeyPriorities: Record<string, string | number | undefined>,
  priorityDraft: PriorityDisableState
): DetailApiKeyRow[] {
  const defaultOrderIndex = new Map(apiKeys.map((apiKey, index) => [apiKey.key, index] as const));

  return apiKeys.slice().sort((left, right) => {
    const leftDisabled = isPriorityApiKeyDisabled(left, priorityDraft);
    const rightDisabled = isPriorityApiKeyDisabled(right, priorityDraft);

    if (leftDisabled !== rightDisabled) {
      return leftDisabled ? 1 : -1;
    }

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

export function sortDetailGroupsByPriority(
  detailSiteGroups: DetailSiteGroup[],
  priorityDraft: PriorityDraft | RouteDisplayItemPriorityConfig
): DetailSiteGroup[] {
  const defaultOrderIndex = buildDefaultSiteOrderIndex(detailSiteGroups, priorityDraft);

  return detailSiteGroups
    .slice()
    .sort((left, right) => {
      const leftSortable = canSortPrioritySite(left, priorityDraft);
      const rightSortable = canSortPrioritySite(right, priorityDraft);

      if (leftSortable !== rightSortable) {
        return leftSortable ? -1 : 1;
      }

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
      apiKeys: sortApiKeysByPriority(group.apiKeys, priorityDraft.apiKeyPriorities, priorityDraft),
    }));
}

export function buildPriorityRecordFromOrderedKeys(
  orderedKeys: string[],
  activeKeys: string[],
  existingPriorities: Record<string, string | number | undefined> | undefined
): Record<string, string> {
  const normalizedPriorities = normalizePriorityRecordToDraft(existingPriorities);
  const activeKeySet = new Set(activeKeys);
  const reservedPriorities = new Set<number>();
  const nextPriorities: Record<string, string> = {};

  for (const key of orderedKeys) {
    if (activeKeySet.has(key)) {
      continue;
    }

    const priority = getPriorityValue(normalizedPriorities[key]);
    if (priority === null) {
      continue;
    }

    nextPriorities[key] = String(priority);
    reservedPriorities.add(priority);
  }

  let nextPriority = 0;
  for (const key of activeKeys) {
    while (reservedPriorities.has(nextPriority)) {
      nextPriority += 1;
    }

    nextPriorities[key] = String(nextPriority);
    reservedPriorities.add(nextPriority);
    nextPriority += 1;
  }

  return nextPriorities;
}

export function buildSequentialPriorityDraft(
  detailSiteGroups: DetailSiteGroup[],
  currentDraft: PriorityDraftInput = {}
): PriorityDraft {
  const disabledSiteIds = normalizePriorityKeyList(currentDraft.disabledSiteIds);
  const disabledApiKeyPriorityKeys = normalizePriorityKeyList(
    currentDraft.disabledApiKeyPriorityKeys
  );
  const sortableGroups = detailSiteGroups.filter(group =>
    canSortPrioritySite(group, { disabledSiteIds, disabledApiKeyPriorityKeys })
  );

  return {
    sitePriorities: buildPriorityRecordFromOrderedKeys(
      detailSiteGroups.map(group => group.siteId),
      sortableGroups.map(group => group.siteId),
      currentDraft.sitePriorities
    ),
    apiKeyPriorities: detailSiteGroups.reduce<Record<string, string>>((acc, group) => {
      const groupPriorities = buildPriorityRecordFromOrderedKeys(
        group.apiKeys.map(apiKey => apiKey.key),
        getEnabledPriorityApiKeys(group, { disabledApiKeyPriorityKeys }).map(apiKey => apiKey.key),
        currentDraft.apiKeyPriorities
      );

      return Object.assign(acc, groupPriorities);
    }, {}),
    disabledSiteIds,
    disabledApiKeyPriorityKeys,
  };
}

export function serializePriorityConfig(draft: PriorityDraft): RouteDisplayItemPriorityConfig {
  const disabledSiteIds = normalizePriorityKeyList(draft.disabledSiteIds);
  const disabledApiKeyPriorityKeys = normalizePriorityKeyList(draft.disabledApiKeyPriorityKeys);

  return {
    sitePriorities: Object.fromEntries(
      Object.entries(draft.sitePriorities).map(([siteId, priority]) => [siteId, Number(priority)])
    ),
    apiKeyPriorities: Object.fromEntries(
      Object.entries(draft.apiKeyPriorities).map(([apiKeyKey, priority]) => [
        apiKeyKey,
        Number(priority),
      ])
    ),
    ...(disabledSiteIds.length > 0 ? { disabledSiteIds } : {}),
    ...(disabledApiKeyPriorityKeys.length > 0 ? { disabledApiKeyPriorityKeys } : {}),
  };
}

export function priorityDraftMatches(left: PriorityDraft, right: PriorityDraft): boolean {
  return (
    JSON.stringify(left.sitePriorities) === JSON.stringify(right.sitePriorities) &&
    JSON.stringify(left.apiKeyPriorities) === JSON.stringify(right.apiKeyPriorities) &&
    JSON.stringify(left.disabledSiteIds) ===
      JSON.stringify(normalizePriorityKeyList(right.disabledSiteIds)) &&
    JSON.stringify(left.disabledApiKeyPriorityKeys) ===
      JSON.stringify(normalizePriorityKeyList(right.disabledApiKeyPriorityKeys))
  );
}

export function getEffectivePriorityDisplayValue(
  key: string,
  priorities: Record<string, string | number | undefined>,
  orderedActiveKeys: string[]
): number | null {
  const explicitPriority = getPriorityValue(priorities[key]);
  if (explicitPriority === null) {
    const fallbackIndex = orderedActiveKeys.indexOf(key);
    return fallbackIndex >= 0 ? fallbackIndex : null;
  }

  const activePriorityValues = orderedActiveKeys
    .map(activeKey => getPriorityValue(priorities[activeKey]))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const priorityIndex = activePriorityValues.indexOf(explicitPriority);

  return priorityIndex >= 0 ? priorityIndex : null;
}

export function createDisplayOrderPriorityDraft(
  detailSiteGroups: DetailSiteGroup[],
  priorityConfig: RouteDisplayItemPriorityConfig
): PriorityDraft {
  return buildSequentialPriorityDraft(
    sortDetailGroupsByPriority(detailSiteGroups, priorityConfig),
    priorityConfig
  );
}

export function moveArrayItem<T>(items: T[], currentIndex: number, targetIndex: number): T[] {
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

export function getRegistrySourcePool(registry: RouteModelRegistryConfig): RouteModelSourceRef[] {
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

export function normalizeOriginalModelOrder(
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

export function buildDisplayItemEntry(
  displayItem: RouteModelDisplayItem,
  sourcePool: RouteModelSourceRef[],
  sourceByKey: Map<string, RouteModelSourceRef>,
  overrideBySource: Map<string, RouteModelMappingOverride>
): RouteModelRegistryEntry | null {
  const expandedSourceKeys = expandRouteModelSourceKeys(displayItem, sourcePool);
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

export function buildRedirectCandidateGroups(
  sources: RouteModelSourceRef[]
): RedirectCandidateGroup[] {
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

export function buildOverrideDisplayItems(
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

  const baseDisplayItems = registry.displayItems.filter(item => item.mode === 'manual');
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
    const expandedSourceKeys = expandRouteModelSourceKeys(itemWithOverrideSources, sourcePool);
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

export function buildDetailSiteAccountGroups(
  detailState: DisplayItemDetailState | null,
  fullConfig?: UnifiedConfig | null,
  customCliConfigs?: CustomCliConfig[]
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
      sourceType?: RouteModelSourceRef['sourceType'];
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
          groupMultiplier?: number;
          sourceType?: RouteModelSourceRef['sourceType'];
          supportedOriginalModels: Set<string>;
          modelPriceLabels: Map<string, string>;
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
          siteName: formatPrioritySiteName(source),
          sourceType: source.sourceType,
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
              groupMultiplier?: number;
              sourceType?: RouteModelSourceRef['sourceType'];
              supportedOriginalModels: Set<string>;
              modelPriceLabels: Map<string, string>;
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
    const modelPriceLabel =
      source.sourceType === 'customCli'
        ? resolveCustomCliModelPriceLabel(source, customCliConfigs)
        : resolveModelPriceLabel(getModelPriceInfo(modelPricing, source.originalModel));

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
      const customCliConfig = getCustomCliConfigForSource(source, customCliConfigs);
      const customCliApiKeyId = parseCustomCliRouteApiKeyId(apiKey.apiKeyId)?.keyId;
      const customCliApiKey = customCliConfig
        ? normalizeCustomCliApiKeys(customCliConfig.apiKeys, {
            legacyApiKey: customCliConfig.apiKey,
            legacyName: customCliConfig.name,
            legacyGroupMultiplier: customCliConfig.groupMultiplier,
          }).find(item => item.id === customCliApiKeyId)
        : undefined;
      const groupMultiplier = customCliConfig
        ? normalizeCustomCliGroupMultiplier(
            customCliApiKey?.groupMultiplier ?? customCliConfig.groupMultiplier
          )
        : undefined;

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
            groupMultiplier,
            sourceType: source.sourceType,
            supportedOriginalModels: new Set<string>(),
            modelPriceLabels: new Map<string, string>(),
          };
          siteGroup.apiKeys.set(key, next);
          return next;
        })();

      apiKeyRow.supportedOriginalModels.add(source.originalModel);
      addModelPriceLabel(apiKeyRow.modelPriceLabels, source.originalModel, modelPriceLabel);
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
        sourceType: group.sourceType,
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
            groupMultiplier: apiKey.groupMultiplier,
            sourceType: apiKey.sourceType,
            supportedOriginalModels: Array.from(apiKey.supportedOriginalModels),
            modelPriceLabels: Object.fromEntries(apiKey.modelPriceLabels),
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

export function buildSiteOnlySourceNotices(
  detailState: DisplayItemDetailState | null
): SiteOnlySourceNotice[] {
  if (!detailState) {
    return [];
  }

  const { entry, item } = detailState;
  const sourceByKey = new Map(entry.sources.map(source => [source.sourceKey, source] as const));
  const selectedOriginalModels = normalizeOriginalModelOrder(
    item.originalModelOrder,
    item.sourceKeys,
    sourceByKey
  );
  const selectedModelSet = new Set(selectedOriginalModels);
  const noticesBySiteId = new Map<string, SiteOnlySourceNotice>();

  for (const source of entry.sources) {
    if (source.accountId && source.sourceType !== 'site') {
      continue;
    }

    if (!selectedModelSet.has(source.originalModel)) {
      continue;
    }

    const notice = noticesBySiteId.get(source.siteId) ?? {
      key: source.siteId,
      siteName: source.siteName || source.siteId,
      originalModels: [],
    };

    if (!notice.originalModels.includes(source.originalModel)) {
      notice.originalModels.push(source.originalModel);
    }

    noticesBySiteId.set(source.siteId, notice);
  }

  return Array.from(noticesBySiteId.values()).sort((left, right) =>
    left.siteName.localeCompare(right.siteName)
  );
}

export function createEmptyDraft(): RedirectEditorDraft {
  return {
    canonicalName: '',
    selectedOriginalModels: [],
  };
}

export function createEmptyPriorityDraft(): RouteDisplayItemPriorityConfig {
  return {
    sitePriorities: {},
    apiKeyPriorities: {},
  };
}

export function createRouteRuntimeRuleDraft(
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

export function isRouteRuntimeRuleDraftDirty(
  draft: RouteRuntimeRuleDraft,
  runtimeConfig?: Partial<RouteRuntimeConfig> | null
): boolean {
  const baseline = createRouteRuntimeRuleDraft(runtimeConfig);
  return (
    draft.maxAttemptsPerRoutePath !== baseline.maxAttemptsPerRoutePath ||
    draft.successRateWindowMinutes !== baseline.successRateWindowMinutes ||
    draft.disableDurationMinutes !== baseline.disableDurationMinutes ||
    draft.minSuccessRatePercent !== baseline.minSuccessRatePercent
  );
}

export function createDefaultNewApiKeyForm(group = 'default'): NewApiTokenForm {
  return {
    name: '',
    group,
    unlimitedQuota: true,
    quota: '',
    expiredTime: '',
  };
}
