import { SectionTitle, MetricCard, SiteTrendCard, RankedList, CheckinStatusList } from './charts';
import {
  AGGREGATED_SITE_OPTION_ID,
  formatCompactNumber,
  formatCurrency,
  formatCheckinQuota,
  formatSnapshotDayLabel,
  buildSevenDaySnapshotSeries,
  buildLiveTodaySnapshot,
  mergeLiveTodaySnapshot,
  buildAggregatedSiteSnapshots,
} from './metrics';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Loader2, RefreshCw, Wallet } from 'lucide-react';

import type { SiteDailySnapshot } from '../../../shared/types/site';
import { AppButton } from '../../components/AppButton/AppButton';
import { AppSelect } from '../../components/AppSelect';
import { AppCard, AppCardContent } from '../../components/AppCard';
import { ErrorState } from '../../components/ErrorState';
import { useConfigStore } from '../../store/configStore';

import {
  buildSiteCheckinOverviewRows,
  buildSiteOverviewMetrics,
  sumNonNegativeBalances,
  type SiteOverviewMetric,
} from '../../utils/siteOverview';

export const AGGREGATED_SITE_OPTION_LABEL = '全部站点（聚合）';

export interface SubViewProps {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
  isOverviewActive: boolean;
  isVisible: boolean;
}

