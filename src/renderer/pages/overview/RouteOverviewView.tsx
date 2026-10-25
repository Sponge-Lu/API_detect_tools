import { SubViewProps } from './SiteOverviewView';
import {
  SectionTitle,
  MetricCard,
  RouteMetricCard,
  ModelDonutChart,
  RouteTrendChart,
  useContainerSize,
  RequestHeatGrid,
  CheckinStatusList,
} from './charts';
import {
  RouteWindow,
  TrendPoint,
  formatCompactNumber,
  formatPercent,
  formatCurrency,
  formatCheckinQuota,
  buildRouteTrendPoints,
  buildTrendDeltaSummary,
  formatTrendDeltaBadge,
  buildHourlyHeatCells,
} from './metrics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Gauge, Globe, Layers, Loader2, RefreshCw, Wallet } from 'lucide-react';
import type {
  RouteAnalyticsDistribution,
  RouteAnalyticsOverview,
  RouteAnalyticsSummary,
  RoutePathState,
} from '../../../shared/types/route-proxy';

import { AppButton } from '../../components/AppButton/AppButton';

import { AppCard, AppCardContent } from '../../components/AppCard';

import { useConfigStore } from '../../store/configStore';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';

import {
  buildSiteCheckinOverviewRows,
  buildSiteOverviewMetrics,
  sumNonNegativeBalances,
} from '../../utils/siteOverview';
import { computeLatencyPercentiles, formatLatency } from '../../utils/routeLatency';
import { computeFirstBytePercentiles, formatTtfb } from '../../utils/routeTtfb';
import { ROUTE_SCOPE_ALL, filterBucketsByScope } from '../../utils/routeScopeFilter';
import { buildCustomCliRouteSiteId } from '../../../shared/utils/customCliRouteId';
import { buildRouteScatterPoints, type ChannelNameLookup } from '../../utils/routeScatter';

import {
  buildEndpointDistribution,
  buildModelDistribution,
} from '../../utils/routeModelDistribution';

export type RouteSummary = RouteAnalyticsSummary;

export type RouteDistribution = RouteAnalyticsDistribution;

