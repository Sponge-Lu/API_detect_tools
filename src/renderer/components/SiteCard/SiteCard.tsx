/**
 * @file src/renderer/components/SiteCard/SiteCard.tsx
 * @description 站点列表行主组件
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
 * 站点列表行主组件
 * 封装站点的展示和交互逻辑
 * 使用连续表格行样式承载当前站点管理列表
 */

import React, { useMemo } from 'react';
import { SiteCardHeader } from './SiteCardHeader';
import { SiteCardActions } from './SiteCardActions';
import { useDateString } from '../../hooks';
import type { SiteCardProps } from './types';
import { getSiteDailyStats } from '../../utils/siteDailyStats';

/**
 * 站点列表行组件
 * 使用 React.memo 优化性能，避免拖拽时不必要的重渲染
 */
export const SiteCard = React.memo(
  function SiteCard({
    site,
    index,
    siteResult,
    siteAccount,
    columnWidths,
    accessPointType = 'managed',
    draggable = true,
    accountId,
    accountName,
    cardKey: cardKeyProp,
    modelPricing,
    isDetecting,
    checkingIn,
    dragOverIndex,
    refreshMessage,
    cliCompatibility,
    cliConfig,
    isCliTesting,
    onDetect,
    onCheckIn,
    onOpenSite,
    onOpenExtraLink,
    onOpenCliConfig,
    onTestCliCompat,
    onApply,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
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
      const uniqueApiModelCount = new Set(siteResult?.models ?? []).size;
      const pricingModelCount = modelPricing?.data ? Object.keys(modelPricing.data).length : 0;
      return Math.max(uniqueApiModelCount, pricingModelCount);
    }, [siteResult?.models, modelPricing]);

    // 用于 refreshMessage 匹配的 key
    const effectiveCardKey = cardKeyProp || site.name;

    return (
      <div
        data-testid="site-card-row"
        draggable={draggable}
        className={`border-b border-[var(--line-muted)] bg-[var(--surface-1)] transition-colors ${
          site.enabled ? 'hover:bg-[var(--surface-2)]' : 'opacity-60'
        } ${dragOverIndex === index ? 'bg-[var(--accent-soft)]' : ''}`.trim()}
        onDragStart={draggable ? e => onDragStart(e, index) : undefined}
        onDragEnd={onDragEnd}
        onDragOver={draggable ? e => onDragOver(e, index) : undefined}
        onDragLeave={onDragLeave}
        onDrop={draggable ? e => onDrop(e, index) : undefined}
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

        <div className="px-3 py-2">
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
              accessPointType={accessPointType}
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
              cardKey={effectiveCardKey}
              accessPointType={accessPointType}
              accountId={accountId}
              siteResult={siteResult}
              isDetecting={isDetecting}
              checkingIn={checkingIn}
              checkinStats={siteResult?.checkinStats}
              onDetect={onDetect}
              onCheckIn={onCheckIn}
              onOpenExtraLink={onOpenExtraLink}
            />
          </div>
        </div>
      </div>
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
        prevProps.columnWidths === nextProps.columnWidths &&
        prevProps.isDetecting === nextProps.isDetecting &&
        prevProps.checkingIn === nextProps.checkingIn &&
        prevProps.isCliTesting === nextProps.isCliTesting &&
        prevProps.cliCompatibility === nextProps.cliCompatibility &&
        prevProps.cliConfig === nextProps.cliConfig &&
        prevProps.refreshMessage === nextProps.refreshMessage &&
        prevProps.accessPointType === nextProps.accessPointType &&
        prevProps.draggable === nextProps.draggable &&
        prevProps.accountId === nextProps.accountId &&
        prevProps.accountName === nextProps.accountName
      );
    }

    // 拖拽状态变化了，需要重新渲染
    return false;
  }
);
