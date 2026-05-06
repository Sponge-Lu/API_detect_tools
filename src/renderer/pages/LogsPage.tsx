import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Eraser, Filter, History, Network, RefreshCw, Wrench } from 'lucide-react';
import {
  type RouteModelDisplayItem,
  type RouteModelRegistryConfig,
  type RouteModelSourceRef,
  type RouteRequestLogItem,
  type RouteRule,
} from '../../shared/types/route-proxy';
import type { ModelPriceInfo, ModelPricingData, UserGroupInfo } from '../../shared/types/site';
import { AppButton } from '../components/AppButton/AppButton';
import { AppCard, AppCardContent } from '../components/AppCard';
import { useConfigStore } from '../store/configStore';
import type { LogsSubtab } from '../store/uiStore';
import { useToastStore, type AppEventItem } from '../store/toastStore';
import { buildRouteRuleSummary } from '../utils/routeRulePresentation';

type EventFilter = 'all' | 'toast' | 'action';

const FILTER_OPTIONS: Array<{
  id: EventFilter;
  label: string;
  icon: typeof Filter;
}> = [
  { id: 'all', label: '全部', icon: Filter },
  { id: 'toast', label: '通知', icon: Bell },
  { id: 'action', label: '操作', icon: Wrench },
];

const LEVEL_STYLES: Record<
  AppEventItem['level'],
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
  error: {
    badge: 'border-[var(--danger)]/20 bg-[var(--danger-soft)] text-[var(--danger)]',
    dot: 'bg-[var(--danger)]',
    label: '错误',
  },
  warning: {
    badge: 'border-[var(--warning)]/20 bg-[var(--warning-soft)] text-[var(--warning)]',
    dot: 'bg-[var(--warning)]',
    label: '警告',
  },
  info: {
    badge: 'border-[var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]',
    dot: 'bg-[var(--accent)]',
    label: '信息',
  },
};

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

const KIND_LABELS: Record<AppEventItem['kind'], string> = {
  toast: '通知',
  action: '操作',
};

const CLI_LABELS: Record<RouteRequestLogItem['cliType'], string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  geminiCli: 'Gemini CLI',
};
const UNKNOWN_TEXT = '未知';
const NONE_TEXT = '无';
const DEFAULT_API_KEY_NAME = '默认';
const CUSTOM_CLI_LABEL_PREFIX = /^自定义\s*CLI\s*\/\s*/;

interface RouteLogRegistryContext {
  registry: RouteModelRegistryConfig | null;
  sourceByKey: Map<string, RouteModelSourceRef>;
}

interface RouteLogCostInfo {
  totalTokens: string;
  promptTokens: string;
  completionTokens: string;
  estimatedCost: string;
  hasEstimatedCost: boolean;
}

function RouteLogField({
  label,
  value,
  title,
  note,
}: {
  label: string;
  value: string;
  title?: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <span className="mr-1 text-[var(--text-tertiary)]">{label}</span>
      <span className="break-all text-[var(--text-primary)]" title={title}>
        {value}
      </span>
      {note ? <span className="ml-1 text-[10px] text-[var(--text-tertiary)]">{note}</span> : null}
    </div>
  );
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
  return name?.trim() || NONE_TEXT;
}

