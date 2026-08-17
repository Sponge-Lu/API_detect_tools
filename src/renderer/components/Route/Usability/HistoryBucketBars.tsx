/**
 * History Bucket Bars 组件
 * 输入: siteId, accountId，以及列表头共享的实际请求端点选择
 * 输出: 48 小时 / 2 小时时间桶成功率条形图
 * 定位: 展示层 - 站点管理页 History 列的数据可视化
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import {
  getRouteHistoryEndpointLabel,
  normalizeRouteHistoryEndpoint,
  type HistoryBucket,
  type HistoryEndpointTrack,
} from '../../../../shared/types/route-proxy';
import { useUIStore } from '../../../store/uiStore';

export const HISTORY_POLL_INTERVAL_MS = 60_000;
const BUCKET_SIZE_MS = 2 * 60 * 60 * 1000;
const TIME_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const BUCKET_COUNT = Math.floor(TIME_WINDOW_MS / BUCKET_SIZE_MS);
const BAR_GAP_PX = 1;

interface HistoryBucketBarsProps {
  siteId: string;
  accountId: string;
  miniature?: boolean;
}

interface TrackLayout {
  barWidthPx: number | null;
  gapPx: number;
  style: CSSProperties;
}

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
      routeCount: 0,
    };
  });
}

function isHistoryBucket(value: unknown): value is HistoryBucket {
  if (!value || typeof value !== 'object') return false;
  const bucket = value as Partial<HistoryBucket>;
  return (
    typeof bucket.bucketStart === 'number' &&
    typeof bucket.bucketEnd === 'number' &&
    (bucket.successRate === null || typeof bucket.successRate === 'number') &&
    typeof bucket.routeCount === 'number'
  );
}

function normalizeBuckets(value: unknown): HistoryBucket[] {
  if (!Array.isArray(value)) return buildEmptyBuckets();
  const buckets = value.filter(isHistoryBucket);
  return buckets.length > 0 ? buckets : buildEmptyBuckets();
}

function normalizeHistoryTracks(value: unknown): HistoryEndpointTrack[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  if (isHistoryBucket(value[0])) return [];

  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const track = item as Partial<HistoryEndpointTrack>;
    const rawEndpoint = typeof track.targetEndpoint === 'string' ? track.targetEndpoint.trim() : '';
    const targetEndpoint = normalizeRouteHistoryEndpoint(rawEndpoint);
    if (!targetEndpoint) return [];
    return [{ targetEndpoint, buckets: normalizeBuckets(track.buckets) }];
  });
}

function areHistoryBucketsEqual(left: HistoryBucket[], right: HistoryBucket[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((bucket, index) => {
    const other = right[index];
    return (
      bucket.bucketStart === other.bucketStart &&
      bucket.bucketEnd === other.bucketEnd &&
      bucket.successRate === other.successRate &&
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

/** Map 0..1 to the existing danger/success tokens without changing chart geometry. */
function getBucketColor(successRate: number | null): string {
  if (successRate === null || !Number.isFinite(successRate)) {
    return 'var(--cli-history-empty)';
  }
  const rate = Math.max(0, Math.min(1, successRate));
  return `color-mix(in srgb, var(--cli-history-success) ${Math.round(rate * 100)}%, var(--cli-history-danger))`;
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
  miniature = false,
}: HistoryBucketBarsProps) {
  const selectedEndpoint = useUIStore(state => state.historyTargetEndpoint);
  const [tracks, setTracks] = useState<HistoryEndpointTrack[]>([]);
  const [buckets, setBuckets] = useState<HistoryBucket[]>(() => buildEmptyBuckets());

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const loadTracks = async () => {
      const routeApi = window.electronAPI?.route;
      if (!routeApi?.getHistoryBuckets) {
        if (!cancelled) setTracks([]);
        return;
      }

      try {
        const response = await routeApi.getHistoryBuckets({
          window: '48h',
          bucketSize: '2h',
          siteId,
          accountId,
        });
        if (!cancelled) {
          setTracks(response?.success ? normalizeHistoryTracks(response.data) : []);
        }
      } catch {
        if (!cancelled) setTracks([]);
      }
    };

    void loadTracks();
    pollTimer = setInterval(() => {
      if (!cancelled) void loadTracks();
    }, HISTORY_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [accountId, siteId]);

  const visibleTrack = useMemo<HistoryEndpointTrack>(() => {
    if (tracks.length === 0) {
      return {
        targetEndpoint: selectedEndpoint || '暂无端点数据',
        buckets: buildEmptyBuckets(),
      };
    }

    if (selectedEndpoint) {
      const selectedTrack = tracks.find(track => track.targetEndpoint === selectedEndpoint);
      if (selectedTrack) return selectedTrack;
      return { targetEndpoint: selectedEndpoint, buckets: buildEmptyBuckets() };
    }

    return tracks[0];
  }, [selectedEndpoint, tracks]);

  useEffect(() => {
    setBucketsIfChanged(setBuckets, normalizeBuckets(visibleTrack.buckets));
  }, [visibleTrack]);

  const barHeight = miniature ? 8 : 13;
  const endpointDescription = useMemo(() => {
    const label = getRouteHistoryEndpointLabel(visibleTrack.targetEndpoint);
    return label === visibleTrack.targetEndpoint
      ? label
      : `${label} · ${visibleTrack.targetEndpoint}`;
  }, [visibleTrack.targetEndpoint]);
  const tooltips = useMemo(() => {
    return buckets.map(bucket => {
      const rate = bucket.successRate !== null ? Math.round(bucket.successRate * 100) : null;
      return [
        formatBucketTime(bucket.bucketStart, bucket.bucketEnd),
        endpointDescription,
        `路由请求 ${bucket.routeCount} 次 ${rate !== null ? `${rate}%` : '--'}`,
      ].join('\n');
    });
  }, [buckets, endpointDescription]);

  const colors = useMemo(
    () => buckets.map(bucket => getBucketColor(bucket.successRate)),
    [buckets]
  );

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;

    const measure = () => {
      const nextTrackWidth = Math.max(0, Math.floor(node.getBoundingClientRect().width));
      setTrackWidth(previous => (previous === nextTrackWidth ? previous : nextTrackWidth));
    };

    measure();

    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(node);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const trackLayout = useMemo(
    () => buildTrackLayout(trackWidth, buckets.length, BAR_GAP_PX, barHeight),
    [barHeight, buckets.length, trackWidth]
  );

  return (
    <div className="w-full" data-testid="history-endpoint-track">
      <div
        className="w-full overflow-hidden"
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
