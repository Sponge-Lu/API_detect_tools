import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eraser, Network } from 'lucide-react';
import {
  type RouteCliType,
  type RouteModelRegistryConfig,
  type RouteModelSourceRef,
  type RouteRequestLogItem,
} from '../../shared/types/route-proxy';
import type { ModelPriceInfo, ModelPricingData, UserGroupInfo } from '../../shared/types/site';
import ClaudeCodeIcon from '../assets/cli-icons/claude-code.svg';
import CodexIcon from '../assets/cli-icons/codex.svg';
import GeminiIcon from '../assets/cli-icons/gemini.svg';
import { AppButton } from '../components/AppButton/AppButton';
import { useConfigStore } from '../store/configStore';
import { useRouteStore } from '../store/routeStore';
import { resolveModelPricing } from '../utils/modelPricing';

type RouteCliFilter = 'all' | RouteCliType;

const ROUTE_OUTCOME_STYLES: Record<
  RouteRequestLogItem['outcome'],
  {
    badge: string;
    dot: string;
    label: string;
  }
> = {
  success: {
    badge: 'border-[var(--success)]/20 bg-[var(--success-soft)] text-[var(--success)]',
    dot: 'bg-[var(--success)]',
    label: '成功',
  },
  failure: {
    badge: 'border-[var(--danger)]/20 bg-[var(--danger-soft)] text-[var(--danger)]',
    dot: 'bg-[var(--danger)]',
    label: '失败',
  },
  neutral: {
    badge: 'border-[var(--warning)]/20 bg-[var(--warning-soft)] text-[var(--warning)]',
    dot: 'bg-[var(--warning)]',
    label: '中性',
  },
};

const CLI_LABELS: Record<RouteRequestLogItem['cliType'], string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  geminiCli: 'Gemini CLI',
};
const ROUTE_CLI_ICON_CONFIGS: Record<
  RouteRequestLogItem['cliType'],
  { icon: string; sizeClass: string }
> = {
  claudeCode: { icon: ClaudeCodeIcon, sizeClass: 'h-[18px] w-[18px]' },
  codex: { icon: CodexIcon, sizeClass: 'h-5 w-5' },
  geminiCli: { icon: GeminiIcon, sizeClass: 'h-5 w-5' },
};
const ROUTE_CLI_FILTER_OPTIONS: Array<{
  id: RouteCliFilter;
  label: string;
}> = [
  { id: 'all', label: '全部' },
  { id: 'claudeCode', label: CLI_LABELS.claudeCode },
  { id: 'codex', label: CLI_LABELS.codex },
  { id: 'geminiCli', label: CLI_LABELS.geminiCli },
];
const UNKNOWN_TEXT = '未知';
const EMPTY_VALUE_TEXT = '0';
const DEFAULT_API_KEY_NAME = '默认';
const CUSTOM_CLI_LABEL_PREFIX = /^自定义\s*CLI\s*\/\s*/;
const TOKEN_PRICE_UNIT = 1_000_000;
const CACHE_CREATION_INPUT_PRICE_RATIO = 1.25;
const CACHE_READ_INPUT_PRICE_RATIO = 0.1;
const ROUTE_LOG_VIEW_LIMIT = 200;
const ROUTE_LOG_SITE_NAME_MAX_CJK_LENGTH = 5;
const ROUTE_LOG_TABLE_STYLE = { minWidth: 'calc(62.5rem + 2ch)' };
const ROUTE_LOG_GRID_STYLE = {
  gridTemplateColumns:
    'minmax(2rem, 2fr) minmax(7rem, 7fr) minmax(calc(14rem + 2ch), 16fr) minmax(20rem, 20fr) minmax(4.5rem, 4.5fr) minmax(6rem, 6fr) minmax(3rem, 3fr) minmax(6rem, 6fr)',
};
const ROUTE_LOG_GRID_GAP = 'gap-x-2';
const ROUTE_LOG_TOKEN_GRID_STYLE = {
  gridTemplateColumns:
    'minmax(0, calc(20% - 1ch)) minmax(0, 20%) minmax(0, calc(20% - 2ch)) minmax(0, calc(20% + 1ch)) minmax(0, 20%)',
};
const ROUTE_LOG_HEADER_LABELS = [
  'CLI',
  '原始模型',
  '路由目标',
  'Token（总/输入/输出/缓存写/缓存读）',
  '预计金额',
  '用时/首字',
  '状态',
  '时间',
];

