/**
 * 站点卡片主组件
 * 封装站点的展示和交互逻辑
 */

import { useMemo } from 'react';
import { SiteCardHeader } from './SiteCardHeader';
import { SiteCardActions } from './SiteCardActions';
import { SiteCardDetails } from './SiteCardDetails';
import type { SiteCardProps } from './types';

export function SiteCard({
  site,
  index,
  siteResult,
  siteAccount,
  isExpanded,
  columnWidths,
  apiKeys,
  userGroups,
  modelPricing,
  detectingSite,
  checkingIn,
  dragOverIndex,
  refreshMessage,
  // 详情面板状态
  selectedGroup,
  modelSearch,
  showTokens,
  selectedModels,
  deletingTokenKey,
  // 回调
  onExpand,
  onDetect,
  onToggle,
  onEdit,
  onDelete,
  onCheckIn,
  onOpenCheckinPage,
  onOpenExtraLink,
  onCopyToClipboard,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  // 详情面板回调
  onToggleGroupFilter,
  onModelSearchChange,
  onToggleTokenVisibility,
  onToggleModelSelection,
  onCopySelectedModels,
  onOpenCreateTokenDialog,
  onDeleteToken,
}: SiteCardProps) {
  // 计算最后更新时间显示
  const lastSyncDisplay = useMemo(() => {
    // 优先使用 siteResult 的数据，其次使用 siteAccount
    const lastSyncTime = siteResult?.lastRefresh || siteAccount?.last_sync_time;
    if (!lastSyncTime) return null;

    const dt = new Date(lastSyncTime);
    const now = new Date();

    // 今天
    if (dt.toDateString() === now.toDateString()) {
      const hour = String(dt.getHours()).padStart(2, '0');
      const minute = String(dt.getMinutes()).padStart(2, '0');
      return `${hour}:${minute}`;
    }

    const diffMs = now.getTime() - dt.getTime();
    const diffDays = Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 1);

    // 非当天时间：x天前，超过7天全部显示7天前
    return diffDays >= 7 ? '7天前' : `${diffDays}天前`;
  }, [siteResult?.lastRefresh, siteAccount?.last_sync_time]);

  // 从错误信息中提取 Error Code
  const errorCode = useMemo(() => {
    if (!siteResult?.error) return null;
    const codeMatch = siteResult.error.match(/status code (\d{3})/i);
    return codeMatch ? codeMatch[1] : null;
  }, [siteResult?.error]);

  // 从错误信息中提取超时秒数
  const timeoutSeconds = useMemo(() => {
    if (!siteResult?.error) return null;
    const timeoutMatch = siteResult.error.match(/timeout.*?(\d+)\s*ms/i);
    if (timeoutMatch) {
      const ms = parseInt(timeoutMatch[1], 10);
      if (!isNaN(ms) && ms > 0) {
        return Math.round(ms / 1000);
      }
    }
    return null;
  }, [siteResult?.error]);

  // Token 指标计算
  const todayPromptTokens = siteResult?.todayPromptTokens ?? 0;
  const todayCompletionTokens = siteResult?.todayCompletionTokens ?? 0;
  const todayTotalTokens =
    siteResult?.todayTotalTokens ?? todayPromptTokens + todayCompletionTokens;
  const todayRequests = siteResult?.todayRequests ?? 0;

  // RPM / TPM 计算
  const { rpm, tpm } = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const minutesSinceStart = Math.max((now.getTime() - dayStart.getTime()) / 60000, 1);

    return {
      rpm: todayRequests > 0 ? todayRequests / minutesSinceStart : 0,
      tpm: todayTotalTokens > 0 ? todayTotalTokens / minutesSinceStart : 0,
    };
  }, [todayRequests, todayTotalTokens]);

  // 模型数量计算
  const modelCount = useMemo(() => {
    const apiModelCount = siteResult?.models?.length || 0;
    const pricingModelCount = modelPricing?.data ? Object.keys(modelPricing.data).length : 0;
    return Math.max(apiModelCount, pricingModelCount);
  }, [siteResult?.models, modelPricing]);

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragEnd={onDragEnd}
      onDragOver={e => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, index)}
      className={`bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm rounded-xl border transition-all cursor-move ${
        site.enabled
          ? 'border-primary-200/30 dark:border-primary-700/40 hover:border-primary-300/50 dark:hover:border-primary-600/60 shadow-md hover:shadow-lg dark:shadow-slate-900/50 dark:hover:shadow-slate-900/70'
          : 'border-slate-200/40 dark:border-slate-600/40 opacity-60 shadow-sm dark:shadow-slate-900/30'
      } ${
        dragOverIndex === index
          ? 'border-primary-500/60 border-2 scale-[1.02] shadow-xl dark:shadow-primary-900/50'
          : ''
      }`}
    >
      {/* 刷新提示消息 */}
      {refreshMessage && refreshMessage.site === site.name && (
        <div
          className={`mx-3 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            refreshMessage.type === 'success'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30'
              : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30'
          }`}
        >
          {refreshMessage.message}
        </div>
      )}

      {/* 一级信息 */}
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between">
          {/* 左侧：信息栅格 */}
          <SiteCardHeader
            site={site}
            siteResult={siteResult}
            lastSyncDisplay={lastSyncDisplay}
            errorCode={errorCode}
            timeoutSeconds={timeoutSeconds}
            columnWidths={columnWidths}
            todayTotalTokens={todayTotalTokens}
            todayPromptTokens={todayPromptTokens}
            todayCompletionTokens={todayCompletionTokens}
            todayRequests={todayRequests}
            rpm={rpm}
            tpm={tpm}
            modelCount={modelCount}
            onOpenCheckinPage={onOpenCheckinPage}
          />

          {/* 右侧：操作按钮 */}
          <SiteCardActions
            site={site}
            index={index}
            siteResult={siteResult}
            isExpanded={isExpanded}
            detectingSite={detectingSite}
            checkingIn={checkingIn}
            onExpand={onExpand}
            onDetect={onDetect}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onCheckIn={onCheckIn}
            onOpenExtraLink={onOpenExtraLink}
            onCopyToClipboard={onCopyToClipboard}
          />
        </div>
      </div>

      {/* 二级展开面板 */}
      {isExpanded && (
        <SiteCardDetails
          site={site}
          siteResult={siteResult}
          apiKeys={apiKeys}
          userGroups={userGroups}
          modelPricing={modelPricing}
          selectedGroup={selectedGroup}
          modelSearch={modelSearch}
          showTokens={showTokens}
          selectedModels={selectedModels}
          deletingTokenKey={deletingTokenKey}
          onToggleGroupFilter={onToggleGroupFilter}
          onModelSearchChange={onModelSearchChange}
          onToggleTokenVisibility={onToggleTokenVisibility}
          onToggleModelSelection={onToggleModelSelection}
          onCopySelectedModels={onCopySelectedModels}
          onCopyToClipboard={onCopyToClipboard}
          onOpenCreateTokenDialog={onOpenCreateTokenDialog}
          onDeleteToken={onDeleteToken}
        />
      )}
    </div>
  );
}
