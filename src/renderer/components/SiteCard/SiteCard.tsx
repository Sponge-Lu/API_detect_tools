/**
 * @file src/renderer/components/SiteCard/SiteCard.tsx
 * @description 站点卡片主组件
 *
 * 输入: SiteCardProps (站点数据、操作回调, isDetecting), SiteResult (检测结果), 子组件 (Header, Actions, Details)
 * 输出: React 组件, 用户交互事件
 * 定位: 展示层 - 显示站点信息并处理用户交互
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 *
 * @version 2.1.12
 * @updated 2025-01-09 - 添加 React.memo 优化拖拽性能
 */

/**
 * 站点卡片主组件
 * 封装站点的展示和交互逻辑
 * 使用统一卡片原语实现当前产品风格样式
 */

import React, { useMemo } from 'react';
import { SiteCardHeader } from './SiteCardHeader';
import { SiteCardActions } from './SiteCardActions';
import { SiteCardDetails } from './SiteCardDetails';
import { AppCard } from '../AppCard';
import { useDateString } from '../../hooks';
import type { SiteCardProps } from './types';
import { getSiteDailyStats } from '../../utils/siteDailyStats';

/**
 * 站点卡片组件
 * 使用 React.memo 优化性能，避免拖拽时不必要的重渲染
 */