interface RouteLogRegistryContext {
  registry: RouteModelRegistryConfig | null;
  sourceByKey: Map<string, RouteModelSourceRef>;
}

interface RouteLogCostInfo {
  totalTokens: string;
  promptTokens: string;
  completionTokens: string;
  cacheCreationTokens: string;
  cacheReadTokens: string;
  estimatedCost: string;
}

interface RouteLogRowViewModel {
  item: RouteRequestLogItem;
  outcomeStyle: (typeof ROUTE_OUTCOME_STYLES)[RouteRequestLogItem['outcome']];
  failureInfo: string | null;
  requestedModelName: string;
  sitePathDisplay: string;
  compactTokenParts: Array<{ label: string; value: string }>;
  compactLatencyText: string;
  statusText: string;
  modelPathTitle: string;
  costInfo: RouteLogCostInfo;
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function formatDisplayName(name?: string): string {
  return name?.trim() || UNKNOWN_TEXT;
}

function formatOptionalDisplayName(name?: string | null): string {
  return name?.trim() || EMPTY_VALUE_TEXT;
}

function formatTokenCount(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '0';
  }

  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatEstimatedCost(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  if (value === 0) {
    return '0';
  }

  if (Math.abs(value) < 0.001) {
    return value
      .toExponential(3)
      .replace(/(\.\d*?[1-9])0+e/u, '$1e')
      .replace(/\.0+e/u, 'e');
  }

  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 3,
  }).format(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeCustomCliConfigName(name?: string | null): string {
  const normalized = name?.trim();
  if (!normalized) {
    return UNKNOWN_TEXT;
  }

  return normalized.replace(CUSTOM_CLI_LABEL_PREFIX, '').trim() || normalized;
}

function isCustomCliLog(item: RouteRequestLogItem, source?: RouteModelSourceRef): boolean {
  return (
    source?.sourceType === 'customCli' ||
    item.siteName?.trim().startsWith('自定义 CLI /') ||
    item.accountName?.trim() === '自定义 CLI' ||
    item.siteId?.startsWith('custom-cli-site-') === true
  );
}

function buildRouteLogRegistryContext(
  registry: RouteModelRegistryConfig | null
): RouteLogRegistryContext {
  return {
    registry,
    sourceByKey: new Map((registry?.sources || []).map(source => [source.sourceKey, source])),
  };
}

function findRouteLogSource(
  item: RouteRequestLogItem,
  context: RouteLogRegistryContext
): RouteModelSourceRef | undefined {
  const sources = context.registry?.sources || [];
  const candidateModels = new Set(
    [item.resolvedModel, item.requestedModel, item.canonicalModel]
      .map(model => model?.trim())
      .filter((model): model is string => !!model)
  );

  return sources.find(source => {
    if (item.siteId && source.siteId !== item.siteId) {
      return false;
    }
    if (item.accountId && source.accountId && source.accountId !== item.accountId) {
      return false;
    }
    if (
      item.apiKeyId &&
      source.availableApiKeys?.length &&
      !source.availableApiKeys.some(apiKey => apiKey.apiKeyId === item.apiKeyId)
    ) {
      return false;
    }
    if (candidateModels.size > 0 && !candidateModels.has(source.originalModel)) {
      return false;
    }
    return true;
  });
}

function formatRouteLogSitePath(params: {
  customCli: boolean;
  siteOrConfigName: string;
  accountDisplayName: string;
  userGroupDisplayName: string;
  apiKeyDisplayName: string;
}): string {
  if (params.customCli) {
    return `直连配置 / ${params.siteOrConfigName}`;
  }
  return `${params.siteOrConfigName} / ${params.accountDisplayName} / ${params.userGroupDisplayName} / ${params.apiKeyDisplayName}`;
}

function getRouteLogCharDisplayWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/.test(char) ? 2 : 1;
}

