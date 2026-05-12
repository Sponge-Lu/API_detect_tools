import type { Config } from '../App';
import { BUILTIN_GROUP_IDS, type DetectionCacheData } from '../../shared/types/site';
import { getSiteDailyStats } from './siteDailyStats';

export interface SiteOverviewMetric {
  siteId: string;
  siteName: string;
  enabled: boolean;
  accountCount: number;
  balance: number;
  todayUsage: number;
  todayRequests: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  totalTokens: number;
  modelCount: number;
  lastRefresh: number;
  hasError: boolean;
  supportsCheckin: boolean;
  checkinTargetCount: number;
  pendingCheckins: number;
  completedCheckins: number;
  todayCheckinQuota: number;
  monthCheckinCount: number;
  totalCheckins: number;
}

export interface SiteCheckinOverviewRow {
  id: string;
  siteId: string;
  siteName: string;
  accountId?: string;
  accountName: string;
  pendingCheckins: number;
  completedCheckins: number;
  checkinTargetCount: number;
  todayCheckinQuota: number;
  monthCheckinCount: number;
  totalCheckins: number;
}

type SiteConfigWithCache = Config['sites'][number] & {
  cached_data?: DetectionCacheData;
};

type AccountConfigWithCache = NonNullable<Config['accounts']>[number] & {
  cached_data?: DetectionCacheData;
};

type CacheLike = DetectionCacheData;

export function toNonNegativeBalance(balance: number): number {
  return balance >= 0 ? balance : 0;
}

export function sumNonNegativeBalances<T extends { balance: number }>(items: readonly T[]): number {
  return items.reduce((sum, item) => sum + toNonNegativeBalance(item.balance), 0);
}

function isFreshToday(timestamp: number | undefined, now: Date): boolean {
  return typeof timestamp === 'number' && new Date(timestamp).toDateString() === now.toDateString();
}

function getCacheMetrics(cache: CacheLike | undefined, now: Date) {
  const dailyStats = getSiteDailyStats(
    cache
      ? {
          todayUsage: cache.today_usage,
          todayPromptTokens: cache.today_prompt_tokens,
          todayCompletionTokens: cache.today_completion_tokens,
          todayTotalTokens:
            typeof cache.today_prompt_tokens === 'number' &&
            typeof cache.today_completion_tokens === 'number'
              ? cache.today_prompt_tokens + cache.today_completion_tokens
              : undefined,
          todayRequests: cache.today_requests,
          lastRefresh: cache.last_refresh,
        }
      : undefined,
    now
  );
  const freshToday = isFreshToday(cache?.last_refresh, now);
  const supportsCheckin = Boolean(cache?.has_checkin) || typeof cache?.can_check_in === 'boolean';
  const completedCheckin = supportsCheckin && freshToday && cache?.can_check_in === false;

  return {
    balance:
      typeof cache?.balance === 'number' && Number.isFinite(cache.balance) ? cache.balance : 0,
    todayUsage: dailyStats.todayUsage,
    todayRequests: dailyStats.todayRequests,
    todayPromptTokens: dailyStats.todayPromptTokens,
    todayCompletionTokens: dailyStats.todayCompletionTokens,
    totalTokens: dailyStats.todayTotalTokens,
    lastRefresh:
      typeof cache?.last_refresh === 'number' && Number.isFinite(cache.last_refresh)
        ? cache.last_refresh
        : 0,
    modelNames: [...(cache?.models || []), ...Object.keys(cache?.model_pricing?.data || {})],
    hasError: Boolean(cache?.error) || cache?.status === '失败',
    supportsCheckin,
    pendingCheckins: supportsCheckin && !completedCheckin ? 1 : 0,
    completedCheckins: completedCheckin ? 1 : 0,
    todayCheckinQuota:
      freshToday && typeof cache?.checkin_stats?.today_quota === 'number'
        ? cache.checkin_stats.today_quota
        : 0,
    monthCheckinCount:
      typeof cache?.checkin_stats?.checkin_count === 'number'
        ? cache.checkin_stats.checkin_count
        : 0,
    totalCheckins:
      typeof cache?.checkin_stats?.total_checkins === 'number'
        ? cache.checkin_stats.total_checkins
        : 0,
  };
}

