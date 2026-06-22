/**
 * @file src/renderer/components/SiteCard/SiteCardDetails.tsx
 * @description 站点卡片展开详情组件
 *
 * 输入: SiteCardDetailsProps (站点数据、检测结果、API Keys、用户分组、模型定价)
 * 输出: React 组件 (站点卡片详情 UI)
 * 定位: 展示层 - 站点卡片展开详情组件，包含用户分组、API Keys 列表、模型列表
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 *
 * @version 2.1.11
 * @updated 2026-04-02 - 统一站点详情面板的中性主题 token
 */

import { useState, useMemo } from 'react';
import {
  Plus,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { isApiKeyActive, type SiteConfig } from '../../../shared/types/site';
import type { DetectionResult } from '../../App';
import { getGroupTextColor, getGroupIcon } from '../../utils/groupStyle';
import { AppSearchInput } from '../AppInput';

// 每页显示的模型数量
const MODELS_PER_PAGE = 50;

interface SiteCardDetailsProps {
  site: SiteConfig;
  cardKey: string;
  siteResult?: DetectionResult;
  apiKeys: any[];
  userGroups: Record<string, { desc: string; ratio: number }>;
  modelPricing: any;
  selectedGroup: string | null;
  modelSearch: string;
  globalModelSearch: string;
  showTokens: Record<string, boolean>;
  selectedModels: Set<string>;
  deletingTokenKey: string | null;
  refreshingTokenKey: string | null;
  onToggleGroupFilter: (siteName: string, groupName: string | null) => void;
  onModelSearchChange: (siteName: string, search: string) => void;
  onToggleTokenVisibility: (key: string) => void;
  onToggleModelSelection: (model: string) => void;
  onCopySelectedModels: () => void;
  onClearSelectedModels: () => void;
  onCopyToClipboard: (text: string, label: string) => void;
  onOpenCreateTokenDialog: (site: SiteConfig) => void;
  onRefreshToken: (site: SiteConfig, token: any, index: number) => void;
  onDeleteToken: (site: SiteConfig, token: any, index: number) => void;
}

// 工具函数
const getQuotaTypeInfo = (quotaType: number) => {
  if (quotaType === 1) {
    return {
      icon: <span className="text-xs font-bold text-[var(--warning)]">次</span>,
      text: '按次',
      color: 'border-[var(--line-muted)] bg-[var(--warning-soft)] text-[var(--warning)]',
    };
  }
  return {
    icon: <span className="text-xs font-bold text-[var(--accent)]">量</span>,
    text: '按量',
    color: 'border-[var(--line-muted)] bg-[var(--accent-soft)] text-[var(--accent)]',
  };
};

const formatPrice = (price: number): string => {
  if (price === 0) return '0';
  if (price >= 1) return parseFloat(price.toFixed(2)).toString();
  if (price >= 0.01) return parseFloat(price.toFixed(4)).toString();
  return parseFloat(price.toFixed(6)).toString();
};

const addSkPrefix = (key: string): string => {
  if (!key) return '';
  return key.startsWith('sk-') ? key : `sk-${key}`;
};

const maskApiKey = (key: string): string => {
  if (key.length <= 16) return key;
  return `${key.slice(0, 5)}...${key.slice(-4)}`;
};

const tokenActionButtonClass =
  'flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]';

export function SiteCardDetails({
  site,
  cardKey,
  siteResult,
  apiKeys,
  userGroups,
  modelPricing,
  selectedGroup,
  modelSearch,
  globalModelSearch,
  showTokens,
  selectedModels,
  deletingTokenKey,
  refreshingTokenKey,
  onToggleGroupFilter,
  onModelSearchChange,
  onToggleTokenVisibility,
  onToggleModelSelection,
  onCopySelectedModels,
  onClearSelectedModels,
  onCopyToClipboard,
  onOpenCreateTokenDialog,
  onRefreshToken,
  onDeleteToken,
}: SiteCardDetailsProps) {
  // 筛选 API Keys
  const getFilteredApiKeys = (): any[] => {
    if (!selectedGroup) return apiKeys;
    return apiKeys.filter(key => key.group === selectedGroup);
  };

  // 筛选模型
  const getFilteredModels = (allModels: string[]): string[] => {
    const searchTerm = (globalModelSearch || modelSearch || '').toLowerCase();
    let filtered = allModels;

    if (selectedGroup && modelPricing) {
      filtered = filtered.filter(modelName => {
        const modelData = modelPricing.data?.[modelName] || modelPricing[modelName];
        if (!modelData || !modelData.enable_groups) return false;
        return modelData.enable_groups.includes(selectedGroup);
      });
    } else if (globalModelSearch && modelPricing?.data) {
      // 全局搜索时排除用户无权访问的模型
      const groupKeys =
        Object.keys(userGroups).length > 0 ? new Set(Object.keys(userGroups)) : null;
      filtered = filtered.filter(modelName => {
        const modelData = modelPricing.data?.[modelName] || modelPricing[modelName];
        if (!modelData) return true;
        const eg = modelData.enable_groups;
        if (!eg || eg.length === 0) return false;
        return !groupKeys || eg.some((g: string) => groupKeys.has(g));
      });
    }

    if (searchTerm) {
      filtered = filtered.filter(modelName => modelName.toLowerCase().includes(searchTerm));
    }

    return filtered;
  };

  // 获取模型列表
  let allModels = siteResult?.models || [];
  if (modelPricing?.data && typeof modelPricing.data === 'object') {
    const pricingModels = Object.keys(modelPricing.data);
    if (pricingModels.length > allModels.length) {
      allModels = pricingModels;
    }
  }

  const filteredApiKeys = getFilteredApiKeys();
  const filteredModels = getFilteredModels(allModels);

  // 模型列表分页状态
  const [showAllModels, setShowAllModels] = useState(false);

  // 计算显示的模型列表（有搜索时显示全部匹配结果，否则分页）
  const displayedModels = useMemo(() => {
    const hasSearch = globalModelSearch || modelSearch;
    if (hasSearch || showAllModels) {
      return filteredModels;
    }
    return filteredModels.slice(0, MODELS_PER_PAGE);
  }, [filteredModels, showAllModels, globalModelSearch, modelSearch]);

  const hasMoreModels =
    filteredModels.length > MODELS_PER_PAGE && !globalModelSearch && !modelSearch;

  return (
    <div
      className="cursor-default space-y-[var(--spacing-sm)] border-t border-[var(--line-soft)] bg-[var(--surface-2)]/92 px-[var(--spacing-md)] py-[var(--spacing-sm)]"
      data-no-drag="true"
    >
      {/* 用户分组 */}
      {Object.keys(userGroups).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap py-0">
          <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
            用户分组
          </span>
          {Object.entries(userGroups).map(([groupName, groupData], index) => (
            <button
              key={groupName}
              onClick={() => onToggleGroupFilter(cardKey, groupName)}
              className={`flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-medium transition-colors ${
                selectedGroup === groupName
                  ? 'border-transparent bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                  : `${getGroupTextColor(groupName)} border-[var(--line-soft)] bg-[var(--surface-3)] hover:bg-[var(--surface-1)]`
              }`}
              title={`${groupData.desc} (倍率: ${groupData.ratio})`}
            >
              {getGroupIcon(groupName, index)}
              <span className="font-semibold">{groupName}</span>
              <span className="opacity-90">×{groupData.ratio}</span>
            </button>
          ))}
          {selectedGroup && (
            <button
              onClick={() => onToggleGroupFilter(cardKey, null)}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)]"
            >
              清除
            </button>
          )}
        </div>
      )}

      {/* 令牌管理 */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1 justify-between">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">
            令牌管理 ({filteredApiKeys.length}/{apiKeys.length})
            {selectedGroup && <span className="ml-1 text-[var(--accent)]">· {selectedGroup}</span>}
          </span>
          <button
            onClick={() => onOpenCreateTokenDialog(site)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft-strong)]"
            title="创建新的 API Key"
          >
            <Plus className="h-3 w-3" />
            <span>添加令牌</span>
          </button>
        </div>

        {apiKeys.length === 0 ? (
          <div className="px-1 text-[11px] text-[var(--text-secondary)]/80">
            暂无 API Key，可点击右侧"添加令牌"创建。
          </div>
        ) : (
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {filteredApiKeys.map((token, idx) => {
              const quotaInfo = token.unlimited_quota ? null : getQuotaTypeInfo(token.type || 0);
              const tokenKey = `${cardKey}_key_${idx}`;
              const isVisible = showTokens[tokenKey] || false;
              const fullKey = addSkPrefix(token.key);
              const deletingKeyId = `${cardKey}_${token.id ?? token.key ?? idx}`;
              const refreshingKeyId = `${cardKey}_${token.id ?? token.token_id ?? token.key ?? idx}`;
              const tokenActive = isApiKeyActive(token);

              return (
                <div
                  key={idx}
                  className="rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--line-soft))]"
                >
                  <div
                    className="flex min-w-0 items-center gap-x-2 overflow-hidden text-xs"
                    data-testid="site-api-key-row"
                  >
                    {/* 名称 */}
                    <div className="min-w-0 w-[4rem] shrink-0 truncate font-semibold text-[var(--text-primary)]">
                      {token.name || `Key #${idx + 1}`}
                    </div>

                    {/* 状态 */}
                    <div
                      className={`w-[4rem] shrink-0 whitespace-nowrap font-medium ${tokenActive ? 'text-[var(--success)]' : 'text-[var(--text-secondary)]'}`}
                    >
                      {tokenActive ? '✓ 启用' : '✕ 禁用'}
                    </div>

                    {/* 分组 */}
                    <div className="min-w-0 w-[6rem] shrink-0">
                      {token.group && token.group.trim() ? (
                        <span
                          className={`font-medium flex items-center gap-1 ${getGroupTextColor(token.group)}`}
                        >
                          {getGroupIcon(token.group, Object.keys(userGroups).indexOf(token.group))}
                          <span className="truncate">{token.group}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-secondary)]/80">--</span>
                      )}
                    </div>

                    {/* 标签 */}
                    <div className="w-[4.5rem] shrink-0 whitespace-nowrap text-[var(--text-primary)]">
                      {token.unlimited_quota ? (
                        <span className="font-medium">限额: ∞</span>
                      ) : quotaInfo ? (
                        <span className="font-medium">限额: {quotaInfo.text}</span>
                      ) : (
                        <span className="text-[var(--text-secondary)]/80">--</span>
                      )}
                    </div>

                    {/* 已使用 */}
                    <div className="w-[6.5rem] shrink-0 whitespace-nowrap text-[var(--text-secondary)]">
                      {token.used_quota !== undefined ? (
                        <>
                          已使用:{' '}
                          <span className="font-semibold text-[var(--warning)]">
                            ${(token.used_quota / 500000).toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[var(--text-secondary)]/80">已使用: --</span>
                      )}
                    </div>

                    {/* API Key */}
                    <div className="min-w-0 w-[12ch] shrink truncate font-mono text-[var(--accent-strong)]">
                      {isVisible ? fullKey : maskApiKey(fullKey)}
                    </div>

                    {/* 操作 */}
                    <div className="flex shrink-0 items-center justify-end gap-0.5">
                      <button
                        onClick={() => onToggleTokenVisibility(tokenKey)}
                        className={tokenActionButtonClass}
                      >
                        {isVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => onCopyToClipboard(fullKey, `API Key: ${token.name}`)}
                        className={tokenActionButtonClass}
                        title="复制 API Key"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => onRefreshToken(site, token, idx)}
                        disabled={refreshingTokenKey === refreshingKeyId}
                        className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:opacity-60"
                        title="刷新该 API Key 状态"
                        aria-label={`刷新 API Key: ${token.name || `Key #${idx + 1}`}`}
                      >
                        {refreshingTokenKey === refreshingKeyId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        onClick={() => onDeleteToken(site, token, idx)}
                        disabled={deletingTokenKey === deletingKeyId}
                        className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)] disabled:opacity-60"
                        title="删除该 API Key"
                      >
                        {deletingTokenKey === deletingKeyId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 可用模型列表 */}
      {allModels.length > 0 && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 flex-1">
              <span className="whitespace-nowrap text-xs font-semibold text-[var(--text-secondary)]">
                可用模型 ({filteredModels.length}/{allModels.length})
                {selectedModels.size > 0 && (
                  <span className="ml-1 text-[var(--accent)]">· 已选{selectedModels.size}</span>
                )}
                {selectedGroup && (
                  <span className="ml-1 text-[var(--accent)]">· {selectedGroup}</span>
                )}
                {globalModelSearch && (
                  <span className="ml-1 text-[var(--accent-strong)]">
                    · 全局: {globalModelSearch}
                  </span>
                )}
              </span>
              <div className="ml-7">
                <AppSearchInput
                  size="sm"
                  placeholder={globalModelSearch ? '全局搜索生效中' : '搜索...'}
                  value={modelSearch}
                  onChange={e => onModelSearchChange(cardKey, e.target.value)}
                  onClear={() => onModelSearchChange(cardKey, '')}
                  disabled={!!globalModelSearch}
                  containerClassName="w-[120px]"
                />
              </div>
            </div>
            {selectedModels.size > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={onClearSelectedModels}
                  className="rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)]"
                  title="取消选择所有模型"
                >
                  取消
                </button>
                <button
                  onClick={onCopySelectedModels}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--success-soft)] px-2 py-1 text-xs font-medium whitespace-nowrap text-[var(--success)] transition-colors hover:bg-[color-mix(in_srgb,var(--success)_20%,transparent)]"
                >
                  <Copy className="h-2.5 w-2.5" />
                  复制
                </button>
              </div>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)]/72 p-1">
            <div className="flex flex-wrap gap-0.5">
              {displayedModels.map((model, idx) => {
                const pricingData = modelPricing?.data?.[model] || modelPricing?.[model];
                let quotaType = pricingData?.quota_type;
                if (quotaType === undefined && pricingData?.type) {
                  quotaType = pricingData.type === 'times' ? 1 : 0;
                }
                if (quotaType === undefined || quotaType === null) quotaType = 0;

                const quotaInfo = pricingData ? getQuotaTypeInfo(quotaType) : null;
                const enableGroups = pricingData?.enable_groups || [];
                const completionRatio = pricingData?.completion_ratio || 1;

                // 计算价格
                let inputPrice: number | undefined;
                let outputPrice: number | undefined;
                const groupRatio = userGroups || {};
                const currentGroup = selectedGroup || 'default';
                const groupMultiplier = groupRatio[currentGroup]?.ratio || 1;

                if (pricingData) {
                  if (
                    typeof pricingData.model_price === 'object' &&
                    pricingData.model_price !== null
                  ) {
                    const DONE_HUB_TOKEN_TO_CALL_RATIO = 0.001;
                    if (quotaType === 1) {
                      inputPrice = pricingData.model_price.input * DONE_HUB_TOKEN_TO_CALL_RATIO;
                      outputPrice = pricingData.model_price.output * DONE_HUB_TOKEN_TO_CALL_RATIO;
                    } else {
                      inputPrice = pricingData.model_price.input;
                      outputPrice = pricingData.model_price.output;
                    }
                  } else if (quotaType === 1 && typeof pricingData.model_price === 'number') {
                    inputPrice = pricingData.model_price * groupMultiplier;
                    outputPrice = pricingData.model_price * groupMultiplier;
                  } else {
                    const modelRatio = pricingData.model_ratio || 1;
                    inputPrice = modelRatio * 2 * groupMultiplier;
                    outputPrice = modelRatio * completionRatio * 2 * groupMultiplier;
                  }
                }

                return (
                  <button
                    key={idx}
                    onClick={() => onToggleModelSelection(model)}
                    className={`flex flex-col items-start gap-0 rounded-[var(--radius-sm)] border px-1.5 py-0.5 transition-colors ${
                      selectedModels.has(model)
                        ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--line-soft)] bg-[var(--surface-3)] hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--line-soft))] hover:bg-[var(--surface-1)]'
                    }`}
                    title={model}
                  >
                    <div className="flex items-center gap-0.5 w-full">
                      <span className="flex-1 truncate text-xs font-mono font-medium text-[var(--text-primary)]">
                        {model}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 text-xs w-full mt-0.5">
                      {enableGroups.length > 0 && (
                        <div className="flex items-center gap-0.5">
                          {enableGroups.map((group: string, gidx: number) => (
                            <span key={gidx} className={getGroupTextColor(group)}>
                              {getGroupIcon(group, Object.keys(userGroups).indexOf(group))}
                            </span>
                          ))}
                        </div>
                      )}
                      {quotaInfo && (
                        <span
                          className={`p-0.5 rounded border ${quotaInfo.color}`}
                          title={quotaInfo.text}
                        >
                          {quotaInfo.icon}
                        </span>
                      )}
                      {(inputPrice !== undefined || outputPrice !== undefined) && (
                        <>
                          {quotaType === 1 ? (
                            <span
                              className="font-semibold text-[var(--warning)]"
                              title="单次调用价格"
                            >
                              ${typeof inputPrice === 'number' ? formatPrice(inputPrice) : '0'}/次
                            </span>
                          ) : (
                            <>
                              {inputPrice !== undefined && (
                                <span
                                  className="font-semibold text-[var(--success)]"
                                  title="输入价格(/1M tokens)"
                                >
                                  ↑${formatPrice(inputPrice)}
                                </span>
                              )}
                              {outputPrice !== undefined && (
                                <span
                                  className="font-semibold text-[var(--accent)]"
                                  title={`输出价格(/1M tokens) ×${completionRatio}`}
                                >
                                  ↓${formatPrice(outputPrice)}
                                </span>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {/* 显示更多/收起按钮 */}
            {hasMoreModels && (
              <div className="mt-1 flex justify-center border-t border-[var(--line-soft)] pt-1">
                <button
                  onClick={() => setShowAllModels(!showAllModels)}
                  className="flex items-center gap-0.5 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]"
                >
                  {showAllModels ? (
                    <>
                      <ChevronUp className="w-3 h-3" />
                      收起 (显示前 {MODELS_PER_PAGE} 个)
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3" />
                      显示全部 {filteredModels.length} 个模型
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {siteResult?.error && (
        <div className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] px-3 py-2">
          <p className="text-xs text-[var(--danger)]">❌ {siteResult.error}</p>
        </div>
      )}
    </div>
  );
}
