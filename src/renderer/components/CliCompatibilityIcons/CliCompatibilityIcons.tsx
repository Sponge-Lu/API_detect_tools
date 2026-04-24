/**
 * 输入: CliCompatibilityResult (兼容性结果), CliConfig (CLI 配置)
 * 输出: CLI 兼容性图标组件，显示各工具支持状态和详细测试结果
 * 定位: UI 组件层 - 显示 Claude Code、Codex、Gemini CLI 的兼容性状态图标
 *
 * @version 2.1.12
 * @updated 2026-04-02 - 对齐当前中性操作按钮组说明
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CliCompatibilityIcons/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { CliCompatibilityResult } from '../../store/detectionStore';
import type { CliConfig } from '../../../shared/types/cli-config';
import {
  DEFAULT_CLI_CONFIG,
  getCliTestResultStatus,
  getCliTestResultTestedAt,
} from '../../../shared/types/cli-config';
import { buildCliCompatibilityTooltip, getCliCompatibilityIconClass } from './cliCompatibilityMeta';

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
  /** 是否显示配置/测试/应用动作组 */
  showActionButtons?: boolean;
  /** 配置按钮形态 */
  configTrigger?: 'icon' | 'text';
  /** 文本配置按钮文案 */
  configButtonLabel?: string;
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
 * 加载动画组件
 */
function LoadingSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-[var(--accent)]"
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
  showActionButtons = true,
  configTrigger = 'icon',
  configButtonLabel = 'CLI配置',
  onConfig,
  onApply,
}: CliCompatibilityIconsProps) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-0.5">
      {/* 加载状态 */}
      {isLoading ? (
        <div className="flex items-center gap-1 px-1">
          <LoadingSpinner />
          <span className="text-xs text-[var(--text-secondary)]">测试中...</span>
        </div>
      ) : (
        <>
          {/* CLI 图标 - 始终显示，未启用时使用最淡样式 */}
          {CLI_TYPES.map(({ key, configKey, name, icon, sizeClass }) => {
            const enabled = isCliEnabled(cliConfig, configKey);

            // 未启用：最淡样式
            if (!enabled) {
              return (
                <div
                  key={key}
                  className={`${sizeClass} flex-shrink-0 transition-opacity duration-200 opacity-15 grayscale`}
                  title={`${name}: 未启用`}
                >
                  <img src={icon} alt={name} className="w-full h-full" />
                </div>
              );
            }

            const configItem = cliConfig?.[configKey] ?? null;
            const persistedStatus = getCliTestResultStatus(configItem);
            const persistedTestedAt = getCliTestResultTestedAt(configItem);
            const status = persistedStatus ?? compatibility?.[key];
            const configured = isCliConfigured(cliConfig, configKey);
            const cliError =
              key === 'claudeCode'
                ? compatibility?.claudeError
                : key === 'codex'
                  ? compatibility?.codexError
                  : compatibility?.geminiError;
            const styleClass = getCliCompatibilityIconClass({
              enabled,
              configured,
              status,
            });
            const tooltipText = buildCliCompatibilityTooltip({
              name,
              enabled,
              configured,
              status,
              testedAt: persistedTestedAt ?? compatibility?.testedAt,
              claudeDetail: compatibility?.claudeDetail,
              codexDetail: compatibility?.codexDetail,
              geminiDetail: compatibility?.geminiDetail,
              sourceLabel: compatibility?.sourceLabel,
              error: cliError ?? compatibility?.error,
            });

            return (
              <div
                key={key}
                className={`${sizeClass} flex-shrink-0 transition-opacity duration-200 ${styleClass}`}
                title={tooltipText}
              >
                <img src={icon} alt={name} className="w-full h-full" />
              </div>
            );
          })}

          {showActionButtons && (
            <div className="ml-0.5 flex shrink-0 items-center gap-0.5">
              {onConfig && configTrigger === 'text' && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onConfig();
                  }}
                  className="h-7 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-1.5 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  title="配置 CLI"
                  aria-label={configButtonLabel}
                >
                  {configButtonLabel}
                </button>
              )}

              {onApply && configTrigger === 'text' && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onApply(e);
                  }}
                  className="h-7 shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-1.5 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  title="CLI应用"
                  aria-label="CLI应用"
                >
                  CLI应用
                </button>
              )}

              {onConfig && configTrigger === 'icon' && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onConfig();
                  }}
                  className="p-0.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-1)] active:scale-95 transition-all duration-200"
                  title="配置 CLI"
                >
                  <svg
                    className="w-[18px] h-[18px] text-[var(--icon-muted)] hover:text-[var(--accent)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>
              )}

              {onApply && configTrigger === 'icon' && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onApply(e);
                  }}
                  className="p-0.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-1)] active:scale-95 transition-all duration-200"
                  title="应用 CLI 配置到本地文件"
                >
                  <svg
                    className="w-[18px] h-[18px] text-[var(--icon-muted)] hover:text-[var(--accent)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