export function SiteOverviewView({
  setPageHeaderActions,
  isOverviewActive,
  isVisible,
}: SubViewProps) {
  const config = useConfigStore(state => state.config);
  const [siteSnapshotsById, setSiteSnapshotsById] = useState<Record<string, SiteDailySnapshot[]>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(AGGREGATED_SITE_OPTION_ID);

  const siteMetrics = useMemo(() => (config ? buildSiteOverviewMetrics(config) : []), [config]);
  const rankedSiteMetrics = useMemo(
    () =>
      [...siteMetrics].sort(
        (left, right) => right.todayUsage - left.todayUsage || right.balance - left.balance
      ),
    [siteMetrics]
  );

  useEffect(() => {
    if (
      selectedSiteId !== AGGREGATED_SITE_OPTION_ID &&
      !rankedSiteMetrics.some(metric => metric.siteId === selectedSiteId)
    ) {
      setSelectedSiteId(AGGREGATED_SITE_OPTION_ID);
    }
  }, [rankedSiteMetrics, selectedSiteId]);

  const loadSnapshots = useCallback(async () => {
    if (!window.electronAPI.overview?.getSiteDailySnapshots) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snapshotsRes = await window.electronAPI.overview.getSiteDailySnapshots({ days: 30 });
      setSiteSnapshotsById(snapshotsRes?.success ? snapshotsRes.data || {} : {});
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '加载站点历史快照失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOverviewActive) return;
    void loadSnapshots();
  }, [isOverviewActive, loadSnapshots]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) return;
      if (!domains.includes('site-overview')) return;
      void loadSnapshots();
    });
    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadSnapshots]);

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
  const aggregatedSiteMetric = useMemo<SiteOverviewMetric | null>(() => {
    if (siteMetrics.length === 0) return null;

    return {
      siteId: AGGREGATED_SITE_OPTION_ID,
      siteName: AGGREGATED_SITE_OPTION_LABEL,
      enabled: true,
      accountCount: siteMetrics.reduce((sum, metric) => sum + metric.accountCount, 0),
      balance: sumNonNegativeBalances(siteMetrics),
      todayUsage: siteMetrics.reduce((sum, metric) => sum + metric.todayUsage, 0),
      todayRequests: siteMetrics.reduce((sum, metric) => sum + metric.todayRequests, 0),
      todayPromptTokens: siteMetrics.reduce((sum, metric) => sum + metric.todayPromptTokens, 0),
      todayCompletionTokens: siteMetrics.reduce(
        (sum, metric) => sum + metric.todayCompletionTokens,
        0
      ),
      totalTokens: siteMetrics.reduce((sum, metric) => sum + metric.totalTokens, 0),
      modelCount: siteMetrics.reduce((sum, metric) => sum + metric.modelCount, 0),
      lastRefresh: siteMetrics.reduce((max, metric) => Math.max(max, metric.lastRefresh), 0),
      hasError: siteMetrics.some(metric => metric.hasError),
      supportsCheckin: checkinSiteMetrics.length > 0,
      checkinTargetCount: checkinSiteMetrics.reduce(
        (sum, metric) => sum + metric.checkinTargetCount,
        0
      ),
      pendingCheckins: checkinSiteMetrics.reduce((sum, metric) => sum + metric.pendingCheckins, 0),
      completedCheckins: checkinSiteMetrics.reduce(
        (sum, metric) => sum + metric.completedCheckins,
        0
      ),
      todayCheckinQuota: totalCheckinQuota,
      monthCheckinCount: checkinSiteMetrics.reduce(
        (sum, metric) => sum + metric.monthCheckinCount,
        0
      ),
      totalCheckins: checkinSiteMetrics.reduce((sum, metric) => sum + metric.totalCheckins, 0),
    };
  }, [checkinSiteMetrics, siteMetrics, totalCheckinQuota]);
  const aggregatedSiteSnapshots = useMemo(
    () =>
      buildAggregatedSiteSnapshots(
        siteSnapshotsById,
        siteMetrics.map(metric => metric.siteId)
      ),
    [siteMetrics, siteSnapshotsById]
  );
  const selectedSiteSnapshots = useMemo(
    () =>
      selectedSiteId === AGGREGATED_SITE_OPTION_ID
        ? aggregatedSiteSnapshots
        : [...(siteSnapshotsById[selectedSiteId] || [])]
            .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
            .slice(-7),
    [aggregatedSiteSnapshots, selectedSiteId, siteSnapshotsById]
  );
  const currentSiteMetric =
    selectedSiteId === AGGREGATED_SITE_OPTION_ID
      ? aggregatedSiteMetric
      : rankedSiteMetrics.find(metric => metric.siteId === selectedSiteId) || null;
  const selectedSiteSnapshotsWithLiveToday = useMemo(
    () => mergeLiveTodaySnapshot(selectedSiteSnapshots, buildLiveTodaySnapshot(currentSiteMetric)),
    [currentSiteMetric, selectedSiteSnapshots]
  );
  const selectedSiteSnapshotSeries = useMemo(
    () => buildSevenDaySnapshotSeries(selectedSiteSnapshotsWithLiveToday),
    [selectedSiteSnapshotsWithLiveToday]
  );
  const latestSelectedSnapshotLabel = useMemo(() => {
    const latestSnapshot = [...selectedSiteSnapshotSeries]
      .reverse()
      .find((snapshot): snapshot is SiteDailySnapshot => snapshot !== null);
    return latestSnapshot ? formatSnapshotDayLabel(latestSnapshot.snapshotDate) : null;
  }, [selectedSiteSnapshotSeries]);

  const balanceRankItems = useMemo(
    () =>
      [...enabledSiteMetrics]
        .sort((left, right) => right.balance - left.balance)
        .map(metric => ({
          id: `${metric.siteId}:balance`,
          label: metric.siteName,
          value: metric.balance,
          sublabel: `${metric.accountCount || 1} 个账户 / ${metric.modelCount} 个模型`,
        })),
    [enabledSiteMetrics]
  );
  const usageRankItems = useMemo(
    () =>
      [...enabledSiteMetrics]
        .sort((left, right) => right.todayUsage - left.todayUsage)
        .map(metric => ({
          id: `${metric.siteId}:usage`,
          label: metric.siteName,
          value: metric.todayUsage,
          sublabel: `请求 ${metric.todayRequests} / Tokens ${formatCompactNumber(metric.totalTokens)}`,
        })),
    [enabledSiteMetrics]
  );

  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() => void loadSnapshots()}
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
    [loadSnapshots, loading]
  );

  useEffect(() => {
    if (!isOverviewActive || !isVisible) return;
    setPageHeaderActions?.(headerActions);
    return () => {
      setPageHeaderActions?.(null);
    };
  }, [headerActions, isOverviewActive, isVisible, setPageHeaderActions]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="space-y-4">
        {error ? (
          <AppCard blur={false} hoverable={false}>
            <AppCardContent className="p-2">
              <ErrorState className="py-4" title="数据加载失败" description={error} />
            </AppCardContent>
          </AppCard>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="可用站点数"
            value={formatCompactNumber(activeSiteCount)}
            hint={`展示站点 ${visibleSiteCount} 个 / 模型 ${formatCompactNumber(activeModelCount)} 个`}
          />
          <MetricCard
            label="站点总余额"
            value={formatCurrency(totalBalance)}
            hint={`最近刷新 ${
              currentSiteMetric?.siteId === AGGREGATED_SITE_OPTION_ID
                ? '按站点聚合'
                : currentSiteMetric?.siteName || '按活跃站点排序'
            }`}
          />
          <MetricCard
            label="今日消费"
            value={formatCurrency(totalUsage)}
            hint={`今日请求 ${formatCompactNumber(totalTodayRequestCount)} · 今日 Tokens ${formatCompactNumber(totalTodayTokenCount)}`}
            toneClass="text-[var(--warning)]"
          />
          <MetricCard
            label="今日签到收益"
            value={formatCheckinQuota(totalCheckinQuota)}
            hint={`已签 ${completedCheckinSiteCount} 个 / 待签 ${pendingCheckinSiteCount} 个`}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] xl:items-stretch">
          <AppCard
            blur={false}
            hoverable={false}
            role="region"
            aria-label="每日签到概览"
            className="xl:h-[248px]"
          >
            <AppCardContent className="flex h-full flex-col p-3.5">
              <SectionTitle icon={Activity} title="每日签到概览" />
              <div className="mt-0.5 min-h-0 flex-1">
                <CheckinStatusList
                  items={orderedCheckinRows}
                  emptyText="当前没有可展示的签到站点"
                />
              </div>
            </AppCardContent>
          </AppCard>

          <AppCard
            blur={false}
            hoverable={false}
            role="region"
            aria-label="站点资源概览"
            className="xl:h-[248px]"
          >
            <AppCardContent className="flex h-full flex-col p-3.5">
              <SectionTitle icon={Wallet} title="站点资源概览" />
              <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
                <div className="min-h-0">
                  <div className="mb-2 text-xs text-[var(--text-secondary)]">余额最高站点</div>
                  <div className="h-full overflow-y-auto pr-1">
                    <RankedList
                      items={balanceRankItems}
                      valueFormatter={formatCurrency}
                      emptyText="暂无站点余额数据"
                      compact
                    />
                  </div>
                </div>
                <div className="min-h-0">
                  <div className="mb-2 text-xs text-[var(--text-secondary)]">今日消费最高站点</div>
                  <div className="h-full overflow-y-auto pr-1">
                    <RankedList
                      items={usageRankItems}
                      valueFormatter={formatCurrency}
                      emptyText="暂无站点消费数据"
                      compact
                    />
                  </div>
                </div>
              </div>
            </AppCardContent>
          </AppCard>
        </div>

        <AppCard blur={false} hoverable={false}>
          <AppCardContent className="p-4">
            <SectionTitle
              icon={Activity}
              title="站点历史趋势"
              actions={
                <AppSelect
                  aria-label="选择站点历史"
                  size="sm"
                  containerClassName="w-auto"
                  className="h-7 py-1 text-xs"
                  value={selectedSiteId}
                  onChange={event =>
                    setSelectedSiteId(event.target.value || AGGREGATED_SITE_OPTION_ID)
                  }
                >
                  <option value={AGGREGATED_SITE_OPTION_ID}>{AGGREGATED_SITE_OPTION_LABEL}</option>
                  {rankedSiteMetrics.map(metric => (
                    <option key={metric.siteId} value={metric.siteId}>
                      {metric.siteName}
                    </option>
                  ))}
                </AppSelect>
              }
            />

            {selectedSiteSnapshotSeries.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <SiteTrendCard
                  label="近 7 日余额波动"
                  values={selectedSiteSnapshotSeries.map(snapshot => snapshot?.balance ?? null)}
                  valueFormatter={formatCurrency}
                  chartVariant="area"
                  areaClass="text-[var(--success-soft)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  showAreaFill
                  showPointMarkers
                  showEmptyPoints
                  strokeClass="text-[var(--success)]"
                />
                <SiteTrendCard
                  label="近 7 日消费趋势"
                  values={selectedSiteSnapshotSeries.map(snapshot => snapshot?.todayUsage ?? null)}
                  valueFormatter={formatCurrency}
                  chartVariant="bars"
                  strokeClass="text-[var(--accent)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  barClass="text-[var(--accent)]"
                  strokeWidth={2.4}
                />
                <SiteTrendCard
                  label="近 7 日请求量 (Reqs)"
                  values={selectedSiteSnapshotSeries.map(
                    snapshot => snapshot?.todayRequests ?? null
                  )}
                  valueFormatter={formatCompactNumber}
                  chartVariant="line"
                  strokeClass="text-[var(--accent)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  showPointMarkers
                  showEmptyPoints
                />
                <SiteTrendCard
                  label="近 7 日 Tokens"
                  values={selectedSiteSnapshotSeries.map(snapshot => snapshot?.totalTokens ?? null)}
                  valueFormatter={formatCompactNumber}
                  chartVariant="matrix"
                  strokeClass="text-[var(--text-primary)]"
                  areaClass="text-[var(--accent-soft)]"
                  latestSnapshotLabel={latestSelectedSnapshotLabel}
                  strokeWidth={3.25}
                />
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-[var(--text-secondary)]">
                暂无站点每日快照。完成一次站点检测后，这里会开始累计日级历史。
              </div>
            )}
          </AppCardContent>
        </AppCard>
      </div>
    </div>
  );
}
