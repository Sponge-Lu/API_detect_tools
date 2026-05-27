import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Bell,
  Eraser,
  Filter,
  History,
  Network,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import {
  type RouteCliType,
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
import { resolveModelPricing } from '../utils/modelPricing';
import { buildRouteRuleSummary } from '../utils/routeRulePresentation';

type EventFilter = 'all' | 'toast' | 'action';
type RouteCliFilter = 'all' | RouteCliType;

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
const ROUTE_CLI_STYLES: Record<RouteRequestLogItem['cliType'], string> = {
  claudeCode: 'border-[#d4a093] bg-[#d4a093] text-white',
  codex: 'border-[#93afa4] bg-[#93afa4] text-white',
  geminiCli: 'border-[#8aa9c7] bg-[#8aa9c7] text-white',
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
const NONE_TEXT = '无';
const DEFAULT_API_KEY_NAME = '默认';
const CUSTOM_CLI_LABEL_PREFIX = /^自定义\s*CLI\s*\/\s*/;
const TOKEN_PRICE_UNIT = 1_000_000;
const CACHE_CREATION_INPUT_PRICE_RATIO = 1.25;
const CACHE_READ_INPUT_PRICE_RATIO = 0.1;
const ROUTE_TOKEN_COST_TITLE =
  '仅供参考，不是实际花费金额；模型价格按每 1M token 计，缓存创建按输入价 1.25 倍、缓存命中按输入价 1/10 计入。';
const ROUTE_PER_CALL_COST_TITLE = '仅供参考，不是实际花费金额；按单次调用价格估算。';
const SITE_PATH_TOOLTIP_NORMAL =
  '依次为：站点 / 账户 / 分组 / API Key（此次请求最终命中的来源链路）';
const SITE_PATH_TOOLTIP_CUSTOM_CLI = '自定义 CLI 来源（账户 / 分组 / API Key 不适用）';
const ROUTE_COST_FORMULA_LABEL = '预计金额计算公式';
const ROUTE_SITE_PATH_INFO_LABEL = '路由目标字段说明';
const ROUTE_LOG_VIEW_LIMIT = 200;

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
  hasEstimatedCost: boolean;
  estimatedCostTitle?: string;
}

interface RouteLogTooltipPosition {
  top: number;
  left: number;
  maxWidth: number;
}

function RouteLogInfoIcon({ title, ariaLabel }: { title?: string; ariaLabel: string }) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [position, setPosition] = useState<RouteLogTooltipPosition>({
    top: 0,
    left: 0,
    maxWidth: 320,
  });

  useEffect(() => {
    if (!isOpen || !anchorRef.current) {
      return;
    }

    const anchorEl = anchorRef.current;
    let frameId = 0;
    const updatePosition = () => {
      const rect = anchorEl.getBoundingClientRect();
      const offset = 8;
      const viewportGutter = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxWidth = Math.min(360, Math.max(160, viewportWidth - viewportGutter * 2));

      setPosition({
        top: rect.bottom + offset,
        left: Math.max(
          viewportGutter,
          Math.min(rect.left, viewportWidth - maxWidth - viewportGutter)
        ),
        maxWidth,
      });
      setIsPositioned(false);

      frameId = requestAnimationFrame(() => {
        if (!tooltipRef.current) {
          return;
        }

        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width || maxWidth;
        const tooltipHeight = tooltipRect.height || 48;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const maxLeft = Math.max(viewportGutter, viewportWidth - tooltipWidth - viewportGutter);
        const maxTop = Math.max(viewportGutter, viewportHeight - tooltipHeight - viewportGutter);
        let nextTop = rect.bottom + offset;
        const nextLeft = rect.left + rect.width / 2 - tooltipWidth / 2;

        if (spaceBelow < tooltipHeight + 16 && spaceAbove > spaceBelow) {
          nextTop = rect.top - tooltipHeight - offset;
        }

        setPosition({
          top: Math.max(viewportGutter, Math.min(nextTop, maxTop)),
          left: Math.max(viewportGutter, Math.min(nextLeft, maxLeft)),
          maxWidth,
        });
        setIsPositioned(true);
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  if (!title) {
    return null;
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-label={ariaLabel}
        className="inline-flex shrink-0 cursor-help rounded-full text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        onBlur={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {isOpen
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className={`fixed z-[260] rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)] shadow-[var(--shadow-xl)] transition-opacity duration-100 ${
                isPositioned ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ top: position.top, left: position.left, maxWidth: position.maxWidth }}
            >
              {title}
            </div>,
            document.body
          )
        : null}
    </>
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

function formatRouteLogSitePath(params: {
  customCli: boolean;
  siteOrConfigName: string;
  accountDisplayName: string;
  userGroupDisplayName: string;
  apiKeyDisplayName: string;
}): string {
  if (params.customCli) {
    return params.siteOrConfigName;
  }
  return `${params.siteOrConfigName} / ${params.accountDisplayName} / ${params.userGroupDisplayName} / ${params.apiKeyDisplayName}`;
}

function formatRouteLogTokenSummary(
  totalTokens: string,
  promptTokens: string,
  completionTokens: string
): string {
  if (totalTokens === NONE_TEXT) {
    return 'Token 无';
  }
  return `Token ${totalTokens}（输入 ${promptTokens}，输出 ${completionTokens}）`;
}

function formatRouteLogCacheSummary(cacheCreationTokens: string, cacheReadTokens: string): string {
  const hasCreation = cacheCreationTokens !== NONE_TEXT && cacheCreationTokens !== '0';
  const hasRead = cacheReadTokens !== NONE_TEXT && cacheReadTokens !== '0';
  if (!hasCreation && !hasRead) {
    return '无缓存';
  }
  if (hasCreation && hasRead) {
    return `缓存 创建 ${cacheCreationTokens} · 命中 ${cacheReadTokens}`;
  }
  if (hasCreation) {
    return `缓存 创建 ${cacheCreationTokens}`;
  }
  return `缓存 命中 ${cacheReadTokens}`;
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
    estimatedCost: NONE_TEXT,
    hasEstimatedCost: false,
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
      hasEstimatedCost: true,
      estimatedCostTitle: ROUTE_PER_CALL_COST_TITLE,
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
    hasEstimatedCost: true,
    estimatedCostTitle: ROUTE_TOKEN_COST_TITLE,
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

interface LogsPageProps {
  activeView?: LogsSubtab;
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

export function LogsPage({ activeView = 'session' }: LogsPageProps) {
  const appConfig = useConfigStore(state => state.config);
  const eventHistory = useToastStore(state => state.eventHistory);
  const clearEventHistory = useToastStore(state => state.clearEventHistory);
  const view = activeView;
  const [filter, setFilter] = useState<EventFilter>('all');
  const [routeCliFilter, setRouteCliFilter] = useState<RouteCliFilter>('all');
  const [routeLogs, setRouteLogs] = useState<RouteRequestLogItem[]>([]);
  const [routeLogsLoading, setRouteLogsLoading] = useState(false);
  const [routeLogsError, setRouteLogsError] = useState<string | null>(null);
  const [routeRulesById, setRouteRulesById] = useState<Record<string, RouteRule>>({});
  const [routeModelRegistry, setRouteModelRegistry] = useState<RouteModelRegistryConfig | null>(
    null
  );

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
    if (view === 'route') {
      void loadRouteLogs({ background: true });
    }
  }, [loadRouteLogs, view]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.route?.onRequestLogAppended?.(item => {
      setRouteLogs(currentLogs => prependRouteLogItem(currentLogs, item));
      setRouteLogsError(null);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return eventHistory;
    return eventHistory.filter(event => event.kind === filter);
  }, [eventHistory, filter]);

  const notificationCount = useMemo(
    () => eventHistory.filter(event => event.kind === 'toast').length,
    [eventHistory]
  );
  const actionCount = eventHistory.length - notificationCount;

  const filteredRouteLogs = useMemo(() => {
    if (routeCliFilter === 'all') return routeLogs;
    return routeLogs.filter(item => item.cliType === routeCliFilter);
  }, [routeCliFilter, routeLogs]);

  const routeSuccessCount = useMemo(
    () => filteredRouteLogs.filter(item => item.outcome === 'success').length,
    [filteredRouteLogs]
  );
  const routeFailureCount = useMemo(
    () => filteredRouteLogs.filter(item => item.outcome === 'failure').length,
    [filteredRouteLogs]
  );
  const routeLogContext = useMemo(
    () => buildRouteLogRegistryContext(routeModelRegistry),
    [routeModelRegistry]
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 py-4">
      <div className="flex min-h-0 flex-1 flex-col">
        <AppCard className="flex min-h-0 flex-1 flex-col overflow-hidden" blur={false}>
          <AppCardContent className="flex min-h-0 flex-1 flex-col p-0">
            <header
              data-testid="logs-page-header"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line-soft)] px-5 py-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  {view === 'session' ? (
                    <History className="h-4 w-4 text-[var(--accent)]" />
                  ) : (
                    <Network className="h-4 w-4 text-[var(--accent)]" />
                  )}
                  {view === 'session' ? '当前会话事件' : '路由日志'}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {view === 'session' ? (
                    <>
                      <EventCount label="总记录" value={eventHistory.length} />
                      <EventCount label="通知" value={notificationCount} />
                      <EventCount label="关键操作" value={actionCount} />
                    </>
                  ) : (
                    <>
                      <EventCount label="总尝试" value={filteredRouteLogs.length} />
                      <EventCount label="成功" value={routeSuccessCount} />
                      <EventCount label="失败" value={routeFailureCount} />
                    </>
                  )}
                  <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    {view === 'session' ? filteredEvents.length : filteredRouteLogs.length} 条
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {view === 'session' ? (
                  <>
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
                    <AppButton
                      variant="secondary"
                      size="sm"
                      disabled={eventHistory.length === 0}
                      onClick={clearEventHistory}
                    >
                      <Eraser className="h-4 w-4" />
                      清空会话记录
                    </AppButton>
                  </>
                ) : (
                  <>
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
                      onClick={() => void loadRouteLogs({ background: true })}
                    >
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
                  </>
                )}
              </div>
            </header>

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
            ) : filteredRouteLogs.length > 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredRouteLogs.map((item, index) => {
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
                  const requestedModelName = formatOptionalDisplayName(
                    item.requestedModel || item.resolvedModel
                  );
                  const canonicalModelName = formatOptionalDisplayName(item.canonicalModel);
                  const sitePriority = resolveSitePriority(item, displayItem, routeLogContext);
                  const accountDisplayName = customCli
                    ? NONE_TEXT
                    : formatOptionalDisplayName(routeSource?.accountName || item.accountName);
                  const userGroupDisplayName = customCli
                    ? NONE_TEXT
                    : formatOptionalDisplayName(item.userGroupKey);
                  const apiKeyDisplayName = customCli
                    ? DEFAULT_API_KEY_NAME
                    : formatOptionalDisplayName(item.apiKeyName);
                  const sitePathDisplay = formatRouteLogSitePath({
                    customCli,
                    siteOrConfigName,
                    accountDisplayName,
                    userGroupDisplayName,
                    apiKeyDisplayName,
                  });
                  const sitePathTooltip = customCli
                    ? SITE_PATH_TOOLTIP_CUSTOM_CLI
                    : SITE_PATH_TOOLTIP_NORMAL;
                  const tokenSummaryText = formatRouteLogTokenSummary(
                    costInfo.totalTokens,
                    costInfo.promptTokens,
                    costInfo.completionTokens
                  );
                  const cacheSummaryText = formatRouteLogCacheSummary(
                    costInfo.cacheCreationTokens,
                    costInfo.cacheReadTokens
                  );
                  const modelPathTitle = `${requestedModelName} → ${canonicalModelName}`;

                  return (
                    <article
                      key={item.id}
                      data-testid="route-request-log-row"
                      className={`px-4 py-2.5 [contain-intrinsic-size:96px] [content-visibility:auto] ${
                        index === 0 ? '' : 'border-t border-[var(--line-soft)]'
                      }`}
                    >
                      <div
                        data-testid="route-request-meta-line"
                        className="grid grid-cols-1 gap-y-1 text-[11px] md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-x-3"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 py-0 font-medium ${ROUTE_CLI_STYLES[item.cliType]}`}
                          >
                            {CLI_LABELS[item.cliType]}
                          </span>
                          <span
                            className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[var(--text-secondary)]"
                            title={routeRuleTitle || item.routeRuleName}
                          >
                            请求 {item.requestId}
                          </span>
                          <span className="inline-flex h-5 items-center rounded-full bg-[var(--surface-2)] px-2 py-0 text-[var(--text-secondary)]">
                            尝试 #{item.attempt}
                          </span>
                          <span
                            className={`inline-flex h-5 items-center gap-1.5 rounded-full border px-2 py-0 font-medium ${outcomeStyle.badge}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${outcomeStyle.dot}`} />
                            {outcomeStyle.label}
                            {item.statusCode !== undefined ? (
                              <span className="text-[var(--text-secondary)]">
                                HTTP {item.statusCode}
                              </span>
                            ) : null}
                          </span>
                          {failureInfo ? (
                            <span
                              data-testid="route-request-failure-info"
                              className="inline-flex h-5 min-w-0 max-w-full flex-1 items-center gap-1 rounded-full border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-2 py-0 text-[var(--danger)] md:max-w-[32rem] md:flex-none"
                              title={failureInfo}
                            >
                              <span className="shrink-0 text-[var(--danger)]/80">失败信息</span>
                              <span className="min-w-0 truncate">{failureInfo}</span>
                            </span>
                          ) : null}
                        </div>
                        <span className="whitespace-nowrap text-[var(--text-tertiary)] md:justify-self-end">
                          {formatLatency(item.latencyMs, item.firstByteLatencyMs)} ·{' '}
                          {formatTimestamp(item.createdAt)}
                        </span>
                      </div>

                      <div
                        data-testid="route-request-detail-grid"
                        className="mt-1 grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_9rem] items-center gap-x-3 gap-y-0.5 text-xs"
                      >
                        <span className="font-medium tracking-wider text-[var(--text-tertiary)]">
                          路由
                        </span>
                        <span
                          data-testid="route-request-model-path"
                          className="min-w-0 truncate text-[var(--text-primary)]"
                          title={modelPathTitle}
                        >
                          {requestedModelName}
                          <span
                            aria-label="指向重定向模型"
                            className="mx-1 text-[var(--text-tertiary)]"
                          >
                            →
                          </span>
                          <span className="font-semibold">{canonicalModelName}</span>
                        </span>
                        <span
                          data-testid="route-request-site-path"
                          className="flex min-w-0 items-center gap-1"
                        >
                          <span
                            className="min-w-0 truncate text-[var(--text-primary)]"
                            title={sitePathDisplay}
                          >
                            {sitePathDisplay}
                          </span>
                          <RouteLogInfoIcon
                            ariaLabel={ROUTE_SITE_PATH_INFO_LABEL}
                            title={sitePathTooltip}
                          />
                        </span>
                        <span
                          data-testid="route-request-site-priority"
                          className="justify-self-start whitespace-nowrap"
                        >
                          <span className="text-[var(--text-tertiary)]">优先级 </span>
                          <span className="text-[var(--text-primary)]">{sitePriority}</span>
                        </span>

                        <span className="font-medium tracking-wider text-[var(--text-tertiary)]">
                          用量
                        </span>
                        <span
                          data-testid="route-request-token-summary"
                          className="min-w-0 truncate tabular-nums text-[var(--text-primary)]"
                          title={tokenSummaryText}
                        >
                          {tokenSummaryText}
                        </span>
                        <span
                          data-testid="route-request-cache-summary"
                          className="min-w-0 truncate tabular-nums text-[var(--text-primary)]"
                          title={cacheSummaryText}
                        >
                          {cacheSummaryText}
                        </span>
                        <span
                          data-testid="route-request-cost"
                          className="inline-flex min-w-0 items-center gap-1 justify-self-start whitespace-nowrap"
                        >
                          <span className="text-[var(--text-tertiary)]">预计金额 </span>
                          <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                            {costInfo.estimatedCost}
                          </span>
                          <RouteLogInfoIcon
                            ariaLabel={ROUTE_COST_FORMULA_LABEL}
                            title={costInfo.estimatedCostTitle}
                          />
                        </span>
                      </div>
                    </article>
                  );
                })}
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
          </AppCardContent>
        </AppCard>
      </div>
    </div>
  );
}
