/**
 * 站点卡片头部组件
 * 显示站点基本信息（名称、状态、余额、消费等）
 */

import type { SiteCardHeaderProps } from './types';

/**
 * 格式化数字为 K/M 单位
 */
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
  onOpenCheckinPage,
}: SiteCardHeaderProps) {
  return (
    <div
      className="grid gap-x-1 items-center text-[13px]"
      style={{
        gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' '),
      }}
    >
      {/* 1. 站点名称 */}
      <button
        onClick={() => onOpenCheckinPage(site)}
        className="flex items-center hover:text-primary-400 transition-colors group min-w-0"
        title={`打开 ${site.name}`}
      >
        <span className="font-bold text-sm md:text-base truncate">{site.name}</span>
      </button>

      {/* 2. 状态 */}
      <div className="flex flex-col items-start gap-0.5">
        <div className="flex items-center gap-1">
          {siteResult ? (
            siteResult.status === '成功' ? (
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="在线" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-red-500" title="离线" />
            )
          ) : (
            <div className="w-2 h-2 rounded-full bg-gray-500" title="未检测" />
          )}
          <span
            className={`${
              siteResult
                ? siteResult.status === '成功'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-red-500 dark:text-red-400'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {siteResult ? (siteResult.status === '成功' ? '在线' : '离线') : '未检测'}
          </span>
        </div>
        {errorCode && (
          <span className="text-red-500 dark:text-red-400 text-xs font-semibold">
            Err {errorCode}
          </span>
        )}
        {!errorCode && timeoutSeconds !== null && (
          <span className="text-red-500 dark:text-red-400 text-xs font-semibold">
            Timeout {timeoutSeconds}s
          </span>
        )}
      </div>

      {/* 3. 余额 */}
      <div className="flex flex-col">
        {siteResult && siteResult.balance !== undefined && siteResult.balance !== null ? (
          siteResult.balance === -1 ? (
            <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">∞</span>
          ) : (
            <span className="font-mono font-semibold text-green-600 dark:text-green-400 truncate">
              ${siteResult.balance.toFixed(2)}
            </span>
          )
        ) : (
          <span className="text-slate-400 dark:text-slate-500">--</span>
        )}
      </div>

      {/* 4. 今日消费 */}
      <div className="flex flex-col">
        {siteResult && siteResult.todayUsage !== undefined ? (
          <span className="font-mono font-semibold text-orange-600 dark:text-orange-400 truncate">
            $-{siteResult.todayUsage.toFixed(2)}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">--</span>
        )}
      </div>

      {/* 5. 总 Token */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span className="font-mono font-medium" title={todayTotalTokens.toLocaleString()}>
          {formatNumber(todayTotalTokens)}
        </span>
      </div>

      {/* 6. 输入 Token */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span className="font-mono font-medium" title={todayPromptTokens.toLocaleString()}>
          {formatNumber(todayPromptTokens)}
        </span>
      </div>

      {/* 7. 输出 Token */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span className="font-mono font-medium" title={todayCompletionTokens.toLocaleString()}>
          {formatNumber(todayCompletionTokens)}
        </span>
      </div>

      {/* 8. 请求次数 */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span className="font-mono font-medium" title={todayRequests.toLocaleString()}>
          {formatNumber(todayRequests)}
        </span>
      </div>

      {/* 9. RPM */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span className="font-mono font-medium">{rpm.toFixed(2)}</span>
      </div>

      {/* 10. TPM */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span className="font-mono font-medium">{formatNumber(Math.round(tpm))}</span>
      </div>

      {/* 11. 模型数 */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        <span
          className={`font-medium ${
            modelCount > 0
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {modelCount}
        </span>
      </div>

      {/* 12. 更新时间 */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        {lastSyncDisplay ? (
          <span className="font-medium">{lastSyncDisplay}</span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">--</span>
        )}
      </div>
    </div>
  );
}
