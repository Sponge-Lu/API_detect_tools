/**
 * 站点卡片展开详情组件
 * 包含用户分组、API Keys 列表、模型列表
 */

import { Plus, Copy, Eye, EyeOff, Trash2, Loader2 } from 'lucide-react';
import type { SiteConfig } from '../../../shared/types/site';
import type { DetectionResult } from '../../App';
import { getGroupTextColor, getGroupIcon } from '../../utils/groupStyle';

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

  return (
    <div
      className="border-t border-slate-300/60 dark:border-slate-600/60 bg-slate-100/90 dark:bg-slate-900/80 px-3 py-1.5 space-y-1 cursor-default"
      data-no-drag="true"
    >
      {/* 用户分组 */}
      {Object.keys(userGroups).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap py-0">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">
            用户分组
          </span>
          {Object.entries(userGroups).map(([groupName, groupData]) => (
            <button
              key={groupName}
              onClick={() => onToggleGroupFilter(site.name, groupName)}
              className={`px-1.5 py-0.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                selectedGroup === groupName
                  ? 'bg-primary-600 text-white shadow-lg'
                  : `${getGroupTextColor(groupName)} hover:opacity-70`
              }`}
              title={`${groupData.desc} (倍率: ${groupData.ratio})`}
            >
              {getGroupIcon(groupName)}
              <span className="font-semibold">{groupName}</span>
              <span className="opacity-90">×{groupData.ratio}</span>
            </button>
          ))}
          {selectedGroup && (
            <button
              onClick={() => onToggleGroupFilter(site.name, null)}
              className="px-1.5 py-0.5 rounded text-xs font-medium text-red-400 hover:text-red-300 transition-all"
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
            className="px-1.5 py-0.5 bg-primary-600 hover:bg-primary-700 text-white rounded text-xs flex items-center gap-0.5 shadow-sm"
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
                  className="px-1.5 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-all"
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
                          {getGroupIcon(token.group)}
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
                <input
                  type="text"
                  placeholder={globalModelSearch ? '全局搜索生效中' : '搜索...'}
                  value={modelSearch}
                  onChange={e => onModelSearchChange(site.name, e.target.value)}
                  disabled={!!globalModelSearch}
                  className="px-1.5 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-400 transition-colors w-[100px] disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
            </div>
            {selectedModels.size > 0 && (
              <button
                onClick={onCopySelectedModels}
                className="px-1.5 py-0.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs flex items-center gap-0.5 whitespace-nowrap font-medium shadow-sm"
              >
                <Copy className="w-2.5 h-2.5" />
                复制
              </button>
            )}
          </div>
          <div className="max-h-32 overflow-y-auto p-1 bg-slate-50 dark:bg-slate-900/80 rounded border border-slate-200/50 dark:border-slate-700/50">
            <div className="flex flex-wrap gap-0.5">
              {filteredModels.map((model, idx) => {
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
                    className={`px-1.5 py-0.5 rounded border transition-all flex flex-col items-start gap-0 ${
                      selectedModels.has(model)
                        ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-500 dark:border-primary-400'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-750'
                    }`}
                    title={model}
                  >
                    <div className="flex items-center gap-0.5 w-full">
                      <span className="text-xs font-mono text-slate-900 dark:text-slate-50 truncate flex-1 font-medium">
                        {model}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 text-xs w-full mt-0.5">
                      {enableGroups.length > 0 && (
                        <div className="flex items-center gap-0.5">
                          {enableGroups.map((group: string, gidx: number) => (
                            <span key={gidx} className={getGroupTextColor(group)}>
                              {getGroupIcon(group)}
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
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {siteResult?.error && (
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400">❌ {siteResult.error}</p>
        </div>
      )}
    </div>
  );
}
