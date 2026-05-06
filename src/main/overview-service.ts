import { runtimeCacheManager } from './runtime-cache-manager';
import { unifiedConfigManager } from './unified-config-manager';
import { notifyAppDataChanged } from './app-data-events';
import type {
  AccountCredential,
  DetectionCacheData,
  SiteDailySnapshot,
  UnifiedConfig,
  UnifiedSite,
} from '../shared/types/site';

function buildLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameLocalDay(timestamp: number | undefined, dateKey: string): boolean {
  return (
    typeof timestamp === 'number' &&
    Number.isFinite(timestamp) &&
    buildLocalDateKey(timestamp) === dateKey
  );
}

type SiteSnapshotNumericKey =
  | 'balance'
  | 'todayUsage'
  | 'todayRequests'
  | 'todayPromptTokens'
  | 'todayCompletionTokens'
  | 'totalTokens';

function sumMetric(snapshots: SiteDailySnapshot[], key: SiteSnapshotNumericKey): number {
  return snapshots.reduce((sum, snapshot) => sum + snapshot[key], 0);
}

function extractTodayMetrics(cache: DetectionCacheData | undefined, dateKey: string) {
  const isFreshToday = isSameLocalDay(cache?.last_refresh, dateKey);
  const todayPromptTokens = isFreshToday ? (cache?.today_prompt_tokens ?? 0) : 0;
  const todayCompletionTokens = isFreshToday ? (cache?.today_completion_tokens ?? 0) : 0;
  const totalTokens = todayPromptTokens + todayCompletionTokens;

  return {
    balance:
      typeof cache?.balance === 'number' && Number.isFinite(cache.balance) ? cache.balance : 0,
    todayUsage: isFreshToday ? (cache?.today_usage ?? 0) : 0,
    todayRequests: isFreshToday ? (cache?.today_requests ?? 0) : 0,
    todayPromptTokens,
    todayCompletionTokens,
    totalTokens,
    lastRefresh: cache?.last_refresh,
  };
}

function buildSiteSnapshotFromCaches(
  site: UnifiedSite,
  accounts: AccountCredential[],
  capturedAt: number
): SiteDailySnapshot | null {
  const snapshotDate = buildLocalDateKey(capturedAt);
  const caches =
    accounts.length > 0 ? accounts.map(account => account.cached_data) : [site.cached_data];
  const metrics = caches
    .filter((cache): cache is DetectionCacheData => Boolean(cache))
    .map(cache => extractTodayMetrics(cache, snapshotDate));

  if (metrics.length === 0) {
    return null;
  }

  const snapshot: SiteDailySnapshot = {
    siteId: site.id,
    snapshotDate,
    capturedAt,
    balance: metrics.reduce((sum, metric) => sum + metric.balance, 0),
    todayUsage: metrics.reduce((sum, metric) => sum + metric.todayUsage, 0),
    todayRequests: metrics.reduce((sum, metric) => sum + metric.todayRequests, 0),
    todayPromptTokens: metrics.reduce((sum, metric) => sum + metric.todayPromptTokens, 0),
    todayCompletionTokens: metrics.reduce((sum, metric) => sum + metric.todayCompletionTokens, 0),
    totalTokens: metrics.reduce((sum, metric) => sum + metric.totalTokens, 0),
  };

  const hasMeaningfulData =
    snapshot.balance > 0 ||
    snapshot.todayUsage > 0 ||
    snapshot.todayRequests > 0 ||
    snapshot.totalTokens > 0 ||
    metrics.some(metric => typeof metric.lastRefresh === 'number');

  return hasMeaningfulData ? snapshot : null;
}

function getConfigOrThrow(): UnifiedConfig {
  const config = unifiedConfigManager.exportConfigSync();
  if (!config) {
    throw new Error('Config not loaded');
  }
  return config;
}

export async function captureSiteDailySnapshot(siteId: string, capturedAt: number = Date.now()) {
  const config = getConfigOrThrow();
  const site = config.sites.find(item => item.id === siteId);
  if (!site) {
    return null;
  }

  const accounts = config.accounts.filter(account => account.site_id === siteId);
  const nextSnapshot = buildSiteSnapshotFromCaches(site, accounts, capturedAt);
  if (!nextSnapshot) {
    return null;
  }

  await runtimeCacheManager.updateSiteDailySnapshots(siteId, current => {
    const snapshots = [...(current || [])];
    const existingIndex = snapshots.findIndex(
      snapshot => snapshot.snapshotDate === nextSnapshot.snapshotDate
    );

    if (existingIndex >= 0) {
      snapshots[existingIndex] = nextSnapshot;
    } else {
      snapshots.push(nextSnapshot);
    }

    return snapshots.sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  });

  notifyAppDataChanged('site-overview', 120);

  return nextSnapshot;
}

export function getSiteDailySnapshots(params?: { siteId?: string; days?: number }) {
  const config = getConfigOrThrow();
  const siteIds = params?.siteId ? [params.siteId] : config.sites.map(site => site.id);
  const cutoff =
    typeof params?.days === 'number' && params.days > 0
      ? Date.now() - params.days * 24 * 60 * 60 * 1000
      : null;

  return Object.fromEntries(
    siteIds.map(siteId => {
      const snapshots = runtimeCacheManager
        .getSiteDailySnapshots(siteId)
        .filter(snapshot => (cutoff === null ? true : snapshot.capturedAt >= cutoff));

      return [siteId, snapshots];
    })
  ) as Record<string, SiteDailySnapshot[]>;
}

export function getSiteSnapshotTotals(params?: { days?: number }) {
  const snapshotsBySiteId = getSiteDailySnapshots(params);
  const totalsByDate = new Map<string, SiteDailySnapshot[]>();

  for (const snapshots of Object.values(snapshotsBySiteId)) {
    for (const snapshot of snapshots) {
      const list = totalsByDate.get(snapshot.snapshotDate) || [];
      list.push(snapshot);
      totalsByDate.set(snapshot.snapshotDate, list);
    }
  }

  return Array.from(totalsByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([snapshotDate, snapshots]) => ({
      snapshotDate,
      capturedAt: Math.max(...snapshots.map(snapshot => snapshot.capturedAt)),
      balance: sumMetric(snapshots, 'balance'),
      todayUsage: sumMetric(snapshots, 'todayUsage'),
      todayRequests: sumMetric(snapshots, 'todayRequests'),
      todayPromptTokens: sumMetric(snapshots, 'todayPromptTokens'),
      todayCompletionTokens: sumMetric(snapshots, 'todayCompletionTokens'),
      totalTokens: sumMetric(snapshots, 'totalTokens'),
    }));
}
