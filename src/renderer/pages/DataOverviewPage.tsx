import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type {
  RouteAnalyticsBucket,
  RouteAnalyticsObjectStatsItem,
  RouteCliType,
  RouteRequestLogItem,
} from '../../shared/types/route-proxy';
import type { SiteDailySnapshot } from '../../shared/types/site';
import { AppButton } from '../components/AppButton/AppButton';
import { AppCard, AppCardContent } from '../components/AppCard';
import { useConfigStore } from '../store/configStore';
import { useUIStore } from '../store/uiStore';
import { getRouteCliLabel } from '../utils/routeRulePresentation';
import {
  buildSiteCheckinOverviewRows,
  buildSiteOverviewMetrics,
  type SiteCheckinOverviewRow,
  type SiteOverviewMetric,
} from '../utils/siteOverview';

type RouteWindow = '24h' | '7d' | '30d';
const AGGREGATED_SITE_OPTION_ID = '__aggregated_site__';
const AGGREGATED_SITE_OPTION_LABEL = '全部站点（聚合）';
const CHECKIN_SITE_NAME_MAX_WIDTH = 7;

interface RouteSummary {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  neutralCount: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface RouteDistribution {
  buckets: RouteAnalyticsBucket[];
  statusCodeHistogram: Record<string, number>;
  latencyHistogram: Record<string, number>;
  firstByteHistogram: Record<string, number>;
}

interface TrendPoint {
  key: string;
  label: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  slowRequestCount: number;
}

interface RankedMetricItem {
  id: string;
  label: string;
  value: number;
  sublabel?: string;
}

interface RouteFailureRuleMetric {
  id: string;
  ruleId: string;
  cliType: RouteCliType;
  canonicalModel: string;
  requests: number;
  failures: number;
  siteCount: number;
  sourceCount: number;
}

type TrendDirection = 'up' | 'down' | 'flat' | 'none';

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  if (value === -1) return '∞';
  if (Math.abs(value) >= 100_000) return `$${formatCompactNumber(value)}`;
  return `$${value.toFixed(2)}`;
}

