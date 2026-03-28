/**
 * 模型重定向 Sub-Tab
 * 左侧厂商导航 + 右侧模型列表（canonical → aliases, M站点·N账户）
 */

import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Edit3, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { VendorIcon, getVendorLabel } from '../../../assets/vendor-icons';
import type {
  RouteModelVendor,
  RouteModelRegistryEntry,
  RouteModelSourceRef,
} from '../../../../shared/types/route-proxy';

// ============= 工具函数 =============

function deduplicateSources(sources: RouteModelSourceRef[]): Array<{
  key: string;
  siteName: string;
  accountName?: string;
  userGroups: string[];
  apiKeyGroups: Set<string>;
}> {
  const map = new Map<
    string,
    {
      siteName: string;
      accountName?: string;
      userGroups: Set<string>;
      apiKeyGroups: Set<string>;
    }
  >();
  for (const src of sources) {
    const key = `${src.siteId}:${src.accountId || ''}`;
    if (!map.has(key)) {
      map.set(key, {
        siteName: src.siteName || src.siteId.slice(0, 12),
        accountName: src.accountName,
        userGroups: new Set(src.userGroupKeys || []),
        apiKeyGroups: new Set(src.apiKeyGroups || []),
      });
    } else {
      const existing = map.get(key)!;
      for (const g of src.userGroupKeys || []) existing.userGroups.add(g);
      for (const g of src.apiKeyGroups || []) existing.apiKeyGroups.add(g);
    }
  }
  return Array.from(map.entries()).map(([key, val]) => ({
    key,
    siteName: val.siteName,
    accountName: val.accountName,
    userGroups: Array.from(val.userGroups),
    apiKeyGroups: val.apiKeyGroups,
  }));
}

function groupByVendor(
  entries: RouteModelRegistryEntry[]
): Record<string, RouteModelRegistryEntry[]> {
  const groups: Record<string, RouteModelRegistryEntry[]> = {};
  for (const e of entries) {
    if (!groups[e.vendor]) groups[e.vendor] = [];
    groups[e.vendor].push(e);
  }
  return groups;
}

const VENDOR_ORDER: RouteModelVendor[] = [
  'claude',
  'gpt',
  'gemini',
  'grok',
  'deepseek',
  'qwen',
  'glm',
  'minimax',
  'mistral',
  'llama',
  'unknown',
];

// ============= 模型行组件 =============

