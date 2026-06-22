/**
 * 输入: SiteCardHeaderProps (站点数据、检测结果、CLI 兼容性)
 * 输出: React 组件 (站点列表行头部 UI)
 * 定位: 展示层 - 站点列表行头部组件，显示站点基本信息与关键指标
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { HistoryCell } from '../HistoryCell';
import type { SiteCardHeaderProps } from './types';

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
}

function formatLdcDisplay(siteResult: SiteCardHeaderProps['siteResult']): string {
  if (!siteResult?.ldcPaymentSupported || !siteResult.ldcExchangeRate) {
    return '--';
  }
  return siteResult.ldcExchangeRate;
}

function formatBalanceDisplay(balance: number): string {
  if (balance === -1) {
    return '∞';
  }
  if (balance >= 100_000) {
    return `$${formatNumber(balance)}`;
  }
  return `$${balance.toFixed(2)}`;
}

export function SiteCardHeader({
  site,
  siteResult,
  lastSyncDisplay,
  errorCode,
  timeoutSeconds,
  columnWidths,
  modelCount,
  accessPointType = 'managed',
  accountId,
  accountName,
  onOpenSite,
}: SiteCardHeaderProps) {
  const isCustomCli = accessPointType === 'custom-cli';
  const ldcDisplay = isCustomCli ? '--' : formatLdcDisplay(siteResult);

  return (
    <div
      className="grid items-center gap-x-1 text-[13px] tabular-nums"
      style={{
        gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' '),
      }}
    >
      {/* 列 1: 站点名 */}
      <div className="flex min-w-0 items-center">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            onClick={event => {
              if (isCustomCli) {
                return;
              }
              event.stopPropagation();
              onOpenSite(site, accountId);
            }}
            className={`group flex min-w-0 items-center gap-1.5 transition-colors ${
              isCustomCli ? 'cursor-default' : 'hover:text-[var(--accent)]'
            }`}
            title={
              isCustomCli
                ? `直连配置 ${site.name}`
                : `打开站点 ${site.name}${siteResult ? (siteResult.status === '成功' ? ' (在线)' : ' (离线)') : ' (未检测)'}`
            }
            type="button"
          >
            {siteResult ? (
              siteResult.status === '成功' ? (
                <div className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse flex-shrink-0" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-[var(--danger)] flex-shrink-0" />
              )
            ) : (
              <div className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] flex-shrink-0" />
            )}
            <span className="truncate text-sm font-semibold text-[var(--text-primary)] md:text-base">
              {site.name}
            </span>
          </button>
          {errorCode && (
            <span className="flex-shrink-0 text-[10px] font-semibold text-[var(--danger)]">
              {errorCode}
            </span>
          )}
          {!errorCode && timeoutSeconds !== null && (
            <span className="flex-shrink-0 text-[10px] font-semibold text-[var(--danger)]">
              T/O
            </span>
          )}
        </div>
      </div>

      {/* 列 2: 账户 */}
      <div className="flex min-w-0 items-center text-[13px] text-[var(--text-secondary)]">
        <span className="truncate">{isCustomCli ? '直连配置' : (accountName ?? '--')}</span>
      </div>

      {/* 列 3: 刷新时间 */}
      <div className="flex min-w-0 items-center text-[13px] text-[var(--text-tertiary)]">
        <span className="truncate">{lastSyncDisplay ?? '--'}</span>
      </div>

      {/* 列 4: 余额 */}
      <div className="flex flex-col">
        {!isCustomCli &&
        siteResult &&
        siteResult.balance !== undefined &&
        siteResult.balance !== null ? (
          <span
            className={`truncate font-mono font-semibold ${
              siteResult.balance === -1 ? 'text-[var(--warning)]' : 'text-[var(--success)]'
            }`}
          >
            {formatBalanceDisplay(siteResult.balance)}
          </span>
        ) : (
          <span className="text-[var(--text-tertiary)]">--</span>
        )}
      </div>

      {/* 列 5: 今日消费 */}
      <div className="flex flex-col">
        {!isCustomCli && siteResult && siteResult.todayUsage !== undefined ? (
          <span
            className={`truncate font-mono font-semibold ${
              siteResult.todayUsage === 0 ? 'text-[var(--text-tertiary)]' : 'text-[var(--warning)]'
            }`}
          >
            $-{siteResult.todayUsage.toFixed(2)}
          </span>
        ) : (
          <span className="text-[var(--text-tertiary)]">--</span>
        )}
      </div>

      {/* 列 6: 模型数 */}
      <div className="flex items-center justify-center text-[13px] text-[var(--text-secondary)]">
        <span
          className={`font-medium ${
            modelCount > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
          }`}
        >
          {modelCount}
        </span>
      </div>

      {/* 列 7: LDC */}
      <div className="flex items-center justify-center text-[13px] text-[var(--text-secondary)]">
        <span
          className={`truncate font-mono font-medium ${
            ldcDisplay === '--' ? 'text-[var(--text-tertiary)]' : 'text-[var(--accent)]'
          }`}
          title={ldcDisplay === '--' ? '不支持 LDC' : `LDC 兑换比例: ${ldcDisplay}`}
        >
          {ldcDisplay}
        </span>
      </div>

      {/* 列 8: History（双控件 + 时间桶条形图）*/}
      <div
        className="flex items-center px-2"
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        <HistoryCell siteId={site.id || site.name} accountId={accountId || ''} />
      </div>
    </div>
  );
}
