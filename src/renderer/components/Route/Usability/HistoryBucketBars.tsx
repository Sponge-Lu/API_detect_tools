/**
 * History Bucket Bars 组件
 * 输入: siteId, accountId, 可选 cliType/mode (默认从 uiStore 读取)
 * 输出: 时间桶聚合成功率条形图（2h 桶，48 小时 = 24 桶），并按 60s 间隔轮询刷新
 * 定位: 展示层 - 接入管理页 History 列的数据可视化
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/Route/Usability/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { memo, useMemo, useRef, useState, useEffect } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import type {
  HistoryBucket,
  RouteCliType,
  RouteHistoryBucketsQuery,
} from '../../../../shared/types/route-proxy';
import { useUIStore } from '../../../store/uiStore';

export type HistoryMode = 'combined' | 'probe' | 'route';

const HISTORY_POLL_INTERVAL_MS = 60_000;

interface HistoryBucketBarsProps {
  siteId: string;
  accountId: string;
  /** 可选覆盖；默认从 uiStore 读取 */
  cliType?: RouteCliType;
  mode?: HistoryMode;
  miniature?: boolean;
}

interface TrackLayout {
  barWidthPx: number | null;
  gapPx: number;
  style: CSSProperties;
}

const BUCKET_SIZE_MS = 2 * 60 * 60 * 1000; // 2 hours
const TIME_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 48 hours (2 days)
const BUCKET_COUNT = Math.floor(TIME_WINDOW_MS / BUCKET_SIZE_MS); // 24 buckets
const BAR_GAP_PX = 1;
const MINIATURE_HEIGHT = 8;
const LARGE_HEIGHT = 13;

function getBucketStartTime(timestamp: number): number {
  return Math.floor(timestamp / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
}

function buildEmptyBuckets(now = Date.now()): HistoryBucket[] {
  const oldestBucketStart = getBucketStartTime(now - TIME_WINDOW_MS);
  return Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const bucketStart = oldestBucketStart + index * BUCKET_SIZE_MS;
    return {
      bucketStart,
      bucketEnd: bucketStart + BUCKET_SIZE_MS,
      successRate: null,
      probeCount: 0,
      routeCount: 0,
    };
  });
}

function mapHistoryMode(mode: HistoryMode): RouteHistoryBucketsQuery['mode'] {
  if (mode === 'probe') return 'probe-only';
  if (mode === 'route') return 'route-only';
  return 'combined';
}

