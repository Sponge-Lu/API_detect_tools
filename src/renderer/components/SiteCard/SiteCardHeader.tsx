/**
 * 输入: SiteCardHeaderProps (站点数据、检测结果、CLI 兼容性)
 * 输出: React 组件 (站点卡片头部 UI)
 * 定位: 展示层 - 站点卡片头部组件，显示站点基本信息（名称、状态、余额、消费等）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { SiteCardHeaderProps } from './types';
import { CliCompatibilityIcons } from '../CliCompatibilityIcons';

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
  cliCompatibility,
  cliConfig,
  isCliTesting,
  onOpenCliConfig,
  onTestCliCompat,
  onApply,
}: SiteCardHeaderProps) {
  return (
    <div
      className="grid gap-x-1 items-center text-[13px]"
      style={{
        gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' '),
      }}
    >
      {/* 1. 站点名称（带状态图标） */}
      <button
        onClick={() => onOpenCheckinPage(site)}
        className="flex items-center gap-1.5 hover:text-primary-400 transition-colors group min-w-0"
        title={`打开 ${site.name}${siteResult ? (siteResult.status === '成功' ? ' (在线)' : ' (离线)') : ' (未检测)'}`}
      >
        {/* 状态图标 */}
        {siteResult ? (
          siteResult.status === '成功' ? (
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          )
        ) : (
          <div className="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0" />
        )}
        <span className="font-bold text-sm md:text-base truncate">{site.name}</span>
        {/* 错误码/超时提示 */}
        {errorCode && (
          <span className="text-red-500 dark:text-red-400 text-[10px] font-semibold flex-shrink-0">
            {errorCode}
          </span>
        )}
        {!errorCode && timeoutSeconds !== null && (
          <span className="text-red-500 dark:text-red-400 text-[10px] font-semibold flex-shrink-0">
            T/O
          </span>
        )}
      </button>

      {/* 2. 余额 */}
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

      {/* 3. 今日消费 */}
      <div className="flex flex-col">
        {siteResult && siteResult.todayUsage !== undefined ? (
          <span
            className={`font-mono font-semibold truncate ${
              siteResult.todayUsage === 0
                ? 'text-orange-300 dark:text-orange-600'
                : 'text-orange-600 dark:text-orange-400'
            }`}
          >
            $-{siteResult.todayUsage.toFixed(2)}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">--</span>
        )}
      </div>

      {/* 4. 总 Token */}
      <div className="flex flex-col items-center justify-center text-[13px]">
        <span
          className={`font-mono font-medium ${
            todayTotalTokens > 0
              ? 'text-slate-700 dark:text-slate-200'
              : 'text-slate-400 dark:text-slate-500'
          }`}
          title={todayTotalTokens.toLocaleString()}
        >
          {formatNumber(todayTotalTokens)}
        </span>
      </div>

      {/* 5. 输入 Token */}
      <div className="flex flex-col items-center justify-center text-[13px]">
        <span
          className={`font-mono font-medium ${
            todayPromptTokens > 0
              ? 'text-slate-700 dark:text-slate-200'
              : 'text-slate-400 dark:text-slate-500'
          }`}
          title={todayPromptTokens.toLocaleString()}
        >
          {formatNumber(todayPromptTokens)}
        </span>
      </div>

      {/* 6. 输出 Token */}
      <div className="flex flex-col items-center justify-center text-[13px]">
        <span
          className={`font-mono font-medium ${
            todayCompletionTokens > 0
              ? 'text-slate-700 dark:text-slate-200'
              : 'text-slate-400 dark:text-slate-500'
          }`}
          title={todayCompletionTokens.toLocaleString()}
        >
          {formatNumber(todayCompletionTokens)}
        </span>
      </div>

      {/* 7. 请求次数 */}
      <div className="flex flex-col items-center justify-center text-[13px]">
        <span
          className={`font-mono font-medium ${
            todayRequests > 0
              ? 'text-slate-700 dark:text-slate-200'
              : 'text-slate-400 dark:text-slate-500'
          }`}
          title={todayRequests.toLocaleString()}
        >
          {formatNumber(todayRequests)}
        </span>
      </div>

      {/* 8. RPM */}
      <div className="flex flex-col items-center justify-center text-[13px]">
        <span
          className={`font-mono font-medium ${
            rpm > 0 ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {rpm.toFixed(2)}
        </span>
      </div>

      {/* 9. TPM */}
      <div className="flex flex-col items-center justify-center text-[13px]">
        <span
          className={`font-mono font-medium ${
            tpm > 0 ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
          }`}
        >
          {formatNumber(Math.round(tpm))}
        </span>
      </div>

      {/* 10. 模型数 */}
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

      {/* 11. 更新时间 */}
      <div className="flex flex-col items-center justify-center text-[13px] text-slate-600 dark:text-slate-300">
        {lastSyncDisplay ? (
          <span className="font-medium">{lastSyncDisplay}</span>
        ) : (
          <span className="text-slate-400 dark:text-slate-500">--</span>
        )}
      </div>

      {/* 12. CLI 兼容性图标 */}
      <div className="flex items-center justify-start">
        <CliCompatibilityIcons
          compatibility={cliCompatibility}
          cliConfig={cliConfig ?? null}
          isLoading={isCliTesting}
          onConfig={onOpenCliConfig}
          onTest={onTestCliCompat}
          onApply={onApply}
        />
      </div>
    </div>
  );
}
