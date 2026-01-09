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
 * @updated 2025-01-08 - 使用 IOSSearchInput 替换模型搜索框
 */

import { useState, useMemo } from 'react';
import {
  Plus,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Link,
  Key,
} from 'lucide-react';
import type { SiteConfig } from '../../../shared/types/site';
import type { DetectionResult } from '../../App';
import { getGroupTextColor, getGroupIcon } from '../../utils/groupStyle';
import { IOSSearchInput } from '../IOSInput';

// 每页显示的模型数量
const MODELS_PER_PAGE = 50;

interface SiteCardDetailsProps {
  site: SiteConfig;
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
  onToggleGroupFilter: (siteName: string, groupName: string | null) => void;
  onModelSearchChange: (siteName: string, search: string) => void;
  onToggleTokenVisibility: (key: string) => void;
  onToggleModelSelection: (model: string) => void;
  onCopySelectedModels: () => void;
  onCopyToClipboard: (text: string, label: string) => void;
  onOpenCreateTokenDialog: (site: SiteConfig) => void;
  onDeleteToken: (site: SiteConfig, token: any, index: number) => void;
}

// 工具函数
const getQuotaTypeInfo = (quotaType: number) => {
  if (quotaType === 1) {
    return {
      icon: <span className="text-xs font-bold text-orange-700 dark:text-orange-100">次</span>,
      text: '按次',
      color:
        'bg-orange-500/10 dark:bg-orange-500/30 text-orange-700 dark:text-orange-100 border-orange-500/40',
    };
  }
  return {
    icon: <span className="text-xs font-bold text-blue-700 dark:text-blue-100">量</span>,
    text: '按量',
    color: 'bg-blue-500/10 dark:bg-blue-500/30 text-blue-700 dark:text-blue-100 border-blue-500/40',
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

export function SiteCardDetails({
  site,
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
  onToggleGroupFilter,
  onModelSearchChange,
  onToggleTokenVisibility,
  onToggleModelSelection,
  onCopySelectedModels,
  onCopyToClipboard,
  onOpenCreateTokenDialog,
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

  // Access Token 显示状态
  const [showAccessToken, setShowAccessToken] = useState(false);

  // 脱敏显示 access token
  const maskAccessToken = (token: string | undefined): string => {
    if (!token) return '--';
    if (token.length <= 16) return token.slice(0, 4) + '****' + token.slice(-4);
    return token.slice(0, 8) + '****' + token.slice(-8);
  };

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
      className="border-t border-[var(--ios-separator)] bg-[var(--ios-bg-secondary)]/90 dark:bg-[var(--ios-bg-tertiary)]/90 px-[var(--spacing-md)] py-[var(--spacing-sm)] space-y-[var(--spacing-sm)] cursor-default"
      data-no-drag="true"
    >
      {/* 站点 URL 和 Access Token */}
      <div className="flex items-center gap-4 py-0.5">
        {/* 站点 URL */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Link className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium flex-shrink-0">
            URL:
          </span>
          <span className="text-xs font-mono text-blue-600 dark:text-blue-400 truncate">
            {site.url}
          </span>
          <button
            onClick={() => onCopyToClipboard(site.url, 'URL')}
            className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all flex-shrink-0"
            title="复制 URL"
          >
            <Copy className="w-3 h-3 text-gray-400" />
          </button>
        </div>

        {/* Access Token */}
        {site.system_token && (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Key className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium flex-shrink-0">
              Token:
            </span>
            <span className="text-xs font-mono text-amber-600 dark:text-amber-400 truncate">
              {showAccessToken ? site.system_token : maskAccessToken(site.system_token)}
            </span>
            <button
              onClick={() => setShowAccessToken(!showAccessToken)}
              className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all flex-shrink-0"
              title={showAccessToken ? '隐藏 Token' : '显示 Token'}
            >
              {showAccessToken ? (
                <EyeOff className="w-3 h-3 text-gray-400" />
              ) : (
                <Eye className="w-3 h-3 text-gray-400" />
              )}
            </button>
            <button
              onClick={() => onCopyToClipboard(site.system_token!, 'Access Token')}
              className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all flex-shrink-0"
              title="复制 Access Token"
            >
              <Copy className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        )}
      </div>

      {/* 用户分组 */}
      {Object.keys(userGroups).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap py-0">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">
            用户分组
          </span>
          {Object.entries(userGroups).map(([groupName, groupData], index) => (
            <button
              key={groupName}
              onClick={() => onToggleGroupFilter(site.name, groupName)}
              className={`px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-all flex items-center gap-1 ${
                selectedGroup === groupName
                  ? 'bg-[var(--ios-blue)] text-white shadow-sm'
                  : `${getGroupTextColor(groupName)} hover:opacity-80 bg-[var(--ios-bg-secondary)] dark:bg-[var(--ios-bg-tertiary)] border border-[var(--ios-separator)]`
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
              onClick={() => onToggleGroupFilter(site.name, null)}
              className="px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--ios-red)] hover:bg-[var(--ios-red)]/10 transition-all"
            >
              清除
            </button>
          )}
        </div>
      )}

      {/* 令牌管理 */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1 justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
            令牌管理 ({filteredApiKeys.length}/{apiKeys.length})
            {selectedGroup && <span className="ml-1 text-primary-400">· {selectedGroup}</span>}
          </span>
          <button
            onClick={() => onOpenCreateTokenDialog(site)}
            className="px-2 py-1 bg-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/90 text-white rounded-[var(--radius-sm)] text-xs flex items-center gap-1 shadow-sm transition-all active:scale-95"
            title="创建新的 API Key"
          >
            <Plus className="w-3 h-3" />
            <span>添加令牌</span>
          </button>
        </div>

        {apiKeys.length === 0 ? (
          <div className="px-1 text-[11px] text-slate-400 dark:text-slate-500">
            暂无 API Key，可点击右侧"添加令牌"创建。
          </div>
        ) : (
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {filteredApiKeys.map((token, idx) => {
              const quotaInfo = token.unlimited_quota ? null : getQuotaTypeInfo(token.type || 0);
              const tokenKey = `${site.name}_key_${idx}`;
              const isVisible = showTokens[tokenKey] || false;
              const fullKey = addSkPrefix(token.key);

              return (
                <div
                  key={idx}
                  className="px-1.5 py-0.5 bg-[var(--ios-bg-secondary)] dark:bg-[var(--ios-bg-tertiary)] rounded-[var(--radius-sm)] border border-[var(--ios-separator)] hover:border-[var(--ios-blue)]/50 transition-all"
                >
                  <div className="grid grid-cols-[120px_50px_180px_90px_120px_minmax(280px,1fr)_60px] gap-x-3 items-center text-xs">
                    {/* 名称 */}
                    <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {token.name || `Key #${idx + 1}`}
                    </div>

                    {/* 状态 */}
                    <div
                      className={`font-medium ${token.status === 1 ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      {token.status === 1 ? '✓ 启用' : '✕ 禁用'}
                    </div>

                    {/* 分组 */}
                    <div className="min-w-0">
                      {token.group && token.group.trim() ? (
                        <span
                          className={`font-medium flex items-center gap-1 ${getGroupTextColor(token.group)}`}
                        >
                          {getGroupIcon(token.group, Object.keys(userGroups).indexOf(token.group))}
                          <span>{token.group}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">--</span>
                      )}
                    </div>

                    {/* 标签 */}
                    <div className="text-slate-800 dark:text-slate-100">
                      {token.unlimited_quota ? (
                        <span className="font-medium">限额: ∞</span>
                      ) : quotaInfo ? (
                        <span className="font-medium">限额: {quotaInfo.text}</span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">--</span>
                      )}
                    </div>

                    {/* 已使用 */}
                    <div className="text-slate-600 dark:text-slate-400">
                      {token.used_quota !== undefined ? (
                        <>
                          已使用:{' '}
                          <span className="text-orange-600 dark:text-orange-400 font-semibold">
                            ${(token.used_quota / 500000).toFixed(2)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">已使用: --</span>
                      )}
                    </div>

                    {/* API Key */}
                    <div className="font-mono text-blue-600 dark:text-blue-400 truncate pl-[100px]">
                      {isVisible
                        ? fullKey
                        : fullKey.length > 25
                          ? `${fullKey.slice(0, 12)}...${fullKey.slice(-8)}`
                          : fullKey}
                    </div>

                    {/* 操作 */}
                    <div className="flex items-center gap-0.5 justify-end">
                      <button
                        onClick={() => onToggleTokenVisibility(tokenKey)}
                        className="p-0.5 hover:bg-white/10 rounded transition-all"
                      >
                        {isVisible ? (
                          <EyeOff className="w-3 h-3 text-gray-400" />
                        ) : (
                          <Eye className="w-3 h-3 text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => onCopyToClipboard(fullKey, `API Key: ${token.name}`)}
                        className="p-0.5 hover:bg-white/10 rounded transition-all"
                      >
                        <Copy className="w-3 h-3 text-gray-400" />
                      </button>
                      <button
                        onClick={() => onDeleteToken(site, token, idx)}
                        disabled={
                          deletingTokenKey === `${site.name}_${token.id ?? token.key ?? idx}`
                        }
                        className="p-0.5 hover:bg-red-500/20 rounded transition-all disabled:opacity-60"
                        title="删除该 API Key"
                      >
                        {deletingTokenKey === `${site.name}_${token.id ?? token.key ?? idx}` ? (
                          <Loader2 className="w-3 h-3 text-red-500 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3 text-red-500" />
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
              <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">
                可用模型 ({filteredModels.length}/{allModels.length})
                {selectedModels.size > 0 && (
                  <span className="ml-1 text-primary-400">· 已选{selectedModels.size}</span>
                )}
                {selectedGroup && <span className="ml-1 text-primary-400">· {selectedGroup}</span>}
                {globalModelSearch && (
                  <span className="ml-1 text-primary-500">· 全局: {globalModelSearch}</span>
                )}
              </span>
              <div className="ml-7">
                <IOSSearchInput
                  size="sm"
                  placeholder={globalModelSearch ? '全局搜索生效中' : '搜索...'}
                  value={modelSearch}
                  onChange={e => onModelSearchChange(site.name, e.target.value)}
                  onClear={() => onModelSearchChange(site.name, '')}
                  disabled={!!globalModelSearch}
                  containerClassName="w-[120px]"
                />
              </div>
            </div>
            {selectedModels.size > 0 && (
              <button
                onClick={onCopySelectedModels}
                className="px-2 py-1 bg-[var(--ios-green)] hover:bg-[var(--ios-green)]/90 text-white rounded-[var(--radius-sm)] text-xs flex items-center gap-1 whitespace-nowrap font-medium shadow-sm transition-all active:scale-95"
              >
                <Copy className="w-2.5 h-2.5" />
                复制
              </button>
            )}
          </div>
          <div className="max-h-32 overflow-y-auto p-1 bg-[var(--ios-bg-tertiary)]/50 dark:bg-[var(--ios-bg-primary)]/50 rounded-[var(--radius-sm)] border border-[var(--ios-separator)]">
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
                    className={`px-1.5 py-0.5 rounded-[var(--radius-sm)] border transition-all flex flex-col items-start gap-0 ${
                      selectedModels.has(model)
                        ? 'bg-[var(--ios-blue)]/10 dark:bg-[var(--ios-blue)]/20 border-[var(--ios-blue)] dark:border-[var(--ios-blue)]'
                        : 'bg-[var(--ios-bg-secondary)] dark:bg-[var(--ios-bg-tertiary)] border-[var(--ios-separator)] hover:border-[var(--ios-blue)]/50'
                    }`}
                    title={model}
                  >
                    <div className="flex items-center gap-0.5 w-full">
                      <span className="text-xs font-mono text-[var(--ios-text-primary)] truncate flex-1 font-medium">
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
                              className="text-yellow-700 dark:text-yellow-400 font-semibold"
                              title="单次调用价格"
                            >
                              ${typeof inputPrice === 'number' ? formatPrice(inputPrice) : '0'}/次
                            </span>
                          ) : (
                            <>
                              {inputPrice !== undefined && (
                                <span
                                  className="text-green-700 dark:text-green-400 font-semibold"
                                  title="输入价格(/1M tokens)"
                                >
                                  ↑${formatPrice(inputPrice)}
                                </span>
                              )}
                              {outputPrice !== undefined && (
                                <span
                                  className="text-orange-700 dark:text-orange-400 font-semibold"
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
              <div className="flex justify-center mt-1 pt-1 border-t border-[var(--ios-separator)]">
                <button
                  onClick={() => setShowAllModels(!showAllModels)}
                  className="px-2 py-0.5 text-xs text-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/10 rounded-[var(--radius-sm)] flex items-center gap-0.5 transition-colors"
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
        <div className="px-3 py-2 bg-[var(--ios-red)]/10 border border-[var(--ios-red)]/30 rounded-[var(--radius-sm)]">
          <p className="text-xs text-[var(--ios-red)]">❌ {siteResult.error}</p>
        </div>
      )}
    </div>
  );
}