function formatCheckinQuota(value: number): string {
  if (value === 0) return '$0.00';
  const dollars = value / 500000;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.001) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(4)}`;
}

function getCharacterDisplayWidth(char: string): number {
  return (char.codePointAt(0) || 0) <= 0xff ? 0.5 : 1;
}

function truncateTextByDisplayWidth(text: string, maxWidth: number): string {
  let width = 0;
  let result = '';

  for (const char of text) {
    const charWidth = getCharacterDisplayWidth(char);
    if (width + charWidth > maxWidth) {
      return `${result}…`;
    }
    result += char;
    width += charWidth;
  }

  return result;
}

function formatDateLabel(timestamp: number, window: RouteWindow): string {
  const date = new Date(timestamp);
  if (window === '24h') {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function formatSnapshotDayLabel(snapshotDate: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(
    parseDayKey(snapshotDate)
  );
}

function formatLogTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function buildRouteTrendPoints(buckets: RouteAnalyticsBucket[], window: RouteWindow): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>();

  const toKey = (bucketStart: number) => {
    const date = new Date(bucketStart);
    if (window === '24h') {
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    }
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  for (const bucket of [...buckets].sort((left, right) => left.bucketStart - right.bucketStart)) {
    const key = toKey(bucket.bucketStart);
    const current =
      grouped.get(key) ||
      ({
        key,
        label: formatDateLabel(bucket.bucketStart, window),
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        slowRequestCount: 0,
      } satisfies TrendPoint);

    current.requestCount += bucket.requestCount;
    current.successCount += bucket.successCount;
    current.failureCount += bucket.failureCount;
    current.totalTokens += bucket.totalTokens;
    current.slowRequestCount += Object.entries(bucket.latencyHistogram).reduce(
      (sum, [label, count]) => {
        const isSlowBucket =
          label.startsWith('>') ||
          (() => {
            const match = label.match(/-(\d+)ms$/);
            return match ? Number(match[1]) >= 5000 : false;
          })();
        return sum + (isSlowBucket ? count : 0);
      },
      0
    );

    grouped.set(key, current);
  }

  return Array.from(grouped.values());
}

function buildRouteTrendAxisLabels(points: TrendPoint[]): string[] {
  if (points.length === 0) return [];

  const lastIndex = points.length - 1;
  const indices = Array.from(
    new Set([0, Math.round(lastIndex * 0.33), Math.round(lastIndex * 0.66), lastIndex])
  );

  return indices
    .map(index => points[index]?.label || '')
    .filter((label, index, labels) => label.length > 0 && label !== labels[index - 1]);
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function buildSevenDaySnapshotSeries(
  snapshots: SiteDailySnapshot[],
  now: Date = new Date()
): Array<SiteDailySnapshot | null> {
  if (snapshots.length === 0) return [];

  const snapshotsByDay = new Map<string, SiteDailySnapshot>();
  for (const snapshot of snapshots) {
    const current = snapshotsByDay.get(snapshot.snapshotDate);
    if (!current || snapshot.capturedAt >= current.capturedAt) {
      snapshotsByDay.set(snapshot.snapshotDate, snapshot);
    }
  }

  const latestSnapshotDay = [...snapshotsByDay.keys()].sort().at(-1) || formatDayKey(now);
  const todayDay = formatDayKey(now);
  const endDay = latestSnapshotDay > todayDay ? latestSnapshotDay : todayDay;
  const endDate = parseDayKey(endDay);

  return Array.from({ length: 7 }, (_, index) => {
    const dayKey = formatDayKey(addDays(endDate, index - 6));
    return snapshotsByDay.get(dayKey) || null;
  });
}

function isFreshToday(timestamp: number | undefined, now: Date = new Date()): boolean {
  return typeof timestamp === 'number' && formatDayKey(new Date(timestamp)) === formatDayKey(now);
}

function buildLiveTodaySnapshot(
  metric: SiteOverviewMetric | null,
  now: Date = new Date()
): SiteDailySnapshot | null {
  if (!metric || !isFreshToday(metric.lastRefresh, now)) {
    return null;
  }

  return {
    siteId: metric.siteId,
    snapshotDate: formatDayKey(now),
    capturedAt: metric.lastRefresh,
    balance: metric.balance,
    todayUsage: metric.todayUsage,
    todayRequests: metric.todayRequests,
    todayPromptTokens: metric.todayPromptTokens,
    todayCompletionTokens: metric.todayCompletionTokens,
    totalTokens: metric.totalTokens,
  };
}

function mergeLiveTodaySnapshot(
  snapshots: SiteDailySnapshot[],
  liveTodaySnapshot: SiteDailySnapshot | null
): SiteDailySnapshot[] {
  if (!liveTodaySnapshot) {
    return snapshots;
  }

  return [
    ...snapshots.filter(snapshot => snapshot.snapshotDate !== liveTodaySnapshot.snapshotDate),
    liveTodaySnapshot,
  ].sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
}

function buildTrendDeltaSummary(values: Array<number | null>): {
  currentValue: number | null;
  previousValue: number | null;
  deltaPercent: number | null;
  direction: TrendDirection;
} {
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return {
      currentValue: null,
      previousValue: null,
      deltaPercent: null,
      direction: 'none',
    };
  }

  const currentValue = definedValues[definedValues.length - 1];
  const previousValue = definedValues.length > 1 ? definedValues[definedValues.length - 2] : null;

  if (previousValue === null) {
    return { currentValue, previousValue, deltaPercent: null, direction: 'none' };
  }

  const delta = currentValue - previousValue;
  if (Math.abs(delta) < 0.000001) {
    return { currentValue, previousValue, deltaPercent: 0, direction: 'flat' };
  }

  if (previousValue === 0) {
    return {
      currentValue,
      previousValue,
      deltaPercent: null,
      direction: delta > 0 ? 'up' : 'down',
    };
  }

  return {
    currentValue,
    previousValue,
    deltaPercent: (delta / Math.abs(previousValue)) * 100,
    direction: delta > 0 ? 'up' : 'down',
  };
}

function formatTrendDeltaBadge(
  direction: TrendDirection,
  deltaPercent: number | null,
  previousValue: number | null
): string {
  if (direction === 'none') return '首日记录';
  if (direction === 'flat') return '持平';
  if (previousValue === 0 || deltaPercent === null) {
    return direction === 'up' ? '新增' : '回落';
  }

  const precision = Math.abs(deltaPercent) >= 100 ? 0 : 1;
  return `${direction === 'up' ? '+' : '-'}${Math.abs(deltaPercent).toFixed(precision)}%`;
}

function resolveSparklineDisplayValues(values: Array<number | null>): number[] {
  if (values.length === 0) return [];

  const firstDefinedIndex = values.findIndex(value => value !== null);
  if (firstDefinedIndex === -1) {
    return new Array(values.length).fill(0);
  }

  const resolvedValues = [...values] as Array<number | null>;
  const firstDefinedValue = values[firstDefinedIndex] as number;

  for (let index = 0; index < firstDefinedIndex; index += 1) {
    resolvedValues[index] = firstDefinedValue;
  }

  let lastDefinedIndex = firstDefinedIndex;
  let lastDefinedValue = firstDefinedValue;

  for (let index = firstDefinedIndex + 1; index < values.length; index += 1) {
    const currentValue = values[index];
    if (currentValue !== null) {
      const gapLength = index - lastDefinedIndex;
      if (gapLength > 1) {
        const delta = (currentValue - lastDefinedValue) / gapLength;
        for (let fillIndex = 1; fillIndex < gapLength; fillIndex += 1) {
          resolvedValues[lastDefinedIndex + fillIndex] = lastDefinedValue + delta * fillIndex;
        }
      }

      resolvedValues[index] = currentValue;
      lastDefinedIndex = index;
      lastDefinedValue = currentValue;
    }
  }

  for (let index = lastDefinedIndex + 1; index < values.length; index += 1) {
    resolvedValues[index] = lastDefinedValue;
  }

  return resolvedValues.map(value => value ?? 0);
}

function buildSparklineBarHeights(values: Array<number | null>, chartHeight: number): number[] {
  if (values.length === 0) return [];

  const displayValues = resolveSparklineDisplayValues(values);
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return new Array(values.length).fill(Math.max(chartHeight * 0.12, 6));
  }

  const max = Math.max(...displayValues, 1);
  const min = Math.min(...displayValues, 0);
  const hasVariance = max !== min;

  return displayValues.map(value => {
    if (!hasVariance) {
      return Math.max(chartHeight * 0.52, 12);
    }

    const ratio = (value - min) / (max - min || 1);
    return Math.max(ratio * chartHeight, 8);
  });
}

function buildSparklineCoordinates(values: Array<number | null>, width: number, height: number) {
  if (values.length === 0) return [];
  const displayValues = resolveSparklineDisplayValues(values);
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return values.map((value, index) => ({
      value,
      x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
      y: height / 2,
    }));
  }

  const max = Math.max(...displayValues, 1);
  const min = Math.min(...displayValues, 0);
  const range = max - min || 1;
  const hasVariance = max !== min;

  return displayValues.map((displayValue, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = hasVariance ? height - ((displayValue - min) / range) * height : height * 0.45;
    return { value: values[index], x, y };
  });
}

function buildSparklinePath(values: Array<number | null>, width: number, height: number): string {
  const coordinates = buildSparklineCoordinates(values, width, height);
  if (coordinates.length === 0) return '';

  const definedPointCount = values.filter(value => value !== null).length;
  if (definedPointCount === 0) return '';

  if (definedPointCount === 1) {
    const point = coordinates.find(coordinate => coordinate.value !== null);
    if (!point) return '';
    const startX = Math.max(point.x - 8, 0);
    const endX = Math.min(point.x + 8, width);
    return `M ${startX.toFixed(2)} ${point.y.toFixed(2)} L ${endX.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return coordinates
    .map(
      (coordinate, index) =>
        `${index === 0 ? 'M' : 'L'} ${coordinate.x.toFixed(2)} ${coordinate.y.toFixed(2)}`
    )
    .join(' ');
}

function buildSparklineAreaPath(
  values: Array<number | null>,
  width: number,
  height: number
): string {
  const coordinates = buildSparklineCoordinates(values, width, height);
  const linePath = buildSparklinePath(values, width, height);
  if (coordinates.length === 0 || !linePath) return '';

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return `${linePath} L ${last.x.toFixed(2)} ${height.toFixed(2)} L ${first.x.toFixed(2)} ${height.toFixed(2)} Z`;
}