export function buildSiteOverviewMetrics(
  config: Config,
  now: Date = new Date()
): SiteOverviewMetric[] {
  const accountsBySiteId = new Map<string, NonNullable<Config['accounts']>>();
  for (const account of config.accounts || []) {
    const list = accountsBySiteId.get(account.site_id) || [];
    list.push(account);
    accountsBySiteId.set(account.site_id, list);
  }

  return config.sites
    .filter(site => (site.group || BUILTIN_GROUP_IDS.DEFAULT) !== BUILTIN_GROUP_IDS.UNAVAILABLE)
    .map(site => {
      const siteWithCache = site as SiteConfigWithCache;
      const siteAccounts = site.id ? accountsBySiteId.get(site.id) || [] : [];
      const caches =
        siteAccounts.length > 0
          ? siteAccounts.map(account => (account as AccountConfigWithCache).cached_data)
          : [siteWithCache.cached_data];
      const metrics = caches.map(cache => getCacheMetrics(cache, now));
      const modelNames = new Set(metrics.flatMap(metric => metric.modelNames));
      const detectedCheckinTargets = metrics.reduce(
        (sum, metric) => sum + (metric.supportsCheckin ? 1 : 0),
        0
      );
      const checkinTargetCount =
        detectedCheckinTargets > 0
          ? detectedCheckinTargets
          : site.force_enable_checkin
            ? Math.max(siteAccounts.length, 1)
            : 0;
      const supportsCheckin = checkinTargetCount > 0;

      return {
        siteId: site.id || site.name,
        siteName: site.name,
        enabled: site.enabled !== false,
        accountCount: siteAccounts.length,
        balance: sumNonNegativeBalances(metrics),
        todayUsage: metrics.reduce((sum, metric) => sum + metric.todayUsage, 0),
        todayRequests: metrics.reduce((sum, metric) => sum + metric.todayRequests, 0),
        todayPromptTokens: metrics.reduce((sum, metric) => sum + metric.todayPromptTokens, 0),
        todayCompletionTokens: metrics.reduce(
          (sum, metric) => sum + metric.todayCompletionTokens,
          0
        ),
        totalTokens: metrics.reduce((sum, metric) => sum + metric.totalTokens, 0),
        modelCount: modelNames.size,
        lastRefresh: metrics.reduce((max, metric) => Math.max(max, metric.lastRefresh), 0),
        hasError: metrics.some(metric => metric.hasError),
        supportsCheckin,
        checkinTargetCount,
        pendingCheckins: supportsCheckin
          ? detectedCheckinTargets > 0
            ? metrics.reduce((sum, metric) => sum + metric.pendingCheckins, 0)
            : checkinTargetCount
          : 0,
        completedCheckins: metrics.reduce((sum, metric) => sum + metric.completedCheckins, 0),
        todayCheckinQuota: metrics.reduce((sum, metric) => sum + metric.todayCheckinQuota, 0),
        monthCheckinCount: metrics.reduce((sum, metric) => sum + metric.monthCheckinCount, 0),
        totalCheckins: metrics.reduce((sum, metric) => sum + metric.totalCheckins, 0),
      };
    });
}

export function buildSiteCheckinOverviewRows(
  config: Config,
  now: Date = new Date()
): SiteCheckinOverviewRow[] {
  const accountsBySiteId = new Map<string, NonNullable<Config['accounts']>>();
  for (const account of config.accounts || []) {
    const list = accountsBySiteId.get(account.site_id) || [];
    list.push(account);
    accountsBySiteId.set(account.site_id, list);
  }

  return config.sites
    .filter(
      site =>
        (site.group || BUILTIN_GROUP_IDS.DEFAULT) !== BUILTIN_GROUP_IDS.UNAVAILABLE &&
        site.enabled !== false
    )
    .flatMap(site => {
      const siteWithCache = site as SiteConfigWithCache;
      const siteAccounts = site.id ? accountsBySiteId.get(site.id) || [] : [];

      if (siteAccounts.length === 0) {
        const metrics = getCacheMetrics(siteWithCache.cached_data, now);
        const supportsCheckin = metrics.supportsCheckin || Boolean(site.force_enable_checkin);
        if (!supportsCheckin) return [];

        const completedCheckins = metrics.completedCheckins > 0 ? 1 : 0;
        const pendingCheckins = completedCheckins === 0 ? 1 : 0;

        return [
          {
            id: `${site.id || site.name}:site`,
            siteId: site.id || site.name,
            siteName: site.name,
            accountName: '站点级',
            pendingCheckins,
            completedCheckins,
            checkinTargetCount: 1,
            todayCheckinQuota: metrics.todayCheckinQuota,
            monthCheckinCount: metrics.monthCheckinCount,
            totalCheckins: metrics.totalCheckins,
          },
        ];
      }

      return siteAccounts.flatMap(account => {
        const metrics = getCacheMetrics((account as AccountConfigWithCache).cached_data, now);
        const supportsCheckin = metrics.supportsCheckin || Boolean(site.force_enable_checkin);
        if (!supportsCheckin) return [];

        const completedCheckins = metrics.completedCheckins > 0 ? 1 : 0;
        const pendingCheckins = completedCheckins === 0 ? 1 : 0;

        return [
          {
            id: `${site.id || site.name}:${account.id || account.account_name}`,
            siteId: site.id || site.name,
            siteName: site.name,
            accountId: account.id,
            accountName: account.account_name || account.id,
            pendingCheckins,
            completedCheckins,
            checkinTargetCount: 1,
            todayCheckinQuota: metrics.todayCheckinQuota,
            monthCheckinCount: metrics.monthCheckinCount,
            totalCheckins: metrics.totalCheckins,
          },
        ];
      });
    });
}
