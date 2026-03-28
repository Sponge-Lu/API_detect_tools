/**
 * CLI 可用性检测 Sub-Tab
 * 输入: routeStore (探测数据缓存), configStore (站点配置)
 * 输出: CLI 探测历史表格，延迟可视化
 * 定位: 路由页 CLI 可用性子面板
 */

import { useEffect, useState, memo } from 'react';
import { Play, Loader2, Settings2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { IOSCard, IOSCardContent } from '../../IOSCard';
import { IOSButton } from '../../IOSButton';
import { IOSModal } from '../../IOSModal';
import { IOSInput } from '../../IOSInput';
import type {
  RouteCliType,
  RouteCliProbeSample,
  RouteCliProbeCliView,
} from '../../../../shared/types/route-proxy';

type TimeRange = '24h' | '7d';
const CLI_PROBE_TIME_RANGES: TimeRange[] = ['24h', '7d'];
const CLI_TYPES: RouteCliType[] = ['claudeCode', 'codex', 'geminiCli'];

const CLI_META: Record<
  RouteCliType,
  { label: string; accent: string; headerBg: string; cellBg: string }
> = {
  claudeCode: {
    label: 'Claude Code',
    accent: 'text-orange-600 dark:text-orange-400',
    headerBg: 'bg-orange-50/80 dark:bg-orange-900/20',
    cellBg: 'bg-orange-50/20 dark:bg-orange-950/10',
  },
  codex: {
    label: 'Codex',
    accent: 'text-emerald-600 dark:text-emerald-400',
    headerBg: 'bg-emerald-50/80 dark:bg-emerald-900/20',
    cellBg: 'bg-emerald-50/20 dark:bg-emerald-950/10',
  },
  geminiCli: {
    label: 'Gemini CLI',
    accent: 'text-blue-600 dark:text-blue-400',
    headerBg: 'bg-blue-50/80 dark:bg-blue-900/20',
    cellBg: 'bg-blue-50/20 dark:bg-blue-950/10',
  },
};

// ============= History 条形图 =============

const POINT_COUNT = 60;
const BAR_H = 48;
const HOUR_BUCKET_MS = 60 * 60 * 1000;

interface HistorySlot {
  bucketKey: number | null;
  samples: Array<RouteCliProbeSample | null>;
}

function formatProbeLatency(ms?: number) {
  if (!ms) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatProbeDateTime(testedAt?: number) {
  if (!testedAt) return '—';
  return new Date(testedAt).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getSegmentColor(sample: RouteCliProbeSample | null) {
  if (!sample) return 'bg-gray-200 dark:bg-gray-700/80';
  return sample.success ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-red-400 dark:bg-red-500';
}

function formatProbeResult(sample: RouteCliProbeSample | null) {
  if (!sample) return '未测试';
  if (sample.success) {
    return `对话时间 ${formatProbeLatency(sample.totalLatencyMs)}`;
  }
  if (sample.statusCode !== undefined) {
    return `错误码 ${sample.statusCode}`;
  }
  if (sample.error) {
    return sample.error;
  }
  return '失败';
}

function buildHistorySlots(samplesByModel: Array<RouteCliProbeSample[]>): HistorySlot[] {
  const bucketKeys = Array.from(
    new Set(
      samplesByModel.flatMap(samples =>
        samples.map(sample => Math.floor(sample.testedAt / HOUR_BUCKET_MS) * HOUR_BUCKET_MS)
      )
    )
  )
    .sort((left, right) => left - right)
    .slice(-POINT_COUNT);

  const slots: HistorySlot[] = bucketKeys.map(bucketKey => ({
    bucketKey,
    samples: new Array<RouteCliProbeSample | null>(samplesByModel.length).fill(null),
  }));
  const slotIndexByBucket = new Map(slots.map((slot, index) => [slot.bucketKey, index]));

  samplesByModel.forEach((samples, modelIndex) => {
    for (const sample of samples) {
      const bucketKey = Math.floor(sample.testedAt / HOUR_BUCKET_MS) * HOUR_BUCKET_MS;
      const slotIndex = slotIndexByBucket.get(bucketKey);
      if (slotIndex === undefined) continue;

      const existing = slots[slotIndex].samples[modelIndex];
      if (!existing || sample.testedAt > existing.testedAt) {
        slots[slotIndex].samples[modelIndex] = sample;
      }
    }
  });

  while (slots.length < POINT_COUNT) {
    slots.unshift({
      bucketKey: null,
      samples: new Array<RouteCliProbeSample | null>(samplesByModel.length).fill(null),
    });
  }

  return slots;
}

function buildSegmentTooltip(modelName: string, sample: RouteCliProbeSample | null) {
  return `模型名称：${modelName}\n测试时间：${formatProbeDateTime(sample?.testedAt)}\n测试结果：${formatProbeResult(sample)}`;
}

const HistoryBars = memo(function HistoryBars({
  models,
}: {
  models: RouteCliProbeCliView['models'];
}) {
  const slots = buildHistorySlots(models.map(model => model?.history ?? []));
  const activePointCount = slots.filter(slot => slot.bucketKey !== null).length;

  return (
    <div>
      <div
        className="grid gap-px overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${POINT_COUNT}, minmax(0, 1fr))`,
          height: BAR_H,
        }}
      >
        {slots.map((slot, slotIndex) => (
          <div
            key={slot.bucketKey ?? `empty-${slotIndex}`}
            className="flex h-full flex-col gap-px bg-white/60 dark:bg-gray-950/40"
          >
            {[0, 1, 2].map(index => {
              const model = models[index];
              const sample = slot.samples[index] ?? null;
              const modelName = model?.canonicalModel || `模型${index + 1}`;

              return (
                <div
                  key={`${slot.bucketKey ?? 'empty'}-${modelName}`}
                  className={`flex-1 cursor-help transition-opacity hover:opacity-80 ${getSegmentColor(sample)}`}
                  title={buildSegmentTooltip(modelName, sample)}
                  aria-label={buildSegmentTooltip(modelName, sample)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 px-0.5">
        <span>PAST</span>
        <span>{activePointCount} pts</span>
        <span>NOW</span>
      </div>
    </div>
  );
});

// ============= 单个 CLI 单元格 =============

const CliCell = memo(function CliCell({ cliView }: { cliView: RouteCliProbeCliView }) {
  const meta = CLI_META[cliView.cliType];

  const formatLatency = (ms?: number) => {
    if (!ms) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  };

  const latencyColor = (ms?: number) => {
    if (!ms) return 'text-gray-400';
    if (ms < 3000) return 'text-emerald-600 dark:text-emerald-400';
    if (ms < 6000) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-500 dark:text-red-400';
  };

  if (!cliView.accountId) {
    return (
      <div className={`p-3 ${meta.cellBg}`}>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">未选择可用账户</div>
      </div>
    );
  }

  if (!cliView.enabled) {
    return <div className={`p-3 ${meta.cellBg}`} />;
  }

  if (cliView.models.length === 0) {
    return (
      <div className={`p-3 ${meta.cellBg}`}>
        <div className="text-[10px] text-gray-400 dark:text-gray-500">未配置测试模型</div>
      </div>
    );
  }

  return (
    <div className={`p-3 ${meta.cellBg}`}>
      <HistoryBars models={cliView.models} />

      <div className="mt-2 space-y-0.5">
        {[0, 1, 2].map(index => {
          const model = cliView.models[index];
          const statusText = model
            ? model.success === true
              ? '兼容'
              : model.success === false
                ? '失败'
                : '未测'
            : '未配置';
          const statusClass =
            model?.success === true
              ? 'text-emerald-600 dark:text-emerald-400'
              : model?.success === false
                ? 'text-red-500 dark:text-red-400'
                : 'text-gray-400 dark:text-gray-500';

          return (
            <div
              key={index}
              className="border-b border-gray-200/70 px-1 py-1 last:border-b-0 dark:border-gray-700/60"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 text-[10px] font-mono text-gray-700 dark:text-gray-300 truncate">
                  {model?.canonicalModel || `模型${index + 1}`}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                  {model?.testedAt
                    ? new Date(model.testedAt).toLocaleString(undefined, {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </div>
                <div
                  className={`text-xs font-semibold tabular-nums ${latencyColor(model?.totalLatencyMs)}`}
                >
                  {formatLatency(model?.totalLatencyMs)}
                </div>
                <div className={`text-[10px] font-medium ${statusClass}`}>{statusText}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ============= 设置弹窗 =============

function ProbeSettingsModal({
  isOpen,
  onClose,
  config: cfg,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  config: { enabled: boolean; intervalMinutes: number };
  onSave: (u: { enabled?: boolean; intervalMinutes?: number }) => void;
}) {
  const [interval, setIntervalVal] = useState(cfg.intervalMinutes);
  const [enabled, setEnabled] = useState(cfg.enabled);
  useEffect(() => {
    setIntervalVal(cfg.intervalMinutes);
    setEnabled(cfg.enabled);
  }, [cfg, isOpen]);

  return (
    <IOSModal isOpen={isOpen} onClose={onClose} title="检测设置" size="sm">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">启用定时检测</span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-10 h-5 rounded-full transition-colors relative ${enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'left-5' : 'left-0.5'}`}
            />
          </button>
        </div>
        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
            检测间隔（分钟）
          </label>
          <IOSInput
            type="number"
            value={interval}
            onChange={e => setIntervalVal(Math.max(10, parseInt(e.target.value) || 60))}
            min={10}
            max={1440}
            size="sm"
          />
          <p className="text-[10px] text-gray-400 mt-1">最小 10 分钟，推荐 60 分钟</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <IOSButton variant="secondary" size="sm" onClick={onClose}>
            取消
          </IOSButton>
          <IOSButton
            variant="primary"
            size="sm"
            onClick={() => {
              onSave({ enabled, intervalMinutes: interval });
              onClose();
            }}
          >
            保存
          </IOSButton>
        </div>
      </div>
    </IOSModal>
  );
}

// ============= 主组件 =============

export function CliUsabilityTab() {
  const {
    config,
    loading,
    cliProbeView,
    cliProbeTimeRange,
    cliProbeLoaded,
    cliProbeError,
    fetchCliProbeData,
    runProbeNow,
    saveCliProbeConfig,
  } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      loading: s.loading,
      cliProbeView: s.cliProbeView,
      cliProbeTimeRange: s.cliProbeTimeRange,
      cliProbeLoaded: s.cliProbeLoaded,
      cliProbeError: s.cliProbeError,
      fetchCliProbeData: s.fetchCliProbeData,
      runProbeNow: s.runProbeNow,
      saveCliProbeConfig: s.saveCliProbeConfig,
    }))
  );
  const [timeRange, setTimeRange] = useState<TimeRange>(cliProbeTimeRange);
  const [probing, setProbing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // 首次加载或 timeRange 变化时获取数据（有缓存则跳过）
  useEffect(() => {
    fetchCliProbeData(timeRange);
  }, [timeRange, fetchCliProbeData]);

  useEffect(() => {
    if (cliProbeError) toast.error(cliProbeError);
  }, [cliProbeError]);

  const handleProbeNow = async () => {
    setProbing(true);
    try {
      const result = await runProbeNow();
      if (result) {
        toast.success(`探测完成: ${result.totalSamples} 样本, ${result.successSamples} 成功`);
        await fetchCliProbeData(timeRange, true);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '未知错误';
      toast.error(`探测失败: ${message}`);
    } finally {
      setProbing(false);
    }
  };

  const probeConfig = config?.cliProbe?.config || { enabled: false, intervalMinutes: 60 };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-3">
      {/* 顶栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {CLI_PROBE_TIME_RANGES.map(r => (
            <IOSButton
              key={r}
              variant={timeRange === r ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setTimeRange(r)}
            >
              {r}
            </IOSButton>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs ${probeConfig.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}
          >
            {probeConfig.enabled ? `每 ${probeConfig.intervalMinutes} 分钟` : '未启用'}
          </span>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="打开检测设置"
          >
            <Settings2 className="w-4 h-4 text-gray-400" />
          </button>
          <IOSButton variant="primary" size="sm" onClick={handleProbeNow} disabled={probing}>
            {probing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span className="ml-1">立即探测</span>
          </IOSButton>
        </div>
      </div>

      {/* 内容区 */}
      {loading && !cliProbeLoaded ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ios-blue)]" />
        </div>
      ) : cliProbeView.length === 0 ? (
        <IOSCard className="p-8 text-center">
          <p className="text-sm text-gray-400">暂无探测数据，请先启用 CLI 探测或点击「立即探测」</p>
        </IOSCard>
      ) : (
        <IOSCard>
          <IOSCardContent className="p-0">
            {/* 表头 */}
            <div className="grid grid-cols-[140px_1fr_1fr_1fr] border-b border-gray-200 dark:border-gray-700">
              <div className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                站点
              </div>
              {CLI_TYPES.map(cli => (
                <div
                  key={cli}
                  className={`px-4 py-2.5 text-xs font-semibold text-center ${CLI_META[cli].accent} ${CLI_META[cli].headerBg}`}
                >
                  {CLI_META[cli].label}
                </div>
              ))}
            </div>

            {/* 数据行 */}
            {cliProbeView.map((siteView, idx) => (
              <div
                key={siteView.siteId}
                className={`grid grid-cols-[140px_1fr_1fr_1fr] ${idx < cliProbeView.length - 1 ? 'border-b border-gray-100 dark:border-gray-800/60' : ''}`}
              >
                <div className="px-4 py-3 flex flex-col justify-center gap-0.5 border-r border-gray-100 dark:border-gray-800/60">
                  <span className="text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate">
                    {siteView.siteName}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {siteView.accountName
                        ? `测试账户: ${siteView.accountName}`
                        : '未选择可用账户'}
                    </span>
                  </div>
                </div>
                {CLI_TYPES.map((cli, ci) => {
                  return (
                    <div
                      key={cli}
                      className={ci < 2 ? 'border-r border-gray-100 dark:border-gray-800/60' : ''}
                    >
                      <CliCell cliView={siteView.clis[cli]} />
                    </div>
                  );
                })}
              </div>
            ))}
          </IOSCardContent>
        </IOSCard>
      )}

      <ProbeSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        config={probeConfig}
        onSave={async u => {
          await saveCliProbeConfig(u);
          toast.success('检测设置已保存');
        }}
      />
    </div>
  );
}