function buildMatrixColumnLevels(values: Array<number | null>, rows: number): number[] {
  if (values.length === 0) return [];

  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length === 0) {
    return new Array(values.length).fill(0);
  }

  const displayValues = resolveSparklineDisplayValues(values);
  const max = Math.max(...displayValues, 1);
  const min = Math.min(...displayValues, 0);
  const range = max - min;

  return displayValues.map(value => {
    if (range === 0) return Math.max(Math.round(rows * 0.6), 1);

    const ratio = (value - min) / range;
    return Math.max(1, Math.min(rows, Math.round(ratio * (rows - 1)) + 1));
  });
}

function buildRouteObjectLabel(item: RouteRequestLogItem): string {
  const routeRuleParts =
    item.routeRuleName
      ?.split('/')
      .map(part => part.trim())
      .filter(Boolean) || [];
  const cliLabel = getRouteCliLabel(item.cliType);
  const routeRule =
    routeRuleParts.find(part => part !== item.cliType && part !== cliLabel) || '未识别规则';
  const site = item.siteName?.trim() || '未知站点';
  const account = item.accountName?.trim() || '未知账户';
  const apiKey = item.apiKeyName?.trim() || item.apiKeyId?.trim() || '未标记 Key';
  return `${routeRule} / ${site} / ${account} / ${apiKey}`;
}

function buildAggregatedSiteSnapshots(
  snapshotsById: Record<string, SiteDailySnapshot[]>,
  siteIds: string[]
): SiteDailySnapshot[] {
  if (siteIds.length === 0) return [];

  const allowedSiteIds = new Set(siteIds);
  const grouped = new Map<string, SiteDailySnapshot>();

  for (const [siteId, snapshots] of Object.entries(snapshotsById)) {
    if (!allowedSiteIds.has(siteId)) continue;

    for (const snapshot of snapshots) {
      const current = grouped.get(snapshot.snapshotDate) || {
        siteId: AGGREGATED_SITE_OPTION_ID,
        snapshotDate: snapshot.snapshotDate,
        capturedAt: snapshot.capturedAt,
        balance: 0,
        todayUsage: 0,
        todayRequests: 0,
        todayPromptTokens: 0,
        todayCompletionTokens: 0,
        totalTokens: 0,
      };

      current.capturedAt = Math.max(current.capturedAt, snapshot.capturedAt);
      current.balance += snapshot.balance;
      current.todayUsage += snapshot.todayUsage;
      current.todayRequests += snapshot.todayRequests;
      current.todayPromptTokens += snapshot.todayPromptTokens;
      current.todayCompletionTokens += snapshot.todayCompletionTokens;
      current.totalTokens += snapshot.totalTokens;
      grouped.set(snapshot.snapshotDate, current);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate))
    .slice(-7);
}

function Sparkline({
  values,
  strokeClass,
  emptyClass = 'bg-[var(--surface-2)]',
  showPointMarkers = false,
  showEmptyPoints = false,
  showBars = false,
  showAreaFill = false,
  showGuides = false,
  hideLine = false,
  barClass = 'text-[var(--accent-soft-strong)]',
  emptyBarClass = 'text-[var(--line-soft)]',
  areaClass = 'text-[var(--accent-soft)]',
  guideClass = 'text-[var(--line-soft)]',
  heightClass = 'h-14',
  chartHeight = 56,
  strokeWidth = 2.5,
  strokeDasharray,
}: {
  values: Array<number | null>;
  strokeClass: string;
  emptyClass?: string;
  showPointMarkers?: boolean;
  showEmptyPoints?: boolean;
  showBars?: boolean;
  showAreaFill?: boolean;
  showGuides?: boolean;
  hideLine?: boolean;
  barClass?: string;
  emptyBarClass?: string;
  areaClass?: string;
  guideClass?: string;
  heightClass?: string;
  chartHeight?: number;
  strokeWidth?: number;
  strokeDasharray?: string;
}) {
  if (values.length === 0) {
    return <div className={`${heightClass} rounded-[var(--radius-md)] ${emptyClass}`} />;
  }

  const chartWidth = 160;
  const coordinates = buildSparklineCoordinates(values, chartWidth, chartHeight);
  const barHeights = buildSparklineBarHeights(values, chartHeight);
  const barWidth = chartWidth / Math.max(values.length, 1);

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      className={`${heightClass} w-full`}
      preserveAspectRatio="none"
    >
      {showGuides
        ? [0.18, 0.52, 0.86].map(ratio => {
            const y = chartHeight * ratio;
            return (
              <line
                key={`guide-${ratio}`}
                x1="0"
                y1={y}
                x2={chartWidth}
                y2={y}
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="3 4"
                className={guideClass}
              />
            );
          })
        : null}
      {showAreaFill ? (
        <path
          d={buildSparklineAreaPath(values, chartWidth, chartHeight)}
          fill="currentColor"
          className={areaClass}
        />
      ) : null}
      {showBars
        ? barHeights.map((barHeight, index) => {
            const isEmpty = values[index] === null;
            const x = index * barWidth + barWidth * 0.16;
            const width = barWidth * 0.68;
            const y = chartHeight - barHeight;

            return (
              <rect
                key={`bar-${index}`}
                x={x}
                y={y}
                width={width}
                height={barHeight}
                rx="2"
                fill={isEmpty ? 'transparent' : 'currentColor'}
                stroke={isEmpty ? 'currentColor' : 'none'}
                strokeWidth={isEmpty ? 1 : 0}
                className={isEmpty ? emptyBarClass : barClass}
              />
            );
          })
        : null}
      {!hideLine ? (
        <path
          d={buildSparklinePath(values, chartWidth, chartHeight)}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className={strokeClass}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={strokeDasharray}
        />
      ) : null}
      {showPointMarkers
        ? coordinates.map((coordinate, index) => {
            if (coordinate.value === null && !showEmptyPoints) {
              return null;
            }

            return (
              <circle
                key={`${index}-${coordinate.x}`}
                cx={coordinate.x}
                cy={coordinate.y}
                r={coordinate.value === null ? 2.4 : 2.8}
                fill={coordinate.value === null ? 'var(--surface-2)' : 'currentColor'}
                stroke="currentColor"
                strokeWidth={coordinate.value === null ? 1.2 : 0}
                className={coordinate.value === null ? 'text-[var(--line-soft)]' : strokeClass}
              />
            );
          })
        : null}
    </svg>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        {subtitle ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  toneClass = 'text-[var(--text-primary)]',
}: {
  label: string;
  value: string;
  hint?: string;
  toneClass?: string;
}) {
  return (
    <AppCard blur={false} hoverable={false}>
      <AppCardContent className="p-4">
        <div className="text-xs text-[var(--text-secondary)]">{label}</div>
        <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
        {hint ? <div className="mt-2 text-xs text-[var(--text-tertiary)]">{hint}</div> : null}
      </AppCardContent>
    </AppCard>
  );
}