function truncateRouteLogSiteName(siteName: string): string {
  const maxWidth = ROUTE_LOG_SITE_NAME_MAX_CJK_LENGTH * 2;
  if (
    Array.from(siteName).reduce((total, char) => total + getRouteLogCharDisplayWidth(char), 0) <=
    maxWidth
  ) {
    return siteName;
  }

  const ellipsisWidth = getRouteLogCharDisplayWidth('…');
  let width = 0;
  let result = '';
  for (const char of siteName) {
    const charWidth = getRouteLogCharDisplayWidth(char);
    if (width + charWidth + ellipsisWidth > maxWidth) {
      break;
    }
    width += charWidth;
    result += char;
  }

  return `${result}…`;
}

function formatRouteLogCompactTokenParts(
  costInfo: RouteLogCostInfo
): Array<{ label: string; value: string }> {
  return [
    { label: 'T', value: costInfo.totalTokens },
    { label: 'IN', value: costInfo.promptTokens },
    { label: 'OUT', value: costInfo.completionTokens },
    { label: 'C.R', value: costInfo.cacheReadTokens },
    { label: 'C.W', value: costInfo.cacheCreationTokens },
  ];
}

function getModelPriceInfo(
  modelPricing: ModelPricingData | undefined,
  modelNames: Array<string | null | undefined>
): ModelPriceInfo | undefined {
  const pricingData = modelPricing?.data;
  if (!pricingData) {
    return undefined;
  }

  for (const modelName of modelNames) {
    const normalized = modelName?.trim();
    if (normalized && pricingData[normalized]) {
      return pricingData[normalized];
    }
  }

  return undefined;
}

function calculateRouteLogEstimatedCost(params: {
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  cachedTokens: number | null;
  inputPrice: number;
  outputPrice: number;
  groupMultiplier: number;
}): number {
  const cachedReadTokens = params.cacheReadTokens ?? 0;
  const cacheCreationTokens = params.cacheCreationTokens ?? 0;
  const promptTokensBilledAsInput =
    params.cachedTokens !== null
      ? Math.max(params.promptTokens - cachedReadTokens, 0)
      : params.promptTokens;
  const cacheCost =
    cacheCreationTokens * params.inputPrice * CACHE_CREATION_INPUT_PRICE_RATIO +
    cachedReadTokens * params.inputPrice * CACHE_READ_INPUT_PRICE_RATIO;

  return (
    ((promptTokensBilledAsInput * params.inputPrice +
      params.completionTokens * params.outputPrice +
      cacheCost) /
      TOKEN_PRICE_UNIT) *
    params.groupMultiplier
  );
}

function createBaseRouteLogCostInfo(params: {
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}): RouteLogCostInfo {
  return {
    totalTokens: formatTokenCount(params.totalTokens),
    promptTokens: formatTokenCount(params.promptTokens),
    completionTokens: formatTokenCount(params.completionTokens),
    cacheCreationTokens: formatTokenCount(params.cacheCreationTokens),
    cacheReadTokens: formatTokenCount(params.cacheReadTokens),
    estimatedCost: '0',
  };
}

