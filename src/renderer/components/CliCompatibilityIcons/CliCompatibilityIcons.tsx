/**
 * CLI 兼容性图标组件
 * 显示各 CLI 工具的兼容性状态
 */

import type { CliCompatibilityResult } from '../../store/detectionStore';
import type { CliConfig } from '../../../shared/types/cli-config';
import { DEFAULT_CLI_CONFIG } from '../../../shared/types/cli-config';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface CliCompatibilityIconsProps {
  /** CLI 兼容性结果 */
  compatibility: CliCompatibilityResult | undefined;
  /** CLI 配置 */
  cliConfig: CliConfig | null;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 配置按钮点击回调 */
  onConfig?: () => void;
  /** 测试按钮点击回调 */
  onTest?: () => void;
  /** 应用配置按钮点击回调 */
  onApply?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

/** CLI 类型配置 */
interface CliTypeConfig {
  key: keyof Pick<CliCompatibilityResult, 'claudeCode' | 'codex' | 'geminiCli'>;
  configKey: keyof CliConfig;
  name: string;
  icon: string;
  sizeClass: string; // 图标尺寸类名
}

const CLI_TYPES: CliTypeConfig[] = [
  {
    key: 'claudeCode',
    configKey: 'claudeCode',
    name: 'Claude Code',
    icon: ClaudeCodeIcon,
    sizeClass: 'w-[18px] h-[18px]',
  },
  { key: 'codex', configKey: 'codex', name: 'Codex', icon: CodexIcon, sizeClass: 'w-5 h-5' },
  {
    key: 'geminiCli',
    configKey: 'geminiCli',
    name: 'Gemini CLI',
    icon: GeminiIcon,
    sizeClass: 'w-5 h-5',
  },
];

/**
 * 获取图标样式类名
 * @param status - 兼容性状态: true=支持, false=不支持, null/undefined=未测试
 * @param isConfigured - 是否已配置（有 API Key 和 Model）
 */
export function getIconStyleClass(
  status: boolean | null | undefined,
  isConfigured: boolean
): string {
  // 根据测试结果显示
  if (status === true) {
    return 'opacity-100'; // 全彩色 - 测试通过，支持
  }
  if (status === false) {
    return 'opacity-70 grayscale brightness-75'; // 深灰色 - 测试失败，不支持
  }
  // status === null 或 undefined 表示未测试
  if (isConfigured) {
    return 'opacity-50 grayscale'; // 灰度半透明 - 已配置但未测试
  }
  return 'opacity-25 grayscale'; // 非常淡灰色 - 未配置
}

/**
 * 获取状态文本
 */
function getStatusText(status: boolean | null | undefined, isConfigured: boolean): string {
  if (!isConfigured) return '未配置';
  if (status === true) return '支持';
  if (status === false) return '不支持';
  return '已配置，待测试';
}

/**
 * 格式化测试时间
 */
function formatTestedAt(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚测试';
  if (minutes < 60) return `${minutes} 分钟前测试`;
  if (hours < 24) return `${hours} 小时前测试`;
  return `${days} 天前测试`;
}

/**
 * 加载动画组件
 */
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-blue-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * 检查 CLI 是否已配置（有 API Key 和 Model）
 */
function isCliConfigured(cliConfig: CliConfig | null, key: keyof CliConfig): boolean {
  if (!cliConfig) return false;
  const config = cliConfig[key];
  if (!config) return false;
  return !!(config.apiKeyId && config.model);
}

/**
 * 检查 CLI 是否启用（仅通过 enabled 字段判断）
 */
export function isCliEnabled(cliConfig: CliConfig | null, key: keyof CliConfig): boolean {
  if (!cliConfig) {
    // 没有配置时使用默认配置
    return DEFAULT_CLI_CONFIG[key].enabled;
  }
  const config = cliConfig[key];
  // 兼容旧配置格式（可能没有 enabled 字段）
  if (!config || config.enabled === undefined) {
    return DEFAULT_CLI_CONFIG[key].enabled;
  }
  return config.enabled;
}

/**
 * CLI 兼容性图标组件
 */
export function CliCompatibilityIcons({
  compatibility,
  cliConfig,
  isLoading = false,
  onConfig,
  onTest,
  onApply,
}: CliCompatibilityIconsProps) {
  const testedAtText = formatTestedAt(compatibility?.testedAt);

  return (
    <div className="flex items-center gap-1 pl-2">
      {/* 加载状态 */}
      {isLoading ? (
        <div className="flex items-center gap-1 px-1">
          <LoadingSpinner />
          <span className="text-xs text-slate-500">测试中...</span>
        </div>
      ) : (
        <>
          {/* CLI 图标 - 仅通过 enabled 字段判断是否显示 */}
          {CLI_TYPES.map(({ key, configKey, name, icon, sizeClass }) => {
            // 仅通过 enabled 字段判断是否显示图标
            const enabled = isCliEnabled(cliConfig, configKey);

            // 禁用则不显示图标
            if (!enabled) {
              return null;
            }

            const status = compatibility?.[key];
            const configured = isCliConfigured(cliConfig, configKey);
            const styleClass = getIconStyleClass(status, configured);
            const statusText = getStatusText(status, configured);
            const tooltipText = `${name}: ${statusText}${testedAtText && configured ? ` (${testedAtText})` : ''}`;

            return (
              <div
                key={key}
                className={`${sizeClass} flex-shrink-0 transition-all duration-200 ${styleClass}`}
                title={tooltipText}
              >
                <img src={icon} alt={name} className="w-full h-full" />
              </div>
            );
          })}

          {/* 操作按钮组 - 配置/测试/应用 */}
          <div className="flex items-center gap-0.5 ml-1 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50">
            {/* 配置按钮 */}
            {onConfig && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onConfig();
                }}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                title="配置 CLI"
              >
                <svg
                  className="w-[18px] h-[18px] text-slate-500 hover:text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            )}

            {/* 测试按钮 - 始终显示 */}
            {onTest && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onTest();
                }}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                title="测试 CLI 兼容性"
              >
                <svg
                  className="w-[18px] h-[18px] text-slate-500 hover:text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            )}

            {/* 应用配置按钮 */}
            {onApply && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onApply(e);
                }}
                className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                title="应用 CLI 配置到本地文件"
              >
                <svg
                  className="w-[18px] h-[18px] text-slate-500 hover:text-purple-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