function RouteMetricCard({
  label,
  value,
  hint,
  chip,
  toneClass = 'text-[var(--text-primary)]',
  chipToneClass = 'bg-[var(--surface-1)] text-[var(--text-secondary)]',
}: {
  label: string;
  value: string;
  hint?: string;
  chip?: string;
  toneClass?: string;
  chipToneClass?: string;
}) {
  return (
    <AppCard
      blur={false}
      hoverable={false}
      className="h-full border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
    >
      <AppCardContent className="flex h-full flex-col p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-[0.06em] text-[var(--text-secondary)]">
            {label}
          </div>
          {chip ? (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chipToneClass}`}
            >
              {chip}
            </span>
          ) : null}
        </div>
        <div
          className={`mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] ${toneClass}`}
        >
          {value}
        </div>
        {hint ? (
          <div className="mt-auto pt-3 text-xs leading-5 text-[var(--text-tertiary)]">{hint}</div>
        ) : null}
      </AppCardContent>
    </AppCard>
  );
}

function RouteTrendHeroCard({
  routeWindow,
  requestTrend,
  successRateTrend,
  tokenTrend,
  trendPoints,
}: {
  routeWindow: RouteWindow;
  requestTrend: Array<number | null>;
  successRateTrend: Array<number | null>;
  tokenTrend: Array<number | null>;
  trendPoints: TrendPoint[];
}) {
  const requestSummary = buildTrendDeltaSummary(requestTrend);
  const axisLabels = buildRouteTrendAxisLabels(trendPoints);
  const requestBadge = formatTrendDeltaBadge(
    requestSummary.direction,
    requestSummary.deltaPercent,
    requestSummary.previousValue
  );
  const requestBadgeClass =
    requestSummary.direction === 'up'
      ? 'bg-[var(--success-soft)] text-[var(--success)]'
      : requestSummary.direction === 'down'
        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
        : 'bg-[var(--surface-1)] text-[var(--text-secondary)]';

  return (
    <AppCard
      blur={false}
      hoverable={false}
      className="min-h-[264px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
    >
      <AppCardContent className="flex h-full min-h-0 flex-col p-4">
        <SectionTitle
          icon={Activity}
          title="运营趋势"
          subtitle="请求、成功率与 token 使用走势"
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="rounded-full bg-[var(--surface-1)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)]">
                {routeWindow}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${requestBadgeClass}`}
              >
                {requestBadge}
              </span>
            </div>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] bg-[var(--surface-2)] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--accent)]" />
              请求量
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
              成功率
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
              Tokens
            </span>
          </div>
          <div className="relative min-h-[142px] flex-1">
            <div className="absolute inset-0">
              <Sparkline
                values={requestTrend}
                strokeClass="text-[var(--accent)]"
                showBars
                hideLine
                showGuides
                barClass="text-[var(--accent-soft-strong)]"
                chartHeight={150}
                heightClass="h-full"
              />
            </div>
            <div className="absolute inset-0">
              <Sparkline
                values={successRateTrend}
                strokeClass="text-[var(--success)]"
                showPointMarkers={successRateTrend.length > 1}
                chartHeight={150}
                heightClass="h-full"
                strokeWidth={2.2}
              />
            </div>
            <div className="absolute inset-0">
              <Sparkline
                values={tokenTrend}
                strokeClass="text-[var(--warning)]"
                strokeDasharray="4 4"
                chartHeight={150}
                heightClass="h-full"
                strokeWidth={2}
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--text-tertiary)]">
            {axisLabels.length > 0 ? (
              axisLabels.map(label => (
                <span key={label} className="truncate">
                  {label}
                </span>
              ))
            ) : (
              <span>等待更多趋势分桶</span>
            )}
          </div>
        </div>
      </AppCardContent>
    </AppCard>
  );
}