function ModelMappingRow({ entry }: { entry: RouteModelRegistryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const dedupedSources = useMemo(() => deduplicateSources(entry.sources), [entry.sources]);
  const uniqueSiteCount = new Set(dedupedSources.map(s => s.siteName)).size;
  const totalAccountCount = dedupedSources.length;

  return (
    <>
      {/* 第一栏: canonical 名称 */}
      <div className="flex items-center gap-1.5 min-w-0 px-3 py-2 border-b border-gray-100 dark:border-gray-800/50 group-hover:bg-gray-50/50 dark:group-hover:bg-gray-800/30">
        <code className="text-[13px] font-mono font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">
          {entry.canonicalName}
        </code>
        {entry.hasOverride && (
          <span className="text-[9px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1 py-px rounded shrink-0">
            自定义
          </span>
        )}
      </div>

      {/* 第二栏: 原始模型名 */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide min-w-0 py-2 border-b border-gray-100 dark:border-gray-800/50 group-hover:bg-gray-50/50 dark:group-hover:bg-gray-800/30">
        {entry.aliases.map(alias => (
          <span
            key={alias}
            className="inline-block text-[11px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0"
          >
            {alias}
          </span>
        ))}
      </div>

      {/* 第三栏: 来源摘要 + 操作 */}
      <div className="flex items-center gap-1.5 shrink-0 px-3 py-2 border-b border-gray-100 dark:border-gray-800/50 group-hover:bg-gray-50/50 dark:group-hover:bg-gray-800/30">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <span className="whitespace-nowrap">
            {uniqueSiteCount} 站点
            {totalAccountCount > uniqueSiteCount ? ` · ${totalAccountCount} 账户` : ''}
          </span>
          {expanded ? (
            <ChevronUp className="w-2.5 h-2.5" />
          ) : (
            <ChevronDown className="w-2.5 h-2.5" />
          )}
        </button>
        <button className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-opacity">
          <Edit3 className="w-3 h-3 text-gray-400" />
        </button>
      </div>

      {/* 展开态：来源详情（跨三栏） */}
      {expanded && (
        <div className="col-span-3 flex flex-wrap gap-1.5 px-3 pb-2 border-b border-gray-100 dark:border-gray-800/50">
          {dedupedSources.map(src => (
            <span
              key={src.key}
              className="inline-flex items-center text-[10px] rounded overflow-hidden border border-gray-200 dark:border-gray-700"
            >
              <span className="px-1.5 py-0.5 bg-blue-500 dark:bg-blue-600 text-white font-medium">
                {src.siteName}
              </span>
              {src.accountName && (
                <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                  {src.accountName}
                </span>
              )}
              {src.userGroups.map(g => (
                <span
                  key={g}
                  className={`px-1.5 py-0.5 border-l border-gray-200 dark:border-gray-700 ${
                    src.apiKeyGroups.has(g)
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-bold'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {g}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ============= 主组件 =============

export function ModelRedirectionTab() {
  const { config, rebuildModelRegistry } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      rebuildModelRegistry: s.rebuildModelRegistry,
    }))
  );
  const [rebuilding, setRebuilding] = useState(false);
  const [activeVendor, setActiveVendor] = useState<RouteModelVendor>('claude');

  const registry = config?.modelRegistry;
  const entries = useMemo(() => (registry ? Object.values(registry.entries) : []), [registry]);
  const grouped = useMemo(() => groupByVendor(entries), [entries]);

  // 有数据的厂商列表
  const availableVendors = useMemo(() => VENDOR_ORDER.filter(v => grouped[v]?.length), [grouped]);

  // 首次加载选中第一个有数据的厂商
  useEffect(() => {
    if (availableVendors.length > 0 && !availableVendors.includes(activeVendor)) {
      setActiveVendor(availableVendors[0]);
    }
  }, [availableVendors]);

  useEffect(() => {
    if (!registry || Object.keys(registry.entries).length === 0) {
      handleRebuild();
    }
  }, []);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await rebuildModelRegistry(true);
      toast.success('模型注册表已重建');
    } catch (e: any) {
      toast.error(`重建失败: ${e.message}`);
    } finally {
      setRebuilding(false);
    }
  };

  const activeEntries = grouped[activeVendor] || [];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左侧：厂商导航 */}
      <div className="w-[140px] shrink-0 border-r border-gray-200 dark:border-gray-700/50 flex flex-col">
        {/* 头部统计 + 重建 */}
        <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400">{entries.length} 模型</span>
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
              title="重建注册表"
            >
              {rebuilding ? (
                <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
              ) : (
                <RefreshCw className="w-3 h-3 text-gray-400 hover:text-blue-500" />
              )}
            </button>
          </div>
        </div>

        {/* 厂商列表 */}
        <div className="flex-1 overflow-y-auto py-1">
          {availableVendors.map(vendor => {
            const count = grouped[vendor]?.length || 0;
            const isActive = activeVendor === vendor;
            return (
              <button
                key={vendor}
                onClick={() => setActiveVendor(vendor)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-left transition-colors
                  ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-r-2 border-blue-500'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }
                `}
              >
                <VendorIcon
                  vendor={vendor}
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}
                />
                <span className={`text-xs truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                  {getVendorLabel(vendor)}
                </span>
                <span
                  className={`text-[10px] ml-auto shrink-0 ${isActive ? 'text-blue-400' : 'text-gray-400'}`}
                >
                  {count}
                </span>
              </button>
            );
          })}

          {availableVendors.length === 0 && !rebuilding && (
            <div className="px-3 py-4 text-[11px] text-gray-400 text-center">暂无数据</div>
          )}
        </div>
      </div>

      {/* 右侧：模型列表（整体共享一个 grid，三栏跨行对齐） */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[max-content_1fr_auto] items-center">
          {/* 三栏表头 */}
          {activeEntries.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 sticky top-0 z-10">
                <VendorIcon
                  vendor={activeVendor}
                  className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500"
                />
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  重定向名称
                </span>
                <span className="text-[10px] text-gray-400">({activeEntries.length})</span>
              </div>
              <div className="py-1.5 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 sticky top-0 z-10">
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  原始名称
                </span>
              </div>
              <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/30 sticky top-0 z-10">
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 pr-4">
                  来源
                </span>
              </div>
            </>
          )}

          {/* 模型行 */}
          {activeEntries.map(entry => (
            <ModelMappingRow key={entry.canonicalName} entry={entry} />
          ))}
        </div>

        {activeEntries.length === 0 && (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {rebuilding ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>重建中...</span>
              </div>
            ) : (
              <span>请先检测站点后点击左上角重建</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