export function RouteOverviewView({
  setPageHeaderActions,
  isOverviewActive,
  isVisible,
}: SubViewProps) {
  const config = useConfigStore(state => state.config);
  const setConfig = useConfigStore(state => state.setConfig);
  const customCliConfigs = useCustomCliConfigStore(state => state.configs);
  const routeWindow: RouteWindow = '7d';
  const scope = ROUTE_SCOPE_ALL;
  const selectedModel = null;
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeDistribution, setRouteDistribution] = useState<RouteDistribution | null>(null);
  const [routePathStates, setRoutePathStates] = useState<Record<string, RoutePathState>>({});
  const [routeRulesById, setRouteRulesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [channelRankBy, setChannelRankBy] = useState<'requests' | 'successRate'>('requests');

  const siteMetrics = useMemo(() => (config ? buildSiteOverviewMetrics(config) : []), [config]);
  const enabledSiteMetrics = useMemo(
    () => siteMetrics.filter(metric => metric.enabled),
    [siteMetrics]
  );
  const checkinSiteMetrics = useMemo(
    () => enabledSiteMetrics.filter(metric => metric.supportsCheckin),
    [enabledSiteMetrics]
  );
  const checkinRows = useMemo(() => (config ? buildSiteCheckinOverviewRows(config) : []), [config]);
  const orderedCheckinRows = useMemo(
    () =>
      [...checkinRows].sort(
        (left, right) =>
          right.pendingCheckins - left.pendingCheckins ||
          right.todayCheckinQuota - left.todayCheckinQuota ||
          right.monthCheckinCount - left.monthCheckinCount
      ),
    [checkinRows]
  );
  const activeSiteCount = enabledSiteMetrics.length;
  const visibleSiteCount = siteMetrics.length;
  const activeModelCount = siteMetrics.reduce((sum, metric) => sum + metric.modelCount, 0);
  const totalBalance = sumNonNegativeBalances(siteMetrics);
  const totalUsage = siteMetrics.reduce((sum, metric) => sum + metric.todayUsage, 0);
  const totalTodayRequestCount = siteMetrics.reduce((sum, metric) => sum + metric.todayRequests, 0);
  const totalTodayPromptTokenCount = siteMetrics.reduce(
    (sum, metric) => sum + metric.todayPromptTokens,
    0
  );
  const totalTodayCompletionTokenCount = siteMetrics.reduce(
    (sum, metric) => sum + metric.todayCompletionTokens,
    0
  );
  const totalTodayTokenCount = totalTodayPromptTokenCount + totalTodayCompletionTokenCount;
  const totalCheckinQuota = checkinSiteMetrics.reduce(
    (sum, metric) => sum + metric.todayCheckinQuota,
    0
  );
  const pendingCheckinSiteCount = checkinSiteMetrics.filter(
    metric => metric.pendingCheckins > 0
  ).length;
  const completedCheckinSiteCount = checkinSiteMetrics.filter(
    metric => metric.pendingCheckins === 0 && metric.completedCheckins > 0
  ).length;

  const loadSiteOverview = useCallback(async () => {
    setSiteError(null);
    try {
      const [latestConfig] = await Promise.all([
        window.electronAPI.loadConfig(),
        window.electronAPI.overview?.getSiteDailySnapshots?.({ days: 1 }),
      ]);
      setConfig(latestConfig);
    } catch (nextError: unknown) {
      setSiteError(nextError instanceof Error ? nextError.message : '加载站点数据失败');
    }
  }, [setConfig]);

  const loadRouteData = useCallback(async () => {
    const routeApi = window.electronAPI.route;
    if (!routeApi) {
      setRouteError('当前环境未暴露 route IPC 接口。');
      return;
    }
    setLoading(true);
    setRouteError(null);
    try {
      const analyticsPromise: Promise<{
        summary: RouteAnalyticsOverview['summary'] | null;
        distribution: RouteAnalyticsOverview['distribution'] | null;
      }> = routeApi.getAnalyticsOverview
        ? routeApi.getAnalyticsOverview({ window: routeWindow }).then(overviewRes => {
            if (!overviewRes?.success) {
              throw new Error(overviewRes?.error || '加载路由总览失败');
            }
            return {
              summary: overviewRes.data?.summary || null,
              distribution: overviewRes.data?.distribution || null,
            };
          })
        : Promise.all([
            routeApi.getAnalyticsSummary({ window: routeWindow }),
            routeApi.getAnalyticsDistribution({ window: routeWindow }),
          ]).then(([summaryRes, distributionRes]) => {
            if (!summaryRes?.success) {
              throw new Error(summaryRes?.error || '加载路由汇总失败');
            }
            if (!distributionRes?.success) {
              throw new Error(distributionRes?.error || '加载路由分布失败');
            }
            return {
              summary: summaryRes.data || null,
              distribution: distributionRes.data || null,
            };
          });

      const [analyticsData, configRes] = await Promise.all([
        analyticsPromise,
        routeApi.getConfig(),
      ]);

      setRouteSummary(analyticsData.summary);
      setRouteDistribution(analyticsData.distribution);
      setRoutePathStates(configRes?.success ? configRes.data?.routePathStates || {} : {});
      const rulesData = configRes?.success ? configRes.data?.rules : null;
      if (Array.isArray(rulesData)) {
        const ruleMap: Record<string, string> = {};
        for (const rule of rulesData as Array<{ id?: string; name?: string }>) {
          if (rule?.id) ruleMap[rule.id] = rule.name || rule.id;
        }
        setRouteRulesById(ruleMap);
      } else {
        setRouteRulesById({});
      }
    } catch (nextError: unknown) {
      setRouteError(nextError instanceof Error ? nextError.message : '加载路由数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOverviewActive) return;
    void loadSiteOverview();
  }, [isOverviewActive, loadSiteOverview]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) return;
      if (!domains.includes('site-overview')) return;
      void loadSiteOverview();
    });
    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadSiteOverview]);

  useEffect(() => {
    if (!isOverviewActive) return;
    void loadRouteData();
  }, [isOverviewActive, loadRouteData]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) return;
      if (!domains.includes('route-overview')) return;
      void loadRouteData();
    });
    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadRouteData]);

  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          variant="tertiary"
          size="sm"
          className="!h-7 !min-h-7"
          onClick={() => {
            void loadSiteOverview();
            void loadRouteData();
          }}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          刷新
        </AppButton>
      </div>
    ),
    [loadRouteData, loadSiteOverview, loading]
  );

  useEffect(() => {
    if (!isOverviewActive || !isVisible) return;
    setPageHeaderActions?.(headerActions);
    return () => {
      setPageHeaderActions?.(null);
    };
  }, [headerActions, isOverviewActive, isVisible, setPageHeaderActions]);

  const filteredBuckets = useMemo(
    () => filterBucketsByScope(routeDistribution?.buckets || [], scope),
    [routeDistribution, scope]
  );
  const trendPoints = useMemo(
    () => buildRouteTrendPoints(filteredBuckets, routeWindow),
    [filteredBuckets, routeWindow]
  );
  const hasTrendData = trendPoints.some(point => point.hasData);
  const firstDataTrendIndex = trendPoints.findIndex(point => point.hasData);
  const isLeadingEmptyTrendPoint = useCallback(
    (index: number, point: TrendPoint) =>
      (!hasTrendData || index < firstDataTrendIndex) && !point.hasData,
    [firstDataTrendIndex, hasTrendData]
  );
  const requestTrend = trendPoints.map((point, index) =>
    isLeadingEmptyTrendPoint(index, point) ? null : point.requestCount
  );
  const successRateTrend = trendPoints.map((point, index) => {
    if (isLeadingEmptyTrendPoint(index, point)) return null;
    const denominator = point.successCount + point.failureCount;
    return denominator > 0 ? Number(((point.successCount / denominator) * 100).toFixed(1)) : 0;
  });
  const tokenTrend = trendPoints.map(point => point.totalTokens);
  const failureCounts = trendPoints.map(point => point.failureCount);
  const failureCountTotal = failureCounts.reduce((sum, count) => sum + count, 0);

  const scopedFirstByteHistogram = useMemo(() => {
    if (scope.kind === 'all') return routeDistribution?.firstByteHistogram || {};
    const merged: Record<string, number> = {};
    for (const bucket of filteredBuckets) {
      for (const [label, count] of Object.entries(bucket.firstByteHistogram || {})) {
        merged[label] = (merged[label] || 0) + count;
      }
    }
    return merged;
  }, [filteredBuckets, routeDistribution, scope]);
  const scopedLatencyHistogram = useMemo(() => {
    if (scope.kind === 'all') return routeDistribution?.latencyHistogram || {};
    const merged: Record<string, number> = {};
    for (const bucket of filteredBuckets) {
      for (const [label, count] of Object.entries(bucket.latencyHistogram || {})) {
        merged[label] = (merged[label] || 0) + count;
      }
    }
    return merged;
  }, [filteredBuckets, routeDistribution, scope]);

  const latencyPercentiles = useMemo(
    () => computeLatencyPercentiles(scopedLatencyHistogram),
    [scopedLatencyHistogram]
  );
  const ttfbPercentiles = useMemo(
    () => computeFirstBytePercentiles(scopedFirstByteHistogram),
    [scopedFirstByteHistogram]
  );
  const ttfbTrend = useMemo(
    () =>
      trendPoints.map((point, index) =>
        isLeadingEmptyTrendPoint(index, point)
          ? null
          : (computeFirstBytePercentiles(point.firstByteHistogram).p95 ?? null)
      ),
    [isLeadingEmptyTrendPoint, trendPoints]
  );

  const fullModelDistribution = useMemo(
    () => buildModelDistribution(filteredBuckets),
    [filteredBuckets]
  );
  const modelDistribution = useMemo(
    () => fullModelDistribution.slice(0, 8),
    [fullModelDistribution]
  );

  const endpointDistribution = useMemo(
    () => buildEndpointDistribution(filteredBuckets).slice(0, 8),
    [filteredBuckets]
  );

  const scopedRouteSummary = useMemo(() => {
    if (scope.kind === 'all') return routeSummary;
    const aggregate = filteredBuckets.reduce(
      (acc, bucket) => {
        acc.totalRequests += bucket.requestCount;
        acc.successCount += bucket.successCount;
        acc.failureCount += bucket.failureCount;
        acc.neutralCount += bucket.neutralCount;
        acc.promptTokens += bucket.promptTokens;
        acc.completionTokens += bucket.completionTokens;
        acc.totalTokens += bucket.totalTokens;
        acc.cachedTokens += bucket.cachedTokens || 0;
        acc.cacheCreationTokens += bucket.cacheCreationTokens || 0;
        acc.cacheReadTokens += bucket.cacheReadTokens || 0;
        return acc;
      },
      {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        neutralCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }
    );
    const denominator = aggregate.successCount + aggregate.failureCount;
    const successRate = denominator > 0 ? (aggregate.successCount / denominator) * 100 : 0;
    return { ...aggregate, successRate } satisfies RouteSummary;
  }, [filteredBuckets, routeSummary, scope]);

  const requestTrendSummary = useMemo(() => buildTrendDeltaSummary(requestTrend), [requestTrend]);
  const tokenTrendSummary = useMemo(() => buildTrendDeltaSummary(tokenTrend), [tokenTrend]);

  const ttfbHasSamples = ttfbPercentiles.sampleCount > 0 && ttfbPercentiles.p95 !== null;
  const ttfbHint = (() => {
    if (!ttfbHasSamples) {
      return `当前样本 ${ttfbPercentiles.sampleCount} < 20`;
    }
    return `P50 ${formatTtfb(ttfbPercentiles.p50)} · 样本 ${ttfbPercentiles.sampleCount}`;
  })();
  const ttfbToneClass =
    ttfbHasSamples && ttfbPercentiles.p95 !== null && ttfbPercentiles.p95 >= 60_000
      ? 'text-[var(--danger)]'
      : 'text-[var(--accent)]';

  const channelNameLookup = useMemo<ChannelNameLookup>(() => {
    const siteNameById = new Map<string, string>();
    const accountNameById = new Map<string, string>();
    const apiKeyNameById = new Map<string, string>();
    if (config) {
      for (const site of config.sites || []) {
        if (site?.id) siteNameById.set(site.id, site.name || site.id);
        const cacheKeys =
          (site as { cached_data?: { api_keys?: Array<{ id?: string | number; name?: string }> } })
            ?.cached_data?.api_keys || [];
        for (const info of cacheKeys) {
          const id = info?.id != null ? String(info.id) : null;
          if (id) apiKeyNameById.set(id, info.name || id);
        }
      }
      for (const account of config.accounts || []) {
        if (account?.id) accountNameById.set(account.id, account.account_name || account.id);
        const cacheKeys = account?.cached_data?.api_keys || [];
        for (const info of cacheKeys) {
          const id = info?.id != null ? String(info.id) : null;
          if (id) apiKeyNameById.set(id, info.name || id);
        }
      }
    }
    for (const customCli of customCliConfigs || []) {
      if (!customCli?.id) continue;
      const label = customCli.name?.trim() || '自定义 CLI';
      siteNameById.set(buildCustomCliRouteSiteId(customCli.id), label);
      accountNameById.set(`custom-cli-account-${encodeURIComponent(customCli.id)}`, label);
      apiKeyNameById.set(`custom-cli-key-${encodeURIComponent(customCli.id)}`, 'API Key');
    }
    return {
      resolveSiteName: id => siteNameById.get(id) || id || '未知站点',
      resolveAccountName: id => accountNameById.get(id) || id || '未知账户',
      resolveApiKeyName: id => apiKeyNameById.get(id) || id || 'API Key',
    };
  }, [config, customCliConfigs]);

  const knownSiteIds = useMemo(() => {
    const ids = new Set<string>();
    if (config) {
      for (const site of config.sites || []) {
        if (site?.id) ids.add(site.id);
      }
    }
    for (const customCli of customCliConfigs || []) {
      if (customCli?.id) ids.add(buildCustomCliRouteSiteId(customCli.id));
    }
    return ids;
  }, [config, customCliConfigs]);

  const scatterPoints = useMemo(
    () =>
      buildRouteScatterPoints(filteredBuckets, channelNameLookup).filter(point =>
        knownSiteIds.has(point.siteId)
      ),
    [filteredBuckets, channelNameLookup, knownSiteIds]
  );

  const { ref: routeContentRef, size: routeContentSize } = useContainerSize<HTMLDivElement>();
  const routeOverviewState = useMemo(
    () =>
      JSON.stringify({
        scope,
        selectedModel,
        pathStateCount: Object.keys(routePathStates).length,
        ruleCount: Object.keys(routeRulesById).length,
        scatterPointCount: scatterPoints.length,
      }),
    [routePathStates, routeRulesById, scatterPoints.length, scope, selectedModel]
  );

  const channelBarItems = useMemo(
    () =>
      scatterPoints
        .slice()
        .sort((a, b) =>
          channelRankBy === 'successRate'
            ? b.successRate - a.successRate || b.requests - a.requests
            : b.requests - a.requests
        )
        .slice(0, 8)
        .map(point => ({
          id: point.key,
          label: `${point.siteName} / ${point.accountName}`,
          value: point.requests,
          successRate: point.successRate,
        })),
    [scatterPoints, channelRankBy]
  );
  const donutItems = useMemo(
    () =>
      modelDistribution.map(item => ({
        id: item.canonicalModel,
        label: item.canonicalModel,
        value: item.requests,
      })),
    [modelDistribution]
  );
  const endpointDonutItems = useMemo(
    () =>
      endpointDistribution.map(item => ({
        id: item.endpoint,
        label: item.endpoint,
        value: item.requests,
      })),
    [endpointDistribution]
  );
  const heatValues = useMemo(
    () => buildHourlyHeatCells(filteredBuckets, Date.now()),
    [filteredBuckets]
  );
  const latencyTrend = useMemo(
    () =>
      trendPoints.map((point, index) =>
        isLeadingEmptyTrendPoint(index, point)
          ? null
          : (computeLatencyPercentiles(point.latencyHistogram).p90 ?? null)
      ),
    [isLeadingEmptyTrendPoint, trendPoints]
  );
  const p90LatencyValue =
    latencyPercentiles.sampleCount > 0 && latencyPercentiles.p90 !== null
      ? formatLatency(latencyPercentiles.p90)
      : '—';

  return (
    <div
      ref={routeContentRef}
      data-route-content-scroll="true"
      className="app-scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2.5 pt-2.5"
    >
      <div
        aria-label="数据总览驾驶舱"
        data-route-content-size={`${routeContentSize.width}x${routeContentSize.height}`}
        data-route-layout="classic-dashboard"
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden"
      >
        {siteError || routeError ? (
          <AppCard blur={false} hoverable={false}>
            <AppCardContent className="space-y-1 p-3 text-sm text-[var(--danger)]">
              {siteError ? <div>{siteError}</div> : null}
              {routeError ? <div>{routeError}</div> : null}
            </AppCardContent>
          </AppCard>
        ) : null}

        <div className="grid shrink-0 grid-cols-6 gap-1.5" data-overview-metric-grid="classic">
          <RouteMetricCard
            compact
            label="路由请求量"
            value={scopedRouteSummary ? formatCompactNumber(scopedRouteSummary.totalRequests) : '—'}
            hint={`窗口 ${routeWindow}`}
            chip={formatTrendDeltaBadge(
              requestTrendSummary.direction,
              requestTrendSummary.deltaPercent,
              requestTrendSummary.previousValue
            )}
            chipToneClass={
              requestTrendSummary.direction === 'up'
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : requestTrendSummary.direction === 'down'
                  ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
            }
            sparklineValues={requestTrend}
            sparklineClass="text-[var(--accent)]"
          />
          <RouteMetricCard
            compact
            label="路由成功率"
            value={scopedRouteSummary ? formatPercent(scopedRouteSummary.successRate) : '—'}
            hint={`失败 ${formatCompactNumber(scopedRouteSummary?.failureCount || 0)} 次`}
            toneClass={
              scopedRouteSummary && scopedRouteSummary.successRate < 80
                ? 'text-[var(--danger)]'
                : 'text-[var(--success)]'
            }
            chip={formatTrendDeltaBadge(
              buildTrendDeltaSummary(successRateTrend).direction,
              buildTrendDeltaSummary(successRateTrend).deltaPercent,
              buildTrendDeltaSummary(successRateTrend).previousValue
            )}
            chipToneClass={
              scopedRouteSummary && scopedRouteSummary.successRate < 80
                ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                : 'bg-[var(--success-soft)] text-[var(--success)]'
            }
            sparklineValues={successRateTrend}
            sparklineClass="text-[var(--success)]"
          />
          <RouteMetricCard
            compact
            label="P90 延迟"
            value={p90LatencyValue}
            hint={
              latencyPercentiles.sampleCount > 0
                ? `P99 ${formatLatency(latencyPercentiles.p99)} · 样本 ${latencyPercentiles.sampleCount}`
                : '样本不足'
            }
            toneClass="text-[var(--accent)]"
            sparklineValues={latencyTrend}
            sparklineClass="text-[var(--accent)]"
          />
          <RouteMetricCard
            compact
            label="首字 P95"
            value={ttfbHasSamples ? formatTtfb(ttfbPercentiles.p95) : '—'}
            hint={ttfbHint}
            toneClass={ttfbToneClass}
            sparklineValues={ttfbTrend}
            sparklineClass="text-[var(--success)]"
          />
          <RouteMetricCard
            compact
            label="Token 消耗"
            value={
              scopedRouteSummary && scopedRouteSummary.totalTokens > 0
                ? formatCompactNumber(scopedRouteSummary.totalTokens)
                : '暂无'
            }
            hint={
              scopedRouteSummary && scopedRouteSummary.totalTokens > 0
                ? `输入 ${formatCompactNumber(scopedRouteSummary.promptTokens)} / 输出 ${formatCompactNumber(scopedRouteSummary.completionTokens)}`
                : '暂无成功请求'
            }
            chip={formatTrendDeltaBadge(
              tokenTrendSummary.direction,
              tokenTrendSummary.deltaPercent,
              tokenTrendSummary.previousValue
            )}
            toneClass="text-[var(--warning)]"
            chipToneClass="bg-[var(--warning-soft)] text-[var(--warning)]"
            sparklineValues={tokenTrend}
            sparklineClass="text-[var(--warning)]"
          />
          <MetricCard
            compact
            label="活跃模型数"
            value={formatCompactNumber(fullModelDistribution.length)}
            hint={`站点 ${activeSiteCount} · 展示 ${visibleSiteCount}`}
            sparklineValues={tokenTrend}
            sparklineClass="text-[var(--accent)]"
          />
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(200px,0.26fr)] gap-1.5 overflow-hidden">
          <div className="grid min-h-0 grid-rows-[minmax(0,1.0625fr)_minmax(0,0.9375fr)] gap-1.5 overflow-hidden">
            <div className="grid min-h-0 grid-cols-3 gap-1.5 overflow-hidden">
              <RouteTrendChart
                trendPoints={trendPoints}
                successRateTrend={successRateTrend}
                requestTrend={requestTrend}
                failureCounts={failureCounts}
                failureCountTotal={failureCountTotal}
                compact
                className="col-span-2 min-h-0"
              />

              <AppCard blur={false} hoverable={false} data-testid="overview-channel-bars">
                <AppCardContent className="flex h-full min-h-0 flex-col p-2.5">
                  <SectionTitle
                    icon={Gauge}
                    title="通道分布"
                    actions={
                      <div
                        role="group"
                        aria-label="通道分布排行方式"
                        className="inline-flex h-5 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line-muted)] bg-[var(--surface-2)]"
                      >
                        <button
                          type="button"
                          aria-pressed={channelRankBy === 'requests'}
                          className={`h-full px-1.5 text-[11px] font-medium leading-none transition-colors ${
                            channelRankBy === 'requests'
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                          onClick={() => setChannelRankBy('requests')}
                        >
                          请求次数
                        </button>
                        <button
                          type="button"
                          aria-pressed={channelRankBy === 'successRate'}
                          className={`h-full border-l border-[var(--line-muted)] px-1.5 text-[11px] font-medium leading-none transition-colors ${
                            channelRankBy === 'successRate'
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                          onClick={() => setChannelRankBy('successRate')}
                        >
                          成功率
                        </button>
                      </div>
                    }
                  />
                  <div className="app-scrollbar-none min-h-0 flex-1 overflow-y-auto">
                    {channelBarItems.length > 0 ? (
                      <div className="space-y-1.5">
                        {channelBarItems.map(item => {
                          const maxValue = Math.max(
                            ...channelBarItems.map(entry => entry.value),
                            1
                          );
                          const tone =
                            item.successRate >= 0.9
                              ? 'bg-[var(--success)]'
                              : item.successRate >= 0.7
                                ? 'bg-[var(--warning)]'
                                : 'bg-[var(--danger)]';
                          return (
                            <div key={item.id} className="space-y-0.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span
                                  className="min-w-0 truncate text-[var(--text-secondary)]"
                                  title={item.label}
                                >
                                  {item.label}
                                </span>
                                <span className="tnum shrink-0 tabular-nums text-[var(--text-primary)]">
                                  {formatCompactNumber(item.value)} ·{' '}
                                  {(item.successRate * 100).toFixed(0)}%
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[var(--surface-2)]">
                                <div
                                  className={`h-1.5 rounded-full ${tone}`}
                                  style={{
                                    width: `${
                                      channelRankBy === 'successRate'
                                        ? Math.max(item.successRate * 100, 4)
                                        : Math.max((item.value / maxValue) * 100, 4)
                                    }%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-[var(--text-secondary)]">
                        暂无通道流量
                      </div>
                    )}
                  </div>
                </AppCardContent>
              </AppCard>
            </div>

            <div className="grid min-h-0 grid-cols-3 gap-1.5 overflow-hidden">
              <AppCard blur={false} hoverable={false} data-testid="overview-model-donut">
                <AppCardContent className="flex h-full min-h-0 flex-col p-2.5">
                  <SectionTitle icon={Layers} title="模型分布" />
                  <div className="min-h-0 flex-1">
                    <ModelDonutChart items={donutItems} />
                  </div>
                </AppCardContent>
              </AppCard>

              <AppCard blur={false} hoverable={false} data-testid="overview-endpoint-donut">
                <AppCardContent className="flex h-full min-h-0 flex-col p-2.5">
                  <SectionTitle icon={Globe} title="端点分布" />
                  <div className="min-h-0 flex-1">
                    <ModelDonutChart items={endpointDonutItems} emptyText="暂无端点分布" />
                  </div>
                </AppCardContent>
              </AppCard>

              <AppCard blur={false} hoverable={false} data-testid="overview-history-heat">
                <AppCardContent className="flex h-full min-h-0 flex-col p-2.5">
                  <SectionTitle icon={Activity} title="7d 请求热力" />
                  <div className="min-h-0 flex-1">
                    <RequestHeatGrid cells={heatValues} />
                  </div>
                </AppCardContent>
              </AppCard>
            </div>
          </div>

          <AppCard
            blur={false}
            hoverable={false}
            role="region"
            aria-label="站点汇总速览"
            className="min-h-0"
            data-testid="overview-site-summary"
          >
            <AppCardContent className="flex h-full min-h-0 flex-col gap-1.5 p-2.5">
              <SectionTitle icon={Wallet} title="站点汇总" />
              <div className="grid gap-1 rounded-md border border-[var(--line-muted)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">站点数</span>
                  <span
                    className="tnum min-w-0 truncate text-right text-[12px] font-semibold tabular-nums text-[var(--text-primary)]"
                    title={`站点 / 直连配置 ${activeSiteCount} / ${visibleSiteCount} · 模型 ${formatCompactNumber(activeModelCount)}`}
                  >
                    {activeSiteCount}
                    <span className="mx-1 font-normal text-[var(--text-tertiary)]">·</span>
                    直连 {visibleSiteCount}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">总余额</span>
                  <span className="tnum text-right text-[12px] font-semibold tabular-nums text-[var(--success)]">
                    {formatCurrency(totalBalance)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                    今日消费
                  </span>
                  <span
                    className="tnum min-w-0 truncate text-right text-[12px] font-semibold tabular-nums text-[var(--warning)]"
                    title={`请求 ${formatCompactNumber(totalTodayRequestCount)} · Tokens ${formatCompactNumber(totalTodayTokenCount)}`}
                  >
                    {formatCurrency(totalUsage)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">签到</span>
                  <span
                    className="tnum min-w-0 truncate text-right text-[12px] font-semibold tabular-nums text-[var(--text-primary)]"
                    title={`签到情况 ${formatCheckinQuota(totalCheckinQuota)}`}
                  >
                    已签 {completedCheckinSiteCount} / 待签 {pendingCheckinSiteCount}
                  </span>
                </div>
              </div>
              {orderedCheckinRows.length > 0 ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0.5">
                  <div className="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">
                    签到明细
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <CheckinStatusList
                      items={orderedCheckinRows}
                      emptyText="当前没有可展示的签到站点"
                    />
                  </div>
                </div>
              ) : null}
            </AppCardContent>
          </AppCard>
        </div>

        <span
          aria-hidden="true"
          data-route-overview-state={routeOverviewState}
          className="hidden"
        />
      </div>
    </div>
  );
}