export const SiteCard = React.memo(
  function SiteCard({
    site,
    index,
    siteResult,
    siteAccount,
    isExpanded,
    columnWidths,
    // 多账户
    accountId,
    accountName,
    accountAccessToken,
    accountUserId,
    cardKey: cardKeyProp,
    apiKeys,
    userGroups,
    modelPricing,
    isDetecting,
    checkingIn,
    dragOverIndex,
    refreshMessage,
    // 详情面板状态
    selectedGroup,
    modelSearch,
    globalModelSearch,
    showTokens,
    selectedModels,
    deletingTokenKey,
    // 回调
    autoRefreshEnabled,
    cliCompatibility,
    cliConfig,
    isCliTesting,
    onExpand,
    onDetect,
    onEdit,
    onDelete,
    onCheckIn,
    onOpenSite,
    onOpenExtraLink,
    onCopyToClipboard,
    onToggleAutoRefresh,
    onOpenCliConfig,
    onTestCliCompat,
    onApply,
    onAddAccount,
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
    onClearSelectedModels,
    onOpenCreateTokenDialog,
    onDeleteToken,
  }: SiteCardProps) {
    // 跨天时触发重算，避免长时间运行后时间显示过期
    const dateStr = useDateString();

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
    }, [siteResult?.lastRefresh, siteAccount?.last_sync_time, dateStr]);

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

    const dailyStats = useMemo(
      () => getSiteDailyStats(siteResult, new Date()),
      [siteResult, dateStr]
    );
    const {
      todayUsage,
      todayPromptTokens,
      todayCompletionTokens,
      todayTotalTokens,
      todayRequests,
      rpm,
      tpm,
    } = dailyStats;
    const normalizedSiteResult = useMemo(
      () =>
        siteResult
          ? {
              ...siteResult,
              todayUsage,
              todayPromptTokens,
              todayCompletionTokens,
              todayTotalTokens,
              todayRequests,
            }
          : siteResult,
      [
        siteResult,
        todayUsage,
        todayPromptTokens,
        todayCompletionTokens,
        todayTotalTokens,
        todayRequests,
      ]
    );

    // 模型数量计算
    const modelCount = useMemo(() => {
      const apiModelCount = siteResult?.models?.length || 0;
      const pricingModelCount = modelPricing?.data ? Object.keys(modelPricing.data).length : 0;
      return Math.max(apiModelCount, pricingModelCount);
    }, [siteResult?.models, modelPricing]);

    // 用于 refreshMessage 匹配的 key
    const effectiveCardKey = cardKeyProp || site.name;
    const editAccount =
      accountId && (accountAccessToken || accountUserId || accountName)
        ? {
            id: accountId,
            account_name: accountName,
            access_token: accountAccessToken,
            user_id: accountUserId,
          }
        : null;

    return (
      <AppCard
        variant="standard"
        blur={true}
        hoverable={site.enabled}
        expanded={isExpanded}
        draggable={true}
        isDragOver={dragOverIndex === index}
        disabled={!site.enabled}
        expandContent={
          isExpanded ? (
            <SiteCardDetails
              site={site}
              cardKey={effectiveCardKey}
              siteResult={siteResult}
              accountAccessToken={accountAccessToken}
              accountUserId={accountUserId}
              apiKeys={apiKeys}
              userGroups={userGroups}
              modelPricing={modelPricing}
              selectedGroup={selectedGroup}
              modelSearch={modelSearch}
              globalModelSearch={globalModelSearch}
              showTokens={showTokens}
              selectedModels={selectedModels}
              deletingTokenKey={deletingTokenKey}
              onToggleGroupFilter={onToggleGroupFilter}
              onModelSearchChange={onModelSearchChange}
              onToggleTokenVisibility={onToggleTokenVisibility}
              onToggleModelSelection={onToggleModelSelection}
              onCopySelectedModels={onCopySelectedModels}
              onClearSelectedModels={onClearSelectedModels}
              onCopyToClipboard={onCopyToClipboard}
              onOpenCreateTokenDialog={onOpenCreateTokenDialog}
              onDeleteToken={onDeleteToken}
            />
          ) : undefined
        }
        onDragStart={e => onDragStart(e, index)}
        onDragEnd={onDragEnd}
        onDragOver={e => onDragOver(e, index)}
        onDragLeave={onDragLeave}
        onDrop={e => onDrop(e, index)}
      >
        {/* 刷新提示消息 */}
        {refreshMessage && refreshMessage.site === effectiveCardKey && (
          <div
            className={`mx-[var(--spacing-md)] mt-[var(--spacing-sm)] px-[var(--spacing-md)] py-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-all ${
              refreshMessage.type === 'success'
                ? 'border border-[var(--line-soft)] bg-[var(--success-soft)] text-[var(--success)]'
                : 'border border-[var(--line-soft)] bg-[var(--accent-soft)] text-[var(--accent)]'
            }`}
          >
            {refreshMessage.message}
          </div>
        )}

        <div className="border-b border-[var(--line-soft)] px-4 py-[var(--spacing-sm)]">
          <div data-testid="site-card-main-row" className="flex items-center justify-between gap-3">
            <SiteCardHeader
              site={site}
              siteResult={normalizedSiteResult}
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
              accountId={accountId}
              accountName={accountName}
              onOpenSite={onOpenSite}
              cliCompatibility={cliCompatibility}
              cliConfig={cliConfig}
              isCliTesting={isCliTesting}
              onOpenCliConfig={onOpenCliConfig}
              onTestCliCompat={onTestCliCompat}
              onApply={onApply}
            />

            <SiteCardActions
              site={site}
              index={index}
              siteResult={siteResult}
              isExpanded={isExpanded}
              isDetecting={isDetecting}
              checkingIn={checkingIn}
              autoRefreshEnabled={autoRefreshEnabled}
              editAccount={editAccount}
              checkinStats={siteResult?.checkinStats}
              onExpand={onExpand}
              onDetect={onDetect}
              onEdit={onEdit}
              onDelete={onDelete}
              onCheckIn={onCheckIn}
              onOpenExtraLink={onOpenExtraLink}
              onToggleAutoRefresh={onToggleAutoRefresh}
              onAddAccount={onAddAccount}
            />
          </div>
        </div>
      </AppCard>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数，只有当关键 props 变化时才重新渲染
    // 特别优化：dragOverIndex 只比较是否影响当前卡片
    const prevIsDragOver = prevProps.dragOverIndex === prevProps.index;
    const nextIsDragOver = nextProps.dragOverIndex === nextProps.index;

    // 如果拖拽状态没有影响当前卡片，跳过这个 prop 的比较
    if (prevIsDragOver === nextIsDragOver) {
      // 比较其他关键 props
      return (
        prevProps.site === nextProps.site &&
        prevProps.index === nextProps.index &&
        prevProps.siteResult === nextProps.siteResult &&
        prevProps.isExpanded === nextProps.isExpanded &&
        prevProps.columnWidths === nextProps.columnWidths &&
        prevProps.isDetecting === nextProps.isDetecting &&
        prevProps.checkingIn === nextProps.checkingIn &&
        prevProps.autoRefreshEnabled === nextProps.autoRefreshEnabled &&
        prevProps.isCliTesting === nextProps.isCliTesting &&
        prevProps.refreshMessage === nextProps.refreshMessage &&
        prevProps.selectedGroup === nextProps.selectedGroup &&
        prevProps.modelSearch === nextProps.modelSearch &&
        prevProps.globalModelSearch === nextProps.globalModelSearch &&
        prevProps.showTokens === nextProps.showTokens &&
        prevProps.deletingTokenKey === nextProps.deletingTokenKey &&
        prevProps.selectedModels === nextProps.selectedModels &&
        prevProps.accountId === nextProps.accountId &&
        prevProps.accountName === nextProps.accountName
      );
    }

    // 拖拽状态变化了，需要重新渲染
    return false;
  }
);