function areHistoryBucketsEqual(left: HistoryBucket[], right: HistoryBucket[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((bucket, index) => {
    const other = right[index];
    return (
      bucket.bucketStart === other.bucketStart &&
      bucket.bucketEnd === other.bucketEnd &&
      bucket.successRate === other.successRate &&
      bucket.probeCount === other.probeCount &&
      bucket.routeCount === other.routeCount
    );
  });
}

function setBucketsIfChanged(
  setBuckets: Dispatch<SetStateAction<HistoryBucket[]>>,
  nextBuckets: HistoryBucket[]
) {
  setBuckets(currentBuckets =>
    areHistoryBucketsEqual(currentBuckets, nextBuckets) ? currentBuckets : nextBuckets
  );
}

function padTimePart(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatBucketTime(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  return `${padTimePart(start.getMonth() + 1)}/${padTimePart(start.getDate())} ${padTimePart(start.getHours())}:${padTimePart(start.getMinutes())} - ${padTimePart(end.getHours())}:${padTimePart(end.getMinutes())}`;
}

function getBucketColor(successRate: number | null): string {
  if (successRate === null) return 'var(--cli-history-empty)';
  if (successRate >= 0.8) return 'var(--cli-history-success)';
  if (successRate >= 0.5) return 'var(--warning)';
  return 'var(--cli-history-danger)';
}

function buildTrackLayout(
  trackWidth: number | null,
  pointCount: number,
  preferredGapPx: number,
  barHeight: number
): TrackLayout {
  const fallbackStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${pointCount}, minmax(0, 1fr))`,
    gap: `${preferredGapPx}px`,
    height: barHeight,
  };

  if (!trackWidth || trackWidth <= 0 || pointCount <= 0) {
    return {
      barWidthPx: null,
      gapPx: preferredGapPx,
      style: fallbackStyle,
    };
  }

  if (pointCount === 1) {
    const singleBarWidthPx = Math.max(1, Math.floor(trackWidth));
    return {
      barWidthPx: singleBarWidthPx,
      gapPx: 0,
      style: {
        gridTemplateColumns: `${singleBarWidthPx}px`,
        gap: '0px',
        height: barHeight,
      },
    };
  }

  const preferredTotalGapPx = preferredGapPx * (pointCount - 1);
  const barWidthPx = Math.max(1, Math.floor((trackWidth - preferredTotalGapPx) / pointCount));
  const gapPx = Number(
    Math.max(0, (trackWidth - barWidthPx * pointCount) / (pointCount - 1)).toFixed(3)
  );

  return {
    barWidthPx,
    gapPx,
    style: {
      gridTemplateColumns: `repeat(${pointCount}, ${barWidthPx}px)`,
      gap: `${gapPx}px`,
      height: barHeight,
    },
  };
}

export const HistoryBucketBars = memo(function HistoryBucketBars({
  siteId,
  accountId,
  cliType: cliTypeProp,
  mode: modeProp,
  miniature = false,
}: HistoryBucketBarsProps) {
  const storeCliType = useUIStore(state => state.historyCliType);
  const storeMode = useUIStore(state => state.historyMode);
  const cliType = cliTypeProp ?? storeCliType;
  const mode = modeProp ?? storeMode;
  const barHeight = miniature ? MINIATURE_HEIGHT : LARGE_HEIGHT;
  const [buckets, setBuckets] = useState<HistoryBucket[]>(() => buildEmptyBuckets());

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const loadBuckets = async () => {
      const fallbackBuckets = buildEmptyBuckets();
      const routeApi = window.electronAPI?.route;
      if (!routeApi?.getHistoryBuckets) {
        setBucketsIfChanged(setBuckets, fallbackBuckets);
        return;
      }

      try {
        const response = await routeApi.getHistoryBuckets({
          window: '48h',
          bucketSize: '2h',
          siteId,
          accountId,
          cliType,
          mode: mapHistoryMode(mode),
        });

        if (cancelled) return;
        if (response?.success && Array.isArray(response.data)) {
          setBucketsIfChanged(setBuckets, response.data);
        } else {
          setBucketsIfChanged(setBuckets, fallbackBuckets);
        }
      } catch {
        if (!cancelled) {
          setBucketsIfChanged(setBuckets, fallbackBuckets);
        }
      }
    };

    void loadBuckets();
    pollTimer = setInterval(() => {
      if (!cancelled) void loadBuckets();
    }, HISTORY_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [accountId, cliType, mode, siteId]);

  const tooltips = useMemo(() => {
    return buckets.map(bucket => {
      const lines: string[] = [];
      lines.push(formatBucketTime(bucket.bucketStart, bucket.bucketEnd));
      lines.push(
        `CLI: ${cliType === 'claudeCode' ? 'Claude Code' : cliType === 'codex' ? 'Codex' : 'Gemini CLI'}`
      );

      const rate = bucket.successRate !== null ? Math.round(bucket.successRate * 100) : null;
      if (mode === 'combined') {
        lines.push(`CLI探测 ${bucket.probeCount} 次`);
        lines.push(`路由请求 ${bucket.routeCount} 次`);
        lines.push(`综合 ${rate !== null ? `${rate}%` : '--'}`);
      } else if (mode === 'probe') {
        lines.push(`CLI探测 ${bucket.probeCount} 次 ${rate !== null ? `${rate}%` : '--'}`);
      } else {
        lines.push(`路由请求 ${bucket.routeCount} 次 ${rate !== null ? `${rate}%` : '--'}`);
      }

      return lines.join('\n');
    });
  }, [buckets, cliType, mode]);

  const colors = useMemo(() => {
    return buckets.map(bucket => getBucketColor(bucket.successRate));
  }, [buckets]);

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;

    const measure = () => {
      const nextTrackWidth = Math.max(0, Math.floor(node.getBoundingClientRect().width));
      setTrackWidth(prevWidth => (prevWidth === nextTrackWidth ? prevWidth : nextTrackWidth));
    };

    measure();

    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(() => {
        measure();
      });
      resizeObserver.observe(node);
      return () => {
        resizeObserver.disconnect();
      };
    }

    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);

  const trackLayout = useMemo(
    () => buildTrackLayout(trackWidth, BUCKET_COUNT, BAR_GAP_PX, barHeight),
    [trackWidth, barHeight]
  );

  return (
    <div className="w-full">
      <div
        className="overflow-hidden rounded-[8px] border border-[var(--line-soft)] bg-[var(--surface-2)] p-[2px]"
        data-testid="history-bucket-bars-frame"
      >
        <div
          className="grid w-full items-stretch"
          data-testid="history-bucket-bars-track"
          data-bar-width={trackLayout.barWidthPx ?? undefined}
          data-gap-px={trackLayout.gapPx}
          ref={trackRef}
          style={trackLayout.style}
        >
          {buckets.map((bucket, index) => (
            <div
              key={bucket.bucketStart}
              className="h-full cursor-help rounded-[3px] transition-opacity hover:opacity-80"
              style={{ backgroundColor: colors[index] }}
              title={tooltips[index]}
              aria-label={tooltips[index]}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
