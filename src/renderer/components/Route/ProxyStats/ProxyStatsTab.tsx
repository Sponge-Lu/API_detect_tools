/**
 * 代理服务&统计 Sub-Tab
 * 输入: routeStore (服务器配置/模型选择/统计)
 * 输出: 服务器状态 + CLI 模型选择 + 统计仪表盘
 * 定位: 路由页代理统计子面板
 */

import { useEffect, useState, useRef } from 'react';
import { Play, Square, Copy, KeyRound, Loader2, Activity, BarChart3 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { IOSCard, IOSCardContent } from '../../IOSCard';
import { IOSButton } from '../../IOSButton';
import { IOSInput } from '../../IOSInput';
import type { RouteCliType } from '../../../../shared/types/route-proxy';

const CLI_LABELS: Record<RouteCliType, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  geminiCli: 'Gemini CLI',
};

type TimeRange = '24h' | '7d';
const STATS_TIME_RANGES: TimeRange[] = ['24h', '7d'];

/** 代理服务器状态区 */
function ServerSection() {
  const { config, serverRunning, saveServerConfig, regenerateApiKey, startServer, stopServer } =
    useRouteStore(
      useShallow(s => ({
        config: s.config,
        serverRunning: s.serverRunning,
        saveServerConfig: s.saveServerConfig,
        regenerateApiKey: s.regenerateApiKey,
        startServer: s.startServer,
        stopServer: s.stopServer,
      }))
    );
  const [toggling, setToggling] = useState(false);
  const [showKey, setShowKey] = useState(false);

  if (!config) return null;
  const { server } = config;

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (serverRunning) {
        await stopServer();
        toast.success('代理服务器已停止');
      } else {
        const ok = await startServer();
        if (ok) toast.success(`代理服务器已启动 ${server.host}:${server.port}`);
        else toast.error('启动失败');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setToggling(false);
    }
  };

  return (
    <IOSCard className="mb-4">
      <IOSCardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--ios-blue)]" />
            <span className="font-medium text-sm">代理服务器</span>
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                serverRunning
                  ? 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${serverRunning ? 'bg-green-500' : 'bg-gray-400'}`}
              />
              {serverRunning ? '运行中' : '已停止'}
            </span>
          </div>
          <IOSButton
            variant={serverRunning ? 'secondary' : 'primary'}
            size="sm"
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : serverRunning ? (
              <Square className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span className="ml-1">{serverRunning ? '停止' : '启动'}</span>
          </IOSButton>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">端口</label>
            <IOSInput
              type="number"
              defaultValue={server.port}
              onBlur={e => {
                const port = parseInt(e.target.value, 10);
                if (!isNaN(port) && port > 0 && port < 65536) saveServerConfig({ port });
              }}
              className="w-full"
              size="sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Base URL</label>
            <div className="text-xs font-mono bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5 text-gray-600 dark:text-gray-300">
              http://{server.host}:{server.port}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
            路由 API Key
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-xs font-mono bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5 text-gray-600 dark:text-gray-300 truncate">
              {showKey ? server.unifiedApiKey : '••••••••••••••••'}
            </div>
            <button
              onClick={() => setShowKey(!showKey)}
              className="text-xs text-[var(--ios-blue)] hover:underline"
            >
              {showKey ? '隐藏' : '显示'}
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(server.unifiedApiKey);
                toast.success('已复制');
              }}
              title="复制"
            >
              <Copy className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
            </button>
            <button
              onClick={async () => {
                const k = await regenerateApiKey();
                if (k) toast.success('已重新生成');
              }}
              title="重新生成"
            >
              <KeyRound className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
            </button>
          </div>
        </div>
      </IOSCardContent>
    </IOSCard>
  );
}

/** CLI 模型选择区 */
function CliModelSection() {
  const { config, saveCliModelSelections } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      saveCliModelSelections: s.saveCliModelSelections,
    }))
  );
  if (!config) return null;

  const { cliModelSelections, modelRegistry } = config;
  const canonicalModels = Object.keys(modelRegistry?.entries || {});

  const handleChange = (cli: RouteCliType, value: string) => {
    saveCliModelSelections({ [cli]: value || null });
  };

  return (
    <IOSCard className="mb-4">
      <IOSCardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-[var(--ios-blue)]" />
          <span className="font-medium text-sm">CLI 默认模型</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {(['claudeCode', 'codex', 'geminiCli'] as RouteCliType[]).map(cli => (
            <div key={cli}>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                {CLI_LABELS[cli]}
              </label>
              <select
                value={cliModelSelections?.[cli] || ''}
                onChange={e => handleChange(cli, e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-xs"
              >
                <option value="">未选择</option>
                {canonicalModels.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </IOSCardContent>
    </IOSCard>
  );
}

/** 统计仪表盘（首次加载后缓存） */
function StatsDashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (loadedRef.current[timeRange]) {
      setSummary(loadedRef.current[timeRange]);
      return;
    }
    loadStats();
  }, [timeRange]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.route?.getAnalyticsSummary({ window: timeRange });
      if (res?.success) {
        loadedRef.current[timeRange] = res.data;
        setSummary(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <IOSCard>
      <IOSCardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[var(--ios-blue)]" />
            <span className="font-medium text-sm">数据统计</span>
          </div>
          <div className="flex gap-1">
            {STATS_TIME_RANGES.map(r => (
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
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--ios-blue)]" />
          </div>
        ) : summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="总请求" value={summary.totalRequests} />
            <StatCard
              label="成功率"
              value={`${summary.successRate}%`}
              color={
                summary.successRate >= 80 ? 'green' : summary.successRate >= 50 ? 'yellow' : 'red'
              }
            />
            <StatCard label="Prompt Tokens" value={formatNumber(summary.promptTokens)} />
            <StatCard label="Completion Tokens" value={formatNumber(summary.completionTokens)} />
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-gray-400">暂无统计数据</div>
        )}
      </IOSCardContent>
    </IOSCard>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  const colorClass =
    color === 'green'
      ? 'text-green-600 dark:text-green-400'
      : color === 'red'
        ? 'text-red-500'
        : color === 'yellow'
          ? 'text-yellow-600 dark:text-yellow-400'
          : 'text-gray-800 dark:text-gray-200';

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${colorClass}`}>{value}</div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ProxyStatsTab() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-2">
      <ServerSection />
      <CliModelSection />
      <StatsDashboard />
    </div>
  );
}
