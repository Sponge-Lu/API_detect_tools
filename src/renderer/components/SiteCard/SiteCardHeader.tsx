/**
 * 输入: SiteCardHeaderProps (站点数据、检测结果、CLI 兼容性)
 * 输出: React 组件 (站点卡片头部 UI)
 * 定位: 展示层 - 站点卡片头部组件，显示站点基本信息与关键指标
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { CliCompatibilityIcons } from '../CliCompatibilityIcons';
import { LDC_UI_VISIBILITY } from '../../../shared/constants';
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

export function SiteCardHeader({
  site,
  siteResult,
  lastSyncDisplay,
  errorCode,
  timeoutSeconds,
  columnWidths,
  todayTotalTokens,
  todayPromptTokens,
  todayCompletionTokens,
  todayRequests,
  rpm,
  tpm,
  modelCount,
  accountId,
  accountName,
  onOpenSite,
  cliCompatibility,
  cliConfig,
  isCliTesting,
  onOpenCliConfig,
  onTestCliCompat,
  onApply,
}: SiteCardHeaderProps) {
  const visibleColumnWidths =
    !LDC_UI_VISIBILITY.showRatioColumn && columnWidths.length > 12
      ? columnWidths.slice(0, -1)
      : columnWidths;

  return (
    <div
      className="grid items-center gap-x-1 text-[13px] tabular-nums"
      style={{
        gridTemplateColumns: visibleColumnWidths.map(w => `${w}px`).join(' '),
      }}
    >
      <div className="flex min-w-0 items-center">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              onClick={() => onOpenSite(site, accountId)}
              className="group flex min-w-0 items-center gap-1.5 transition-colors hover:text-[var(--accent)]"
              title={`打开站点 ${site.name}${siteResult ? (siteResult.status === '成功' ? ' (在线)' : ' (离线)') : ' (未检测)'}`}
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
          {accountName && (
            <span className="truncate pl-[14px] text-[10px] text-[var(--text-tertiary)]">
              {accountName}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col">
        {siteResult && siteResult.balance !== undefined && siteResult.balance !== null ? (
          siteResult.balance === -1 ? (
            <span className="font-mono font-semibold text-[var(--warning)]">∞</span>
          ) : (
            <span className="truncate font-mono font-semibold text-[var(--success)]">
              ${siteResult.balance.toFixed(2)}
            </span>
          )
        ) : (
          <span className="text-[var(--text-tertiary)]">--</span>
        )}
      </div>

      <div className="flex flex-col">
        {siteResult && siteResult.todayUsage !== undefined ? (
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

      <div className="flex flex-col items-center justify-center leading-tight">
        <span
          className={`font-mono font-medium ${
            todayTotalTokens > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
          }`}
          title={todayTotalTokens.toLocaleString()}
        >
          {formatNumber(todayTotalTokens)}
        </span>
        <span className="mt-1 text-[10px] text-[var(--text-tertiary)]">
          输入 {formatNumber(todayPromptTokens)} / 输出 {formatNumber(todayCompletionTokens)}
        </span>
      </div>

      <div className="flex flex-col items-center justify-center leading-tight">
        <span
          className={`font-mono font-medium ${
            todayRequests > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
          }`}
          title={todayRequests.toLocaleString()}
        >
          {formatNumber(todayRequests)}
        </span>
        <span className="mt-1 text-[10px] text-[var(--text-tertiary)]">
          RPM {rpm.toFixed(2)} / TPM {formatNumber(Math.round(tpm))}
        </span>
      </div>

      <div className="flex items-center justify-center text-[13px] text-[var(--text-secondary)]">
        <span
          className={`font-medium ${
            modelCount > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
          }`}
        >
          {modelCount}
        </span>
      </div>

      <div className="flex items-center justify-center text-[13px] text-[var(--text-secondary)]">
        {lastSyncDisplay ? (
          <span className="font-medium">{lastSyncDisplay}</span>
        ) : (
          <span className="text-[var(--text-tertiary)]">--</span>
        )}
      </div>

      <div className="flex items-center justify-start gap-1">
        <CliCompatibilityIcons
          compatibility={cliCompatibility}
          cliConfig={cliConfig ?? null}
          isLoading={isCliTesting}
          onConfig={onOpenCliConfig}
          onTest={onTestCliCompat}
          onApply={onApply}
        />
      </div>

      {LDC_UI_VISIBILITY.showRatioColumn && (
        <div className="flex items-center justify-center text-[13px]">
          {siteResult?.ldcPaymentSupported && siteResult?.ldcExchangeRate ? (
            <span
              className="cursor-help font-mono font-medium text-[var(--warning)]"
              title={`支持 LDC 支付，比例: ${siteResult.ldcExchangeRate}:1`}
            >
              {siteResult.ldcExchangeRate}
            </span>
          ) : (
            <span className="text-[var(--text-tertiary)]">-</span>
          )}
        </div>
      )}
    </div>
  );
}
