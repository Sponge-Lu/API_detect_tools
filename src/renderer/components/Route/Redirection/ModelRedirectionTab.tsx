/**
 * 模型重定向 Sub-Tab
 * 左侧厂商导航 + 右侧模型列表（canonical → aliases, M站点·N账户）
 */

import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Edit3, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { IOSButton } from '../../IOSButton';
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

const rowCellClass =
  'border-b border-[var(--line-soft)] bg-transparent px-3 py-2 transition-colors hover:bg-[var(--surface-2)]';

// ============= 模型行组件 =============

function ModelMappingRow({ entry }: { entry: RouteModelRegistryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const dedupedSources = useMemo(() => deduplicateSources(entry.sources), [entry.sources]);
  const uniqueSiteCount = new Set(dedupedSources.map(s => s.siteName)).size;
  const totalAccountCount = dedupedSources.length;

  return (
    <>
      {/* 第一栏: canonical 名称 */}
      <div className={`flex min-w-0 items-center gap-1.5 ${rowCellClass}`}>
        <code className="whitespace-nowrap font-mono text-[13px] font-semibold text-[var(--text-primary)]">
          {entry.canonicalName}
        </code>
        {entry.hasOverride && (
          <span className="shrink-0 rounded bg-[var(--warning-soft)] px-1 py-px text-[9px] text-[var(--warning)]">
            自定义
          </span>
        )}
      </div>

      {/* 第二栏: 原始模型名 */}
      <div className={`scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto ${rowCellClass}`}>
        {entry.aliases.map(alias => (
          <span
            key={alias}
            className="inline-block shrink-0 whitespace-nowrap rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
          >
            {alias}
          </span>
        ))}
      </div>

      {/* 第三栏: 来源摘要 + 操作 */}
      <div className={`flex shrink-0 items-center gap-1.5 ${rowCellClass}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]"
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
        <button className="rounded p-0.5 text-[var(--icon-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--accent)]">
          <Edit3 className="w-3 h-3" />
        </button>
      </div>

      {/* 展开态：来源详情（跨三栏） */}
      {expanded && (
        <div className="col-span-3 flex flex-wrap gap-1.5 border-b border-[var(--line-soft)] px-3 pb-2">
          {dedupedSources.map(src => (
            <span
              key={src.key}
              className="inline-flex items-center overflow-hidden rounded border border-[var(--line-soft)] text-[10px]"
            >
              <span className="bg-[var(--accent)] px-1.5 py-0.5 font-medium text-white">
                {src.siteName}
              </span>
              {src.accountName && (
                <span className="bg-[var(--accent-soft)] px-1.5 py-0.5 text-[var(--accent)]">
                  {src.accountName}
                </span>
              )}
              {src.userGroups.map(g => (
                <span
                  key={g}
                  className={`border-l border-[var(--line-soft)] px-1.5 py-0.5 ${
                    src.apiKeyGroups.has(g)
                      ? 'bg-[var(--success-soft)] font-bold text-[var(--success)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
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
    <div className="flex-1 overflow-hidden">
      <div className="flex h-full overflow-hidden px-6 py-3">
        {/* 左侧：厂商导航 */}
        <div className="flex w-[168px] shrink-0 flex-col border-r border-[var(--line-soft)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                厂商目录
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-secondary)]">
                {entries.length} 模型 / {availableVendors.length} 厂商
              </div>
            </div>
            <IOSButton variant="secondary" size="sm" onClick={handleRebuild} disabled={rebuilding}>
              {rebuilding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </IOSButton>
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
                  flex w-full items-center gap-2 border-r-2 border-transparent px-3 py-2 text-left transition-colors
                  ${
                    isActive
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'
                  }
                `}
                >
                  <VendorIcon
                    vendor={vendor}
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--icon-muted)]'}`}
                  />
                  <span className={`text-xs truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                    {getVendorLabel(vendor)}
                  </span>
                  <span
                    className={`ml-auto shrink-0 text-[10px] ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}

            {availableVendors.length === 0 && !rebuilding && (
              <div className="px-3 py-4 text-center text-[11px] text-[var(--text-secondary)]">
                暂无数据
              </div>
            )}
          </div>
        </div>

        {/* 右侧：模型列表（整体共享一个 grid，三栏跨行对齐） */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-[max-content_1fr_auto] items-center">
            {/* 三栏表头 */}
            {activeEntries.length > 0 && (
              <>
                <div className="flex items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-1.5">
                  <VendorIcon
                    vendor={activeVendor}
                    className="w-3.5 h-3.5 text-[var(--icon-muted)]"
                  />
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    重定向名称
                  </span>
                  <span className="text-[10px] text-[var(--text-secondary)]">
                    ({activeEntries.length})
                  </span>
                </div>
                <div className="border-b border-[var(--line-soft)] bg-[var(--surface-2)] py-1.5">
                  <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                    原始名称
                  </span>
                </div>
                <div className="border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-1.5">
                  <span className="pr-4 text-[11px] font-medium text-[var(--text-secondary)]">
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
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
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
    </div>
  );
}