function resolveRouteLogCostInfo(
  item: RouteRequestLogItem,
  config: ReturnType<typeof useConfigStore.getState>['config'],
  customCli: boolean
): RouteLogCostInfo {
  const promptTokens = toFiniteNumber(item.promptTokens);
  const completionTokens = toFiniteNumber(item.completionTokens);
  const cacheCreationTokens = toFiniteNumber(item.cacheCreationTokens);
  const cachedTokens = toFiniteNumber(item.cachedTokens);
  const cacheReadTokens = toFiniteNumber(item.cacheReadTokens) ?? cachedTokens;
  const totalTokens =
    toFiniteNumber(item.totalTokens) ??
    (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);
  const baseCostInfo = createBaseRouteLogCostInfo({
    totalTokens,
    promptTokens,
    completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
  });

  if (customCli) {
    return baseCostInfo;
  }

  const account = config?.accounts?.find(itemAccount => itemAccount.id === item.accountId);
  const cache = account?.cached_data;
  const pricingData = getModelPriceInfo(cache?.model_pricing, [
    item.resolvedModel,
    item.requestedModel,
    item.canonicalModel,
  ]);
  const pricing = resolveModelPricing(pricingData);
  const userGroups: Record<string, UserGroupInfo> | undefined = cache?.user_groups;
  const groupMultiplier = item.userGroupKey ? (userGroups?.[item.userGroupKey]?.ratio ?? 1) : 1;

  if (pricing.mode === 'perCall') {
    if (item.outcome !== 'success' || pricing.callPrice === null) {
      return baseCostInfo;
    }

    return {
      ...baseCostInfo,
      estimatedCost: formatEstimatedCost(pricing.callPrice * groupMultiplier),
    };
  }

  if (promptTokens === null || completionTokens === null) {
    return baseCostInfo;
  }

  if (pricing.inputPrice === null || pricing.outputPrice === null) {
    return baseCostInfo;
  }

  const estimatedCost = calculateRouteLogEstimatedCost({
    promptTokens,
    completionTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cachedTokens,
    inputPrice: pricing.inputPrice,
    outputPrice: pricing.outputPrice,
    groupMultiplier,
  });

  return {
    ...baseCostInfo,
    estimatedCost: formatEstimatedCost(estimatedCost),
  };
}

function formatDuration(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }

  return `${Math.round(value)}ms`;
}

function formatCompactLatency(total?: number, firstByte?: number): string {
  const parts: string[] = [];
  if (total !== undefined) {
    parts.push(formatDuration(total));
  }
  if (firstByte !== undefined) {
    parts.push(formatDuration(firstByte));
  }
  return parts.length > 0 ? parts.join('/') : UNKNOWN_TEXT;
}

function formatRouteLogStatusCode(statusCode?: number): string {
  return statusCode === undefined ? UNKNOWN_TEXT : String(statusCode);
}

function resolveRouteFailureInfo(item: RouteRequestLogItem): string | null {
  if (item.outcome !== 'failure') {
    return null;
  }

  const error = item.error?.trim();
  if (error) {
    if (item.statusCode !== undefined && isDuplicateRouteFailureCode(error, item.statusCode)) {
      return null;
    }

    return error;
  }

  if (item.statusCode !== undefined) {
    return null;
  }

  return '未知失败';
}

function isDuplicateRouteFailureCode(error: string, statusCode: number): boolean {
  const normalized = error.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === 'upstream_failed') {
    return true;
  }

  const compact = normalized.replace(/\s+/g, '');
  const statusText = String(statusCode);
  return (
    compact === statusText ||
    compact === `http${statusText}` ||
    normalized === 'bad_response_status_code' ||
    normalized === `bad response status code ${statusText}`
  );
}