function formatTokenCount(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return NONE_TEXT;
  }

  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatEstimatedCost(value: number): string {
  if (!Number.isFinite(value)) {
    return NONE_TEXT;
  }

  if (value === 0) {
    return '≈0';
  }

  if (Math.abs(value) < 0.000001) {
    return `≈${value.toExponential(2)}`;
  }

  return `≈${new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 6,
  }).format(value)}`;
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

function findRouteLogDisplayItem(
  item: RouteRequestLogItem,
  source: RouteModelSourceRef | undefined,
  registry: RouteModelRegistryConfig | null
): RouteModelDisplayItem | undefined {
  const displayItems = registry?.displayItems || [];
  const canonicalName = item.canonicalModel?.trim();
  if (canonicalName) {
    const canonicalMatch = displayItems.find(
      displayItem => displayItem.canonicalName === canonicalName
    );
    if (canonicalMatch) {
      return canonicalMatch;
    }
  }

  if (!source) {
    return undefined;
  }

  return displayItems.find(displayItem => displayItem.sourceKeys.includes(source.sourceKey));
}

function resolveSitePriority(
  item: RouteRequestLogItem,
  displayItem: RouteModelDisplayItem | undefined,
  context: RouteLogRegistryContext
): string {
  if (!item.siteId || !displayItem) {
    return NONE_TEXT;
  }

  const explicitPriority = displayItem.priorityConfig?.sitePriorities?.[item.siteId];
  if (typeof explicitPriority === 'number' && Number.isFinite(explicitPriority)) {
    return String(explicitPriority);
  }

  const fallbackOrder = new Map<string, number>();
  for (const sourceKey of displayItem.sourceKeys) {
    const source = context.sourceByKey.get(sourceKey);
    if (source?.siteId && !fallbackOrder.has(source.siteId)) {
      fallbackOrder.set(source.siteId, fallbackOrder.size);
    }
  }

  const fallbackPriority = fallbackOrder.get(item.siteId);
  return fallbackPriority === undefined ? NONE_TEXT : String(fallbackPriority);
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

function getInputOutputPrices(
  pricingData: ModelPriceInfo | undefined
): { inputPrice: number; outputPrice: number } | null {
  const directInput = toFiniteNumber(pricingData?.input);
  const directOutput = toFiniteNumber(pricingData?.output);
  if (directInput !== null && directOutput !== null) {
    return { inputPrice: directInput, outputPrice: directOutput };
  }

  if (
    pricingData?.model_price &&
    typeof pricingData.model_price === 'object' &&
    !Array.isArray(pricingData.model_price)
  ) {
    const inputPrice = toFiniteNumber(pricingData.model_price.input);
    const outputPrice = toFiniteNumber(pricingData.model_price.output);
    if (inputPrice !== null && outputPrice !== null) {
      return { inputPrice, outputPrice };
    }
  }

  return null;
}

function resolveRouteLogCostInfo(
  item: RouteRequestLogItem,
  config: ReturnType<typeof useConfigStore.getState>['config'],
  customCli: boolean
): RouteLogCostInfo {
  const promptTokens = toFiniteNumber(item.promptTokens);
  const completionTokens = toFiniteNumber(item.completionTokens);
  const totalTokens =
    toFiniteNumber(item.totalTokens) ??
    (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);

  if (customCli) {
    return {
      totalTokens: formatTokenCount(totalTokens),
      promptTokens: formatTokenCount(promptTokens),
      completionTokens: formatTokenCount(completionTokens),
      estimatedCost: NONE_TEXT,
      hasEstimatedCost: false,
    };
  }

  const account = config?.accounts?.find(itemAccount => itemAccount.id === item.accountId);
  const cache = account?.cached_data;
  const pricingData = getModelPriceInfo(cache?.model_pricing, [
    item.resolvedModel,
    item.requestedModel,
    item.canonicalModel,
  ]);
  const prices = getInputOutputPrices(pricingData);

  if (promptTokens === null || completionTokens === null || !prices) {
    return {
      totalTokens: formatTokenCount(totalTokens),
      promptTokens: formatTokenCount(promptTokens),
      completionTokens: formatTokenCount(completionTokens),
      estimatedCost: NONE_TEXT,
      hasEstimatedCost: false,
    };
  }

  const userGroups: Record<string, UserGroupInfo> | undefined = cache?.user_groups;
  const groupMultiplier = item.userGroupKey ? (userGroups?.[item.userGroupKey]?.ratio ?? 1) : 1;
  const estimatedCost =
    (promptTokens * prices.inputPrice + completionTokens * prices.outputPrice) * groupMultiplier;

  return {
    totalTokens: formatTokenCount(totalTokens),
    promptTokens: formatTokenCount(promptTokens),
    completionTokens: formatTokenCount(completionTokens),
    estimatedCost: formatEstimatedCost(estimatedCost),
    hasEstimatedCost: true,
  };
}

function formatDuration(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }

  return `${Math.round(value)}ms`;
}

function formatLatency(total?: number, firstByte?: number): string {
  const parts: string[] = [];
  if (total !== undefined) {
    parts.push(`用时${formatDuration(total)}`);
  }
  if (firstByte !== undefined) {
    parts.push(`首字${formatDuration(firstByte)}`);
  }
  return parts.length > 0 ? parts.join('/') : UNKNOWN_TEXT;
}

function resolveRouteFailureInfo(item: RouteRequestLogItem): string | null {
  if (item.outcome !== 'failure') {
    return null;
  }

  const error = item.error?.trim();
  if (error) {
    return error;
  }

  if (item.statusCode !== undefined) {
    return `HTTP ${item.statusCode}`;
  }

  return '未知失败';
}

function EventCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function getRouteLogsUnavailableMessage(): string {
  const routeApi = window.electronAPI.route;
  if (routeApi?.getAnalyticsSummary || routeApi?.getConfig || routeApi?.listRules) {
    return '当前窗口使用的是旧版 preload/main。请完全重启应用后，再重新发起一次路由请求。注意：路由日志只保留当前运行会话，重启前的请求不会显示。';
  }

  return '当前环境未暴露路由日志接口。';
}

interface LogsPageProps {
  activeView?: LogsSubtab;
}

export function LogsPage({ activeView = 'session' }: LogsPageProps) {
  const appConfig = useConfigStore(state => state.config);
  const eventHistory = useToastStore(state => state.eventHistory);
  const clearEventHistory = useToastStore(state => state.clearEventHistory);
  const view = activeView;
  const [filter, setFilter] = useState<EventFilter>('all');
  const [routeLogs, setRouteLogs] = useState<RouteRequestLogItem[]>([]);
  const [routeLogsLoading, setRouteLogsLoading] = useState(false);
  const [routeLogsError, setRouteLogsError] = useState<string | null>(null);
  const [routeRulesById, setRouteRulesById] = useState<Record<string, RouteRule>>({});
  const [routeModelRegistry, setRouteModelRegistry] = useState<RouteModelRegistryConfig | null>(
    null
  );

  const loadRouteLogs = useCallback(async () => {
    const routeApi = window.electronAPI.route;
    if (!routeApi?.getRequestLogs) {
      setRouteLogs([]);
      setRouteLogsError(getRouteLogsUnavailableMessage());
      return;
    }

    setRouteLogsLoading(true);
    setRouteLogsError(null);
    try {
      const [result, routeConfigResult] = await Promise.all([
        routeApi.getRequestLogs({ limit: 200 }),
        routeApi.getConfig ? routeApi.getConfig() : Promise.resolve(null),
      ]);
      if (!result?.success) {
        setRouteLogs([]);
        setRouteLogsError(result?.error || '加载路由日志失败。');
        return;
      }
      setRouteLogs(result.data || []);
      if (routeConfigResult?.success) {
        const routeConfig = routeConfigResult.data as
          | { rules?: RouteRule[]; modelRegistry?: RouteModelRegistryConfig }
          | undefined;
        setRouteRulesById(
          Object.fromEntries((routeConfig?.rules || []).map((rule: RouteRule) => [rule.id, rule]))
        );
        setRouteModelRegistry(routeConfig?.modelRegistry ?? null);
      } else {
        setRouteRulesById({});
        setRouteModelRegistry(null);
      }
    } catch (error: unknown) {
      setRouteLogs([]);
      setRouteLogsError(error instanceof Error ? error.message : '加载路由日志失败。');
    } finally {
      setRouteLogsLoading(false);
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
    if (view === 'route') {
      void loadRouteLogs();
    }
  }, [loadRouteLogs, view]);

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return eventHistory;
    return eventHistory.filter(event => event.kind === filter);
  }, [eventHistory, filter]);

  const notificationCount = useMemo(
    () => eventHistory.filter(event => event.kind === 'toast').length,
    [eventHistory]
  );
  const actionCount = eventHistory.length - notificationCount;

  const routeSuccessCount = useMemo(
    () => routeLogs.filter(item => item.outcome === 'success').length,
    [routeLogs]
  );
  const routeFailureCount = useMemo(
    () => routeLogs.filter(item => item.outcome === 'failure').length,
    [routeLogs]
  );
  const routeNeutralCount = routeLogs.length - routeSuccessCount - routeFailureCount;
  const routeLogContext = useMemo(
    () => buildRouteLogRegistryContext(routeModelRegistry),
    [routeModelRegistry]
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 py-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <AppCard blur={false}>
          <AppCardContent className="p-5">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                {view === 'session' ? (
                  <History className="h-4 w-4 text-[var(--accent)]" />
                ) : (
                  <Network className="h-4 w-4 text-[var(--accent)]" />
                )}
                {view === 'session' ? '当前会话事件' : '路由日志'}
              </div>
            </div>

            {view === 'session' ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <EventCount label="总记录" value={eventHistory.length} />
                  <EventCount label="通知" value={notificationCount} />
                  <EventCount label="关键操作" value={actionCount} />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {FILTER_OPTIONS.map(option => {
                      const Icon = option.icon;
                      const selected = filter === option.id;

                      return (
                        <AppButton
                          key={option.id}
                          variant={selected ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => setFilter(option.id)}
                        >
                          <Icon className="h-4 w-4" />
                          {option.label}
                        </AppButton>
                      );
                    })}
                  </div>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    disabled={eventHistory.length === 0}
                    onClick={clearEventHistory}
                  >
                    <Eraser className="h-4 w-4" />
                    清空会话记录
                  </AppButton>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <EventCount label="总尝试" value={routeLogs.length} />
                  <EventCount label="成功" value={routeSuccessCount} />
                  <EventCount label="失败" value={routeFailureCount} />
                  <EventCount label="中性" value={routeNeutralCount} />
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <AppButton variant="secondary" size="sm" onClick={() => void loadRouteLogs()}>
                    <RefreshCw className="h-4 w-4" />
                    刷新
                  </AppButton>
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
              </>
            )}
          </AppCardContent>
        </AppCard>

        <AppCard className="flex min-h-0 flex-1 flex-col overflow-hidden" blur={false}>
          <AppCardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {view === 'session' ? '事件列表' : '请求尝试列表'}
              </div>
              <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                {view === 'session' ? filteredEvents.length : routeLogs.length} 条
              </span>
            </div>

            {view === 'session' ? (
              filteredEvents.length > 0 ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {filteredEvents.map((event, index) => {
                    const levelStyle = LEVEL_STYLES[event.level];
                    return (
                      <article
                        key={event.id}
                        className={`px-5 py-4 [contain-intrinsic-size:160px] [content-visibility:auto] ${
                          index === 0 ? '' : 'border-t border-[var(--line-soft)]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${levelStyle.badge}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${levelStyle.dot}`} />
                            {levelStyle.label}
                          </span>
                          <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                            {KIND_LABELS[event.kind]}
                          </span>
                          <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                            {event.source}
                          </span>
                          <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                            {formatTimestamp(event.createdAt)}
                          </span>
                        </div>
                        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--text-primary)]">
                          {event.message}
                        </pre>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
                  <div className="text-sm font-medium text-[var(--text-primary)]">暂无会话记录</div>
                </div>
              )
            ) : routeLogsLoading ? (
              <div className="flex flex-1 items-center justify-center px-5 py-10 text-sm text-[var(--text-secondary)]">
                正在加载路由日志...
              </div>
            ) : routeLogs.length > 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {routeLogs.map((item, index) => {
                  const outcomeStyle = ROUTE_OUTCOME_STYLES[item.outcome];
                  const routeRule = item.routeRuleId ? routeRulesById[item.routeRuleId] : undefined;
                  const routeSource = findRouteLogSource(item, routeLogContext);
                  const displayItem = findRouteLogDisplayItem(
                    item,
                    routeSource,
                    routeLogContext.registry
                  );
                  const customCli = isCustomCliLog(item, routeSource);
                  const siteOrConfigName = customCli
                    ? normalizeCustomCliConfigName(routeSource?.siteName || item.siteName)
                    : formatDisplayName(routeSource?.siteName || item.siteName);
                  const routeRuleTitle = routeRule ? buildRouteRuleSummary(routeRule) : undefined;
                  const costInfo = resolveRouteLogCostInfo(item, appConfig, customCli);
                  const failureInfo = resolveRouteFailureInfo(item);

                  return (
                    <article
                      key={item.id}
                      data-testid="route-request-log-row"
                      className={`px-4 py-2.5 [contain-intrinsic-size:104px] [content-visibility:auto] ${
                        index === 0 ? '' : 'border-t border-[var(--line-soft)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium ${outcomeStyle.badge}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${outcomeStyle.dot}`} />
                          {outcomeStyle.label}
                        </span>
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-secondary)]">
                          {CLI_LABELS[item.cliType]}
                        </span>
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[var(--text-secondary)]">
                          请求 {item.requestId}
                        </span>
                        <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-secondary)]">
                          尝试 #{item.attempt}
                        </span>
                        {item.statusCode !== undefined ? (
                          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-secondary)]">
                            HTTP {item.statusCode}
                          </span>
                        ) : null}
                        <span className="ml-auto whitespace-nowrap text-[var(--text-tertiary)]">
                          {formatLatency(item.latencyMs, item.firstByteLatencyMs)} ·{' '}
                          {formatTimestamp(item.createdAt)}
                        </span>
                      </div>

                      <div className="mt-1.5 grid gap-x-4 gap-y-1 text-xs md:grid-cols-2 xl:grid-cols-4">
                        <RouteLogField
                          label="规则"
                          value={formatOptionalDisplayName(item.routeRuleName || routeRule?.name)}
                          title={routeRuleTitle}
                        />
                        <RouteLogField
                          label="重定向模型"
                          value={formatOptionalDisplayName(item.canonicalModel)}
                        />
                        <RouteLogField
                          label="请求原始模型"
                          value={formatOptionalDisplayName(
                            item.requestedModel || item.resolvedModel
                          )}
                        />
                        <RouteLogField
                          label="站点优先级"
                          value={resolveSitePriority(item, displayItem, routeLogContext)}
                        />
                      </div>

                      <div className="mt-1 grid gap-x-4 gap-y-1 text-xs md:grid-cols-2 xl:grid-cols-4">
                        <RouteLogField label="站点" value={siteOrConfigName} />
                        <RouteLogField
                          label="账户"
                          value={
                            customCli
                              ? NONE_TEXT
                              : formatOptionalDisplayName(
                                  routeSource?.accountName || item.accountName
                                )
                          }
                        />
                        <RouteLogField
                          label="分组"
                          value={
                            customCli ? NONE_TEXT : formatOptionalDisplayName(item.userGroupKey)
                          }
                        />
                        <RouteLogField
                          label="API Key"
                          value={
                            customCli
                              ? DEFAULT_API_KEY_NAME
                              : formatOptionalDisplayName(item.apiKeyName)
                          }
                        />
                      </div>

                      <div className="mt-1 grid gap-x-4 gap-y-1 text-xs md:grid-cols-2 xl:grid-cols-4">
                        <RouteLogField label="总Token" value={costInfo.totalTokens} />
                        <RouteLogField label="输入Token" value={costInfo.promptTokens} />
                        <RouteLogField label="输出Token" value={costInfo.completionTokens} />
                        <RouteLogField
                          label="预计金额"
                          value={costInfo.estimatedCost}
                          title="仅供参考，不是实际花费金额；未计入缓存价格。"
                          note={costInfo.hasEstimatedCost ? '仅供参考，未计缓存价格' : undefined}
                        />
                      </div>

                      {failureInfo ? (
                        <div
                          data-testid="route-request-failure-info"
                          className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-[var(--danger)]"
                          title={failureInfo}
                        >
                          <span className="shrink-0 text-[var(--danger)]/80">失败信息</span>
                          <span className="min-w-0 truncate">{failureInfo}</span>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
                <div className="text-sm font-medium text-[var(--text-primary)]">暂无路由日志</div>
                {routeLogsError ? (
                  <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                    {routeLogsError}
                  </div>
                ) : null}
              </div>
            )}
          </AppCardContent>
        </AppCard>
      </div>
    </div>
  );
}