function RouteObjectStatsList({ items }: { items: RouteAnalyticsObjectStatsItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[188px] items-center justify-center text-sm text-[var(--text-secondary)]">
        当前时间窗口暂无路由对象统计
      </div>
    );
  }

  return (
    <div
      aria-label="活跃对象滚动区域"
      className="max-h-[196px] overflow-y-auto pr-1 [scrollbar-gutter:stable]"
    >
      <div className="divide-y divide-[var(--line-soft)]">
        {items.map(item => {
          const successRateBarWidth = Math.max(0, Math.min(item.successRate, 100));
          const riskTextClass =
            item.failureCount > 0 || item.successRate < 80
              ? 'text-[var(--danger)]'
              : 'text-[var(--success)]';
          const riskBarClass =
            item.failureCount > 0 || item.successRate < 80
              ? 'bg-[var(--danger)]'
              : 'bg-[var(--success)]';
          const failureTextClass =
            item.failureCount > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]';

          return (
            <div
              key={item.id}
              aria-label={`活跃对象：${item.siteName} / ${item.accountName} / ${item.apiKeyName}`}
              className="px-1 py-1.5 [contain-intrinsic-size:60px] [content-visibility:auto]"
            >
              <div className="truncate text-sm font-semibold leading-tight text-[var(--text-primary)]">
                {item.siteName} / {item.accountName} / {item.apiKeyName}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] leading-none">
                <span className="font-medium text-[var(--text-secondary)]">
                  总请求 {formatCompactNumber(item.requestCount)}
                </span>
                <span className={`font-medium ${failureTextClass}`}>
                  失败 {formatCompactNumber(item.failureCount)}
                </span>
                <span className={`font-medium ${riskTextClass}`}>
                  成功率 {formatPercent(item.successRate)}
                </span>
                <span className="font-medium text-[var(--warning)]">
                  Tokens {item.totalTokens > 0 ? formatCompactNumber(item.totalTokens) : '暂无'}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-1)]">
                <div
                  className={`h-1.5 rounded-full ${riskBarClass}`}
                  style={{ width: `${successRateBarWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RouteFailureRuleMetricsList({ items }: { items: RouteFailureRuleMetric[] }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[96px] items-center justify-center text-sm text-[var(--text-secondary)]">
        当前时间窗口暂无规则命中数据
      </div>
    );
  }

  const maxRequests = Math.max(...items.map(item => item.requests), 0);

  return (
    <div
      aria-label="路由规则洞察滚动区域"
      className="max-h-[104px] overflow-y-auto pr-1 [scrollbar-gutter:stable]"
    >
      <div className="divide-y divide-[var(--line-soft)]">
        {items.map(item => {
          const cliLabel = getRouteCliLabel(item.cliType);
          const modelLabel = item.canonicalModel || '未标记模型';
          const requestBarWidth =
            maxRequests > 0 ? Math.max(0, Math.min((item.requests / maxRequests) * 100, 100)) : 0;
          const failureTextClass =
            item.failures > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]';
          const requestBarClass = item.failures > 0 ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]';

          return (
            <div
              key={item.id}
              aria-label={`主要失败规则：${cliLabel} / ${modelLabel}`}
              className="px-1 py-1.5 [contain-intrinsic-size:60px] [content-visibility:auto]"
            >
              <div className="truncate text-xs font-semibold leading-tight text-[var(--text-primary)]">
                {cliLabel} / {modelLabel}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] leading-none">
                <span className="font-medium text-[var(--text-secondary)]">
                  总请求 {formatCompactNumber(item.requests)}
                </span>
                <span className={`font-medium ${failureTextClass}`}>
                  失败 {formatCompactNumber(item.failures)}
                </span>
                <span className="font-medium text-[var(--text-secondary)]">
                  站点 {formatCompactNumber(item.siteCount)}
                </span>
                <span className="font-medium text-[var(--text-secondary)]">
                  来源 {formatCompactNumber(item.sourceCount)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-1)]">
                <div
                  className={`h-1.5 rounded-full ${requestBarClass}`}
                  style={{ width: `${requestBarWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RouteFailureList({ items }: { items: RouteRequestLogItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[136px] items-center justify-center text-xs text-[var(--text-secondary)]">
        最近没有失败请求
      </div>
    );
  }

  return (
    <div
      aria-label="最近异常请求滚动区域"
      className="max-h-[136px] overflow-y-auto pr-1 [scrollbar-gutter:stable]"
    >
      <div className="divide-y divide-[var(--line-soft)]">
        {items.map(item => {
          const statusLabel = item.statusCode ? `HTTP ${item.statusCode}` : '失败';
          const statusClass =
            typeof item.statusCode === 'number' && item.statusCode < 500
              ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
              : 'bg-[var(--danger-soft)] text-[var(--danger)]';

          return (
            <div
              key={item.id}
              className="px-1 py-1.5 [contain-intrinsic-size:72px] [content-visibility:auto]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      请求 {item.requestId}
                    </span>
                  </div>
                  <div className="mt-1 text-xs leading-snug text-[var(--danger)]">
                    {item.error || '上游请求失败'}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusClass}`}
                  >
                    {statusLabel}
                  </span>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    {formatLogTime(item.createdAt)}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-[10px] leading-4 text-[var(--text-secondary)]">
                路由对象：{buildRouteObjectLabel(item)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DotMatrixChart({
  values,
  activeClass = 'bg-[var(--accent)]/75',
  inactiveClass = 'bg-[var(--line-soft)]/35',
  rows = 6,
}: {
  values: Array<number | null>;
  activeClass?: string;
  inactiveClass?: string;
  rows?: number;
}) {
  const levels = buildMatrixColumnLevels(values, rows);

  if (levels.length === 0) {
    return <div className="h-full rounded-[var(--radius-md)] bg-[var(--surface-2)]" />;
  }

  return (
    <div className="relative h-full overflow-hidden rounded-[var(--radius-md)]">
      <div className="grid h-full grid-cols-7 gap-1.5">
        {levels.map((level, columnIndex) => (
          <div
            key={`matrix-col-${columnIndex}`}
            className="grid h-full grid-rows-6 gap-1 [contain-intrinsic-size:56px] [content-visibility:auto]"
          >
            {Array.from({ length: rows }, (_, rowIndex) => {
              const active = values[columnIndex] !== null && rows - rowIndex <= level;
              return (
                <span
                  key={`matrix-dot-${columnIndex}-${rowIndex}`}
                  className={`rounded-full ${active ? activeClass : inactiveClass}`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface-1)]/35 to-transparent" />
    </div>
  );
}

function compactTrendSeries(values: Array<number | null>): Array<number | null> {
  const definedValues = values.filter((value): value is number => value !== null);
  if (definedValues.length >= 2 && definedValues.length < values.length) {
    return definedValues;
  }
  return values;
}

function SiteTrendCard({
  label,
  values,
  valueFormatter,
  chartVariant,
  strokeClass,
  barClass = 'text-[var(--accent-soft-strong)]',
  areaClass = 'text-[var(--accent-soft)]',
  latestSnapshotLabel,
  showPointMarkers = false,
  showEmptyPoints = false,
  showAreaFill = false,
  strokeWidth = 2.1,
}: {
  label: string;
  values: Array<number | null>;
  valueFormatter: (value: number) => string;
  chartVariant: 'area' | 'bars' | 'line' | 'matrix';
  strokeClass: string;
  barClass?: string;
  areaClass?: string;
  latestSnapshotLabel: string | null;
  showPointMarkers?: boolean;
  showEmptyPoints?: boolean;
  showAreaFill?: boolean;
  strokeWidth?: number;
}) {
  const summary = buildTrendDeltaSummary(values);
  const badgeLabel = formatTrendDeltaBadge(
    summary.direction,
    summary.deltaPercent,
    summary.previousValue
  );
  const badgeClass =
    summary.direction === 'up'
      ? 'bg-[var(--success-soft)] text-[var(--success)]'
      : summary.direction === 'down'
        ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
        : 'bg-[var(--surface-2)] text-[var(--text-secondary)]';
  const valueLabel = summary.currentValue === null ? '—' : valueFormatter(summary.currentValue);
  const chartValues =
    chartVariant === 'bars' || chartVariant === 'matrix' ? values : compactTrendSeries(values);

  return (
    <div
      aria-label={`${label} 趋势卡片`}
      className="relative flex min-h-[208px] flex-col overflow-hidden rounded-[18px] border border-white/70 bg-[var(--surface-3)] px-5 pb-3 pt-5 shadow-[var(--shadow-sm)]"
    >
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-secondary)]">
            {label}
          </h3>
          <span
            className={`shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
          >
            {badgeLabel}
          </span>
        </div>
        <div className="mt-3 text-[22px] font-semibold leading-none tracking-[-0.02em] text-[var(--text-primary)] xl:text-[24px]">
          {valueLabel}
        </div>
        <div className="mt-auto pt-20 text-[10px] leading-none text-[var(--text-tertiary)]">
          {latestSnapshotLabel ? `最近记录 ${latestSnapshotLabel}` : '等待更多日级快照'}
        </div>
      </div>
      {chartVariant === 'area' ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-7 h-[82px] overflow-hidden">
          <Sparkline
            values={chartValues}
            strokeClass={strokeClass}
            showAreaFill={showAreaFill}
            areaClass={areaClass}
            chartHeight={70}
            heightClass="h-full"
            strokeWidth={2.2}
          />
        </div>
      ) : null}
      {chartVariant === 'bars' ? (
        <div className="pointer-events-none absolute bottom-7 left-5 right-5 h-[64px]">
          <Sparkline
            values={chartValues}
            strokeClass="text-transparent"
            showBars
            hideLine
            barClass={barClass}
            emptyBarClass="text-[var(--line-soft)]"
            chartHeight={60}
            heightClass="h-full"
            strokeWidth={0}
          />
        </div>
      ) : null}
      {chartVariant === 'line' ? (
        <div className="pointer-events-none absolute bottom-7 left-5 right-5 h-[56px]">
          <Sparkline
            values={chartValues}
            strokeClass={strokeClass}
            showPointMarkers={showPointMarkers}
            showEmptyPoints={showEmptyPoints}
            chartHeight={48}
            heightClass="h-full"
            strokeWidth={strokeWidth}
          />
        </div>
      ) : null}
      {chartVariant === 'matrix' ? (
        <div className="pointer-events-none absolute bottom-7 left-5 right-5 h-[64px]">
          <DotMatrixChart
            values={chartValues}
            activeClass="bg-[var(--accent)]/72"
            inactiveClass="bg-[var(--line-soft)]/28"
          />
        </div>
      ) : null}
    </div>
  );
}

function RankedList({
  items,
  valueFormatter,
  emptyText,
  maxValue,
  compact = false,
}: {
  items: RankedMetricItem[];
  valueFormatter: (value: number) => string;
  emptyText: string;
  maxValue?: number;
  compact?: boolean;
}) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-[var(--text-secondary)]">{emptyText}</div>;
  }

  const scaleMax = maxValue ?? Math.max(...items.map(item => item.value), 1);
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {items.map(item => (
        <div
          key={item.id}
          className={`${compact ? 'space-y-0.5' : 'space-y-1'} [contain-intrinsic-size:56px] [content-visibility:auto]`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {compact ? (
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {item.label}
                  </span>
                  {item.sublabel ? (
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      {item.sublabel}
                    </span>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {item.label}
                  </div>
                  {item.sublabel ? (
                    <div className="truncate text-xs text-[var(--text-secondary)]">
                      {item.sublabel}
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div
              className={`${compact ? 'text-[13px]' : 'text-sm'} shrink-0 font-semibold text-[var(--text-primary)]`}
            >
              {valueFormatter(item.value)}
            </div>
          </div>
          <div className={`${compact ? 'h-1.5' : 'h-2'} rounded-full bg-[var(--surface-1)]`}>
            <div
              className={`${compact ? 'h-1.5' : 'h-2'} rounded-full bg-[var(--accent)]`}
              style={{ width: `${Math.max((item.value / scaleMax) * 100, 4)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DistributionList({
  histogram,
  emptyText,
}: {
  histogram: Record<string, number>;
  emptyText: string;
}) {
  const entries = Object.entries(histogram).sort((left, right) => right[1] - left[1]);
  if (entries.length === 0) {
    return <div className="py-6 text-center text-sm text-[var(--text-secondary)]">{emptyText}</div>;
  }

  const max = Math.max(...entries.map(([, value]) => value), 1);
  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[20px_minmax(0,1fr)_38px] items-center gap-1.5">
          <div className="truncate text-[11px] text-[var(--text-secondary)]">{label}</div>
          <div className="h-2 rounded-full bg-[var(--surface-1)]">
            <div
              className="h-2 rounded-full bg-[var(--accent)]"
              style={{ width: `${Math.max((value / max) * 100, 4)}%` }}
            />
          </div>
          <div className="text-right text-[11px] font-medium text-[var(--text-primary)]">
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function CheckinStatusList({
  items,
  emptyText,
}: {
  items: SiteCheckinOverviewRow[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm text-[var(--text-secondary)]">{emptyText}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        aria-label="每日签到概览滚动区域"
        className="min-h-0 flex-1 overflow-y-auto pr-4 [scrollbar-gutter:stable]"
      >
        <div className="space-y-0.5">
          {items.map(item => {
            const statusLabel =
              item.pendingCheckins > 0
                ? `待签 ${item.pendingCheckins}/${item.checkinTargetCount}`
                : item.completedCheckins > 0
                  ? '已签到'
                  : '待确认';
            const truncatedSiteName = truncateTextByDisplayWidth(
              item.siteName,
              CHECKIN_SITE_NAME_MAX_WIDTH
            );
            const statusClass =
              item.pendingCheckins > 0
                ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                : item.completedCheckins > 0
                  ? 'bg-[var(--success-soft)] text-[var(--success)]'
                  : 'bg-[var(--surface-1)] text-[var(--text-secondary)]';

            return (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1.4fr)_108px_44px_58px] items-center gap-2 py-1 [contain-intrinsic-size:40px] [content-visibility:auto]"
              >
                <div className="min-w-0 truncate whitespace-nowrap text-[12px] font-medium text-[var(--text-primary)]">
                  <span title={item.siteName}>{truncatedSiteName}</span>
                  <span className="ml-1 text-[10px] font-normal text-[var(--text-secondary)]">
                    / {item.accountName}
                  </span>
                </div>
                <div className="truncate whitespace-nowrap text-left text-[10px] text-[var(--text-secondary)]">
                  <span>本月 {formatCompactNumber(item.monthCheckinCount)}</span>
                  <span className="mx-1">/</span>
                  <span>累计 {formatCompactNumber(item.totalCheckins)}</span>
                </div>
                <div className="flex justify-start">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusClass}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="text-right text-[11px] font-medium text-[var(--text-primary)]">
                  {item.todayCheckinQuota > 0
                    ? `+${formatCheckinQuota(item.todayCheckinQuota)}`
                    : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DataOverviewPage({
  setPageHeaderActions,
}: {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
} = {}) {
  const config = useConfigStore(state => state.config);
  const activeTab = useUIStore(state => state.activeTab);
  const view = useUIStore(state => state.overviewSubtab);
  const [routeWindow, setRouteWindow] = useState<RouteWindow>('7d');
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeDistribution, setRouteDistribution] = useState<RouteDistribution | null>(null);
  const [routeObjectStats, setRouteObjectStats] = useState<RouteAnalyticsObjectStatsItem[]>([]);
  const [recentRouteLogs, setRecentRouteLogs] = useState<RouteRequestLogItem[]>([]);
  const [siteSnapshotsById, setSiteSnapshotsById] = useState<Record<string, SiteDailySnapshot[]>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(AGGREGATED_SITE_OPTION_ID);
  const isOverviewActive = activeTab === 'overview';

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

  const loadOverview = useCallback(async () => {
    if (!window.electronAPI.route) {
      setError('当前环境未暴露 route IPC 接口。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [summaryRes, distributionRes, objectStatsRes, logsRes, snapshotsRes] =
        await Promise.all([
          window.electronAPI.route.getAnalyticsSummary({ window: routeWindow }),
          window.electronAPI.route.getAnalyticsDistribution({ window: routeWindow }),
          window.electronAPI.route.getObjectStats?.({
            window: routeWindow,
            limit: 8,
            sortBy: 'successRate',
          }),
          window.electronAPI.route.getRequestLogs({ limit: 200 }),
          window.electronAPI.overview?.getSiteDailySnapshots({ days: 30 }),
        ]);

      if (!summaryRes?.success) {
        throw new Error(summaryRes?.error || '加载路由汇总失败');
      }
      if (!distributionRes?.success) {
        throw new Error(distributionRes?.error || '加载路由分布失败');
      }

      setRouteSummary(summaryRes.data || null);
      setRouteDistribution(distributionRes.data || null);
      setRouteObjectStats(objectStatsRes?.success ? objectStatsRes.data || [] : []);
      setRecentRouteLogs(logsRes?.success ? logsRes.data || [] : []);
      setSiteSnapshotsById(snapshotsRes?.success ? snapshotsRes.data || {} : {});
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '加载数据总览失败');
    } finally {
      setLoading(false);
    }
  }, [routeWindow]);

  useEffect(() => {
    if (!isOverviewActive) {
      return;
    }

    void loadOverview();
  }, [isOverviewActive, loadOverview]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!isOverviewActive) {
        return;
      }

      if (!domains.includes('site-overview') && !domains.includes('route-overview')) {
        return;
      }

      void loadOverview();
    });

    return () => {
      unsubscribe?.();
    };
  }, [isOverviewActive, loadOverview]);

  const trendPoints = useMemo(
    () => buildRouteTrendPoints(routeDistribution?.buckets || [], routeWindow),
    [routeDistribution, routeWindow]
  );
  const requestTrend = trendPoints.map(point => point.requestCount);
  const successRateTrend = trendPoints.map(point => {
    const denominator = point.successCount + point.failureCount;
    return denominator > 0 ? Number(((point.successCount / denominator) * 100).toFixed(1)) : 0;
  });
  const tokenTrend = trendPoints.map(point => point.totalTokens);
  const slowTrend = trendPoints.map(point =>
    point.requestCount > 0
      ? Number(((point.slowRequestCount / point.requestCount) * 100).toFixed(1))
      : 0
  );

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
  const totalBalance = siteMetrics.reduce((sum, metric) => sum + metric.balance, 0);
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
      balance: siteMetrics.reduce((sum, metric) => sum + metric.balance, 0),
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

  const ruleMetrics = useMemo(() => {
    const grouped = new Map<
      string,
      {
        id: string;
        ruleId: string;
        cliType: RouteCliType;
        canonicalModel: string;
        requests: number;
        failures: number;
        siteKeys: Set<string>;
        sourceKeys: Set<string>;
      }
    >();

    for (const bucket of routeDistribution?.buckets || []) {
      if (!bucket.routeRuleId) continue;
      const canonicalModel = bucket.canonicalModel || '未标记模型';
      const id = `${bucket.routeRuleId}:${bucket.cliType}:${canonicalModel}`;
      const current = grouped.get(id) || {
        id,
        ruleId: bucket.routeRuleId,
        cliType: bucket.cliType,
        canonicalModel,
        requests: 0,
        failures: 0,
        siteKeys: new Set<string>(),
        sourceKeys: new Set<string>(),
      };
      current.requests += bucket.requestCount;
      current.failures += bucket.failureCount;
      current.siteKeys.add(bucket.siteId || '*');
      current.sourceKeys.add(
        `${bucket.siteId || '*'}:${bucket.accountId || '*'}:${bucket.apiKeyId || '*'}`
      );
      grouped.set(id, current);
    }

    return Array.from(grouped.values())
      .map(metric => ({
        id: metric.id,
        ruleId: metric.ruleId,
        cliType: metric.cliType,
        canonicalModel: metric.canonicalModel,
        requests: metric.requests,
        failures: metric.failures,
        siteCount: metric.siteKeys.size,
        sourceCount: metric.sourceKeys.size,
      }))
      .sort(
        (left, right) =>
          right.failures - left.failures ||
          right.requests - left.requests ||
          left.id.localeCompare(right.id)
      );
  }, [routeDistribution]);

  const failingLogs = useMemo(
    () =>
      [...recentRouteLogs]
        .filter(item => item.outcome === 'failure')
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 5),
    [recentRouteLogs]
  );
  const latestSlowRatio = slowTrend.length > 0 ? slowTrend[slowTrend.length - 1] || 0 : 0;
  const requestTrendSummary = useMemo(() => buildTrendDeltaSummary(requestTrend), [requestTrend]);
  const tokenTrendSummary = useMemo(() => buildTrendDeltaSummary(tokenTrend), [tokenTrend]);
  const slowTrendSummary = useMemo(() => buildTrendDeltaSummary(slowTrend), [slowTrend]);

  const pageContainerClassName = 'flex-1 overflow-y-auto px-6 py-4';
  const pageContentClassName = view === 'route' ? 'flex min-h-full flex-col gap-4' : 'space-y-4';
  const headerActions = useMemo(
    () => (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {view === 'route'
          ? (['24h', '7d', '30d'] as RouteWindow[]).map(windowOption => (
              <AppButton
                key={windowOption}
                variant={routeWindow === windowOption ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setRouteWindow(windowOption)}
              >
                {windowOption}
              </AppButton>
            ))
          : null}
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() => void loadOverview()}
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
    [loadOverview, loading, routeWindow, view]
  );

  useEffect(() => {
    setPageHeaderActions?.(headerActions);

    return () => {
      setPageHeaderActions?.(null);
    };
  }, [headerActions, setPageHeaderActions]);

  return (
    <div className={pageContainerClassName}>
      <div className={pageContentClassName}>
        {error ? (
          <AppCard blur={false} hoverable={false}>
            <AppCardContent className="p-4 text-sm text-[var(--danger)]">{error}</AppCardContent>
          </AppCard>
        ) : null}

        {view === 'site' ? (
          <>
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
              <AppCard blur={false} hoverable={false} className="xl:h-[208px]">
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

              <AppCard blur={false} hoverable={false} className="xl:h-[208px]">
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
                      <div className="mb-2 text-xs text-[var(--text-secondary)]">
                        今日消费最高站点
                      </div>
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
                    <select
                      aria-label="选择站点历史"
                      value={selectedSiteId}
                      onChange={event =>
                        setSelectedSiteId(event.target.value || AGGREGATED_SITE_OPTION_ID)
                      }
                      className="h-7 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 text-xs text-[var(--text-primary)]"
                    >
                      <option value={AGGREGATED_SITE_OPTION_ID}>
                        {AGGREGATED_SITE_OPTION_LABEL}
                      </option>
                      {rankedSiteMetrics.map(metric => (
                        <option key={metric.siteId} value={metric.siteId}>
                          {metric.siteName}
                        </option>
                      ))}
                    </select>
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
                      values={selectedSiteSnapshotSeries.map(
                        snapshot => snapshot?.todayUsage ?? null
                      )}
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
                      values={selectedSiteSnapshotSeries.map(
                        snapshot => snapshot?.totalTokens ?? null
                      )}
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
          </>
        ) : (
          <div aria-label="路由数据驾驶舱" className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 xl:flex-none">
              <RouteMetricCard
                label="路由请求量"
                value={routeSummary ? formatCompactNumber(routeSummary.totalRequests) : '—'}
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
                      : 'bg-[var(--surface-1)] text-[var(--text-secondary)]'
                }
              />
              <RouteMetricCard
                label="路由成功率"
                value={routeSummary ? formatPercent(routeSummary.successRate) : '—'}
                hint={`失败 ${formatCompactNumber(routeSummary?.failureCount || 0)} 次`}
                chip="健康度"
                toneClass={
                  routeSummary && routeSummary.successRate < 80
                    ? 'text-[var(--danger)]'
                    : 'text-[var(--success)]'
                }
                chipToneClass={
                  routeSummary && routeSummary.successRate < 80
                    ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                    : 'bg-[var(--success-soft)] text-[var(--success)]'
                }
              />
              <RouteMetricCard
                label="Token 消耗"
                value={
                  routeSummary && routeSummary.totalTokens > 0
                    ? formatCompactNumber(routeSummary.totalTokens)
                    : '暂无'
                }
                hint={
                  routeSummary && routeSummary.totalTokens > 0
                    ? `Prompt ${formatCompactNumber(routeSummary.promptTokens)} / Completion ${formatCompactNumber(routeSummary.completionTokens)}`
                    : '上游未返回 usage 或暂无成功请求'
                }
                chip={formatTrendDeltaBadge(
                  tokenTrendSummary.direction,
                  tokenTrendSummary.deltaPercent,
                  tokenTrendSummary.previousValue
                )}
                toneClass="text-[var(--warning)]"
                chipToneClass="bg-[var(--warning-soft)] text-[var(--warning)]"
              />
              <RouteMetricCard
                label="响应体验"
                value={formatPercent(latestSlowRatio)}
                hint="慢请求占比，按耗时分桶估算"
                chip={formatTrendDeltaBadge(
                  slowTrendSummary.direction,
                  slowTrendSummary.deltaPercent,
                  slowTrendSummary.previousValue
                )}
                toneClass={
                  latestSlowRatio >= 20 ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
                }
                chipToneClass={
                  latestSlowRatio >= 20
                    ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                    : 'bg-[var(--surface-1)] text-[var(--text-secondary)]'
                }
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.78fr)]">
              <RouteTrendHeroCard
                routeWindow={routeWindow}
                requestTrend={requestTrend}
                successRateTrend={successRateTrend}
                tokenTrend={tokenTrend}
                trendPoints={trendPoints}
              />

              <AppCard
                blur={false}
                hoverable={false}
                className="min-h-[264px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
              >
                <AppCardContent className="flex h-full min-h-0 flex-col p-4">
                  <SectionTitle
                    icon={Gauge}
                    title="活跃对象"
                    subtitle="按站点 / 账户 / API Key 聚合"
                  />
                  <RouteObjectStatsList items={routeObjectStats} />
                </AppCardContent>
              </AppCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.10fr)_minmax(0,0.90fr)]">
              <AppCard
                blur={false}
                hoverable={false}
                className="h-[216px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
              >
                <AppCardContent className="flex h-full min-h-0 flex-col p-3.5">
                  <SectionTitle icon={ShieldAlert} title="异常摘要" />
                  <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(0,1.2fr)]">
                    <div className="min-h-0 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--surface-2)] px-3.5 py-3">
                      <div className="mb-2 text-xs text-[var(--text-secondary)]">状态码分布</div>
                      <DistributionList
                        histogram={routeDistribution?.statusCodeHistogram || {}}
                        emptyText="当前时间窗口暂无状态码统计"
                      />
                    </div>
                    <div className="min-h-0 rounded-[var(--radius-lg)] bg-[var(--surface-2)] px-3.5 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--text-secondary)]">主要失败规则</span>
                      </div>
                      <RouteFailureRuleMetricsList items={ruleMetrics} />
                    </div>
                  </div>
                </AppCardContent>
              </AppCard>

              <AppCard
                blur={false}
                hoverable={false}
                className="h-[216px] border border-white/70 bg-[var(--surface-3)] shadow-[var(--shadow-sm)]"
              >
                <AppCardContent className="flex h-full min-h-0 flex-col p-3.5">
                  <SectionTitle icon={AlertTriangle} title="最近异常" />
                  <RouteFailureList items={failingLogs} />
                </AppCardContent>
              </AppCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