function buildRouteLogRowViewModel(params: {
  item: RouteRequestLogItem;
  context: RouteLogRegistryContext;
  config: ReturnType<typeof useConfigStore.getState>['config'];
}): RouteLogRowViewModel {
  const { item, context, config } = params;
  const routeSource = findRouteLogSource(item, context);
  const customCli = isCustomCliLog(item, routeSource);
  const siteOrConfigName = customCli
    ? normalizeCustomCliConfigName(routeSource?.siteName || item.siteName)
    : formatDisplayName(routeSource?.siteName || item.siteName);
  const costInfo = resolveRouteLogCostInfo(item, config, customCli);
  const requestedModelName = formatOptionalDisplayName(item.resolvedModel || item.canonicalModel);
  const canonicalModelName = formatOptionalDisplayName(item.canonicalModel);
  const accountDisplayName = customCli
    ? EMPTY_VALUE_TEXT
    : formatOptionalDisplayName(routeSource?.accountName || item.accountName);
  const userGroupDisplayName = customCli
    ? EMPTY_VALUE_TEXT
    : formatOptionalDisplayName(item.userGroupKey);
  const apiKeyDisplayName = customCli
    ? DEFAULT_API_KEY_NAME
    : formatOptionalDisplayName(item.apiKeyName);
  const sitePathDisplay = formatRouteLogSitePath({
    customCli,
    siteOrConfigName: customCli ? siteOrConfigName : truncateRouteLogSiteName(siteOrConfigName),
    accountDisplayName,
    userGroupDisplayName,
    apiKeyDisplayName,
  });

  return {
    item,
    outcomeStyle: ROUTE_OUTCOME_STYLES[item.outcome],
    failureInfo: resolveRouteFailureInfo(item),
    requestedModelName,
    sitePathDisplay,
    compactTokenParts: formatRouteLogCompactTokenParts(costInfo),
    compactLatencyText: formatCompactLatency(item.latencyMs, item.firstByteLatencyMs),
    statusText: formatRouteLogStatusCode(item.statusCode),
    modelPathTitle: `${requestedModelName} → ${canonicalModelName}`,
    costInfo,
  };
}

function EventCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-[var(--text-primary)]">{value}</span>
    </span>
  );
}

function getRouteLogsUnavailableMessage(): string {
  const routeApi = window.electronAPI.route;
  if (routeApi?.getAnalyticsSummary || routeApi?.getConfig || routeApi?.listRules) {
    return '当前窗口使用的是旧版 preload/main。请完全重启应用后，再重新发起一次路由请求。注意：路由日志只保留当前运行会话，重启前的请求不会显示。';
  }

  return '当前环境未暴露路由日志接口。';
}

interface LoadRouteLogsOptions {
  background?: boolean;
  includeConfig?: boolean;
}

function prependRouteLogItem(
  currentLogs: RouteRequestLogItem[],
  nextLog: RouteRequestLogItem
): RouteRequestLogItem[] {
  return [nextLog, ...currentLogs.filter(item => item.id !== nextLog.id)].slice(
    0,
    ROUTE_LOG_VIEW_LIMIT
  );
}

export function LogsPage() {
  const appConfig = useConfigStore(state => state.config);
  const liveRouteConfig = useRouteStore(state => state.config);
  const [routeCliFilter, setRouteCliFilter] = useState<RouteCliFilter>('all');
  const [routeLogs, setRouteLogs] = useState<RouteRequestLogItem[]>([]);
  const [routeLogsLoading, setRouteLogsLoading] = useState(false);
  const [routeLogsError, setRouteLogsError] = useState<string | null>(null);
  const [routeModelRegistry, setRouteModelRegistry] = useState<RouteModelRegistryConfig | null>(
    null
  );

  useEffect(() => {
    if (!liveRouteConfig) {
      return;
    }

    setRouteModelRegistry(liveRouteConfig.modelRegistry ?? null);
  }, [liveRouteConfig]);

  const loadRouteLogs = useCallback(async (options?: LoadRouteLogsOptions) => {
    const background = options?.background ?? false;
    const includeConfig = options?.includeConfig ?? true;
    const routeApi = window.electronAPI.route;
    if (!routeApi?.getRequestLogs) {
      if (!background) {
        setRouteLogs([]);
      }
      setRouteLogsError(getRouteLogsUnavailableMessage());
      return;
    }

    if (!background) {
      setRouteLogsLoading(true);
      setRouteLogsError(null);
    }
    try {
      const [result, routeConfigResult] = await Promise.all([
        routeApi.getRequestLogs({ limit: ROUTE_LOG_VIEW_LIMIT }),
        includeConfig && routeApi.getConfig ? routeApi.getConfig() : Promise.resolve(null),
      ]);
      if (!result?.success) {
        if (!background) {
          setRouteLogs([]);
        }
        setRouteLogsError(result?.error || '加载路由日志失败。');
        return;
      }
      setRouteLogs(result.data || []);
      setRouteLogsError(null);
      if (includeConfig) {
        if (routeConfigResult?.success) {
          const routeConfig = routeConfigResult.data as
            | { modelRegistry?: RouteModelRegistryConfig }
            | undefined;
          setRouteModelRegistry(routeConfig?.modelRegistry ?? null);
        } else {
          setRouteModelRegistry(null);
        }
      }
    } catch (error: unknown) {
      if (!background) {
        setRouteLogs([]);
      }
      setRouteLogsError(error instanceof Error ? error.message : '加载路由日志失败。');
    } finally {
      if (!background) {
        setRouteLogsLoading(false);
      }
    }
  }, []);

  const clearRouteLogs = useCallback(async () => {
    const routeApi = window.electronAPI.route;
    if (!routeApi?.clearRequestLogs) {
      setRouteLogsError(getRouteLogsUnavailableMessage());
      return;
    }

    try {
      const result = await routeApi.clearRequestLogs();
      if (!result?.success) {
        setRouteLogsError(result?.error || '清空路由日志失败。');
        return;
      }
      setRouteLogs([]);
      setRouteLogsError(null);
    } catch (error: unknown) {
      setRouteLogsError(error instanceof Error ? error.message : '清空路由日志失败。');
    }
  }, []);

  useEffect(() => {
    void loadRouteLogs({ background: true });
  }, [loadRouteLogs]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.route?.onRequestLogAppended?.(item => {
      setRouteLogs(currentLogs => prependRouteLogItem(currentLogs, item));
      setRouteLogsError(null);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const routeLogContext = useMemo(
    () => buildRouteLogRegistryContext(routeModelRegistry),
    [routeModelRegistry]
  );
  const routeLogRows = useMemo(() => {
    const rows: RouteLogRowViewModel[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const item of routeLogs) {
      if (routeCliFilter !== 'all' && item.cliType !== routeCliFilter) {
        continue;
      }

      if (item.outcome === 'success') {
        successCount += 1;
      } else if (item.outcome === 'failure') {
        failureCount += 1;
      }

      rows.push(
        buildRouteLogRowViewModel({
          item,
          context: routeLogContext,
          config: appConfig,
        })
      );
    }

    return { rows, successCount, failureCount };
  }, [appConfig, routeCliFilter, routeLogContext, routeLogs]);
  const filteredRouteLogs = routeLogRows.rows;
  const routeSuccessCount = routeLogRows.successCount;
  const routeFailureCount = routeLogRows.failureCount;

  const content = (
    <>
      <header
        data-testid="logs-page-header"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line-soft)] px-5 py-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Network className="h-4 w-4 text-[var(--accent)]" />
            路由日志
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <EventCount label="总尝试" value={filteredRouteLogs.length} />
            <EventCount label="成功" value={routeSuccessCount} />
            <EventCount label="失败" value={routeFailureCount} />
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
              {filteredRouteLogs.length} 条
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ROUTE_CLI_FILTER_OPTIONS.map(option => {
            const selected = routeCliFilter === option.id;

            return (
              <AppButton
                key={option.id}
                variant={selected ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={selected}
                onClick={() => setRouteCliFilter(option.id)}
              >
                {option.label}
              </AppButton>
            );
          })}
          <AppButton
            variant="secondary"
            size="sm"
            disabled={routeLogs.length === 0}
            onClick={() => void clearRouteLogs()}
          >
            <Eraser className="h-4 w-4" />
            清空路由日志
          </AppButton>
        </div>
      </header>

      {routeLogsLoading ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-sm text-[var(--text-secondary)]">
          正在加载路由日志...
        </div>
      ) : filteredRouteLogs.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="w-full" style={ROUTE_LOG_TABLE_STYLE}>
            <div
              data-testid="route-request-log-header"
              className={`sticky top-0 z-10 grid ${ROUTE_LOG_GRID_GAP} items-center border-b border-[var(--line-muted)] bg-[var(--surface-1)] px-4 py-2 text-[11px] font-semibold text-[var(--text-tertiary)]`}
              style={ROUTE_LOG_GRID_STYLE}
            >
              {ROUTE_LOG_HEADER_LABELS.map(label => (
                <span key={label} className="min-w-0 truncate">
                  {label}
                </span>
              ))}
            </div>
            {filteredRouteLogs.map((row, index) => {
              const { item } = row;
              const cliIcon = ROUTE_CLI_ICON_CONFIGS[item.cliType];
              return (
                <article
                  key={item.id}
                  data-testid="route-request-log-row"
                  data-route-request-id={item.requestId}
                  className={`px-4 py-2 [contain-intrinsic-size:64px] [content-visibility:auto] ${
                    index === 0 ? '' : 'border-t border-[var(--line-muted)]'
                  }`}
                >
                  <div
                    data-testid="route-request-table-line"
                    className={`grid ${ROUTE_LOG_GRID_GAP} items-center text-xs`}
                    style={ROUTE_LOG_GRID_STYLE}
                  >
                    <span
                      data-testid="route-request-cli-icon"
                      className="inline-flex h-7 w-full items-center justify-start"
                      aria-label={CLI_LABELS[item.cliType]}
                    >
                      <img
                        src={cliIcon.icon}
                        alt=""
                        aria-hidden="true"
                        className={`${cliIcon.sizeClass} object-contain`}
                      />
                    </span>
                    <span
                      data-testid="route-request-model-path"
                      className="min-w-0 truncate text-[var(--text-primary)]"
                      title={row.modelPathTitle}
                    >
                      {row.requestedModelName}
                    </span>
                    <span
                      data-testid="route-request-site-path"
                      className="min-w-0 truncate text-[var(--text-primary)]"
                    >
                      {row.sitePathDisplay}
                    </span>
                    <span
                      data-testid="route-request-token-summary"
                      className="grid min-w-0 items-center gap-x-1 overflow-hidden whitespace-nowrap tabular-nums text-[var(--text-primary)]"
                      style={ROUTE_LOG_TOKEN_GRID_STYLE}
                    >
                      {row.compactTokenParts.map(part => (
                        <span key={part.label} className="inline-flex min-w-0 items-baseline">
                          <span className="shrink-0 font-mono text-[9.5px] font-semibold italic uppercase text-[var(--text-tertiary)]">
                            {part.label}
                          </span>
                          <span aria-hidden="true" className="shrink-0 whitespace-pre">
                            {' '}
                          </span>
                          <span className="min-w-0 truncate">{part.value}</span>
                        </span>
                      ))}
                    </span>
                    <span
                      data-testid="route-request-cost"
                      className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap"
                    >
                      <span className="min-w-0 truncate tabular-nums text-[var(--text-primary)]">
                        {row.costInfo.estimatedCost}
                      </span>
                    </span>
                    <span className="min-w-0 truncate tabular-nums text-[var(--text-primary)]">
                      {row.compactLatencyText}
                    </span>
                    <span
                      data-testid="route-request-status-code"
                      className={`min-w-0 truncate font-mono tabular-nums ${row.outcomeStyle.dot.replace(
                        'bg-',
                        'text-'
                      )}`}
                    >
                      {row.statusText}
                    </span>
                    <span className="min-w-0 truncate text-[var(--text-tertiary)]">
                      {formatTimestamp(item.createdAt)}
                    </span>
                  </div>
                  {row.failureInfo ? (
                    <div
                      data-testid="route-request-failure-info"
                      className={`mt-1 grid ${ROUTE_LOG_GRID_GAP} text-[11px]`}
                      style={ROUTE_LOG_GRID_STYLE}
                    >
                      <span className="col-start-2 col-span-7 min-w-0 truncate rounded border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-2 py-1 text-[var(--danger)]">
                        {row.failureInfo}
                      </span>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {routeLogs.length > 0 ? '当前 CLI 没有路由日志' : '暂无路由日志'}
          </div>
          {routeLogsError ? (
            <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
              {routeLogsError}
            </div>
          ) : null}
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 py-4">
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          data-testid="logs-page-surface"
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {content}
        </div>
      </div>
    </div>
  );
}
