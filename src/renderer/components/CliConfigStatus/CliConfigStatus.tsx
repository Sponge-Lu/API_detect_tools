/**
 * 输入: CliDetectionResult (检测结果), CliType (CLI 类型)
 * 输出: CLI 配置状态组件，显示各 CLI 工具当前使用的配置来源和认证类型
 * 定位: UI 组件层 - 显示 Claude Code、Codex、Gemini CLI 的配置来源状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CliConfigStatus/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type {
  AuthType,
  CliDetectionResult,
  CliType,
  ConfigSourceType,
} from '../../../shared/types/config-detection';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface CliConfigStatusProps {
  /** CLI 类型 */
  cliType: CliType;
  /** 检测结果 */
  result: CliDetectionResult;
  /** 是否紧凑模式（仅显示图标和简短状态） */
  compact?: boolean;
}

/** CLI 类型配置 */
interface CliTypeConfig {
  key: CliType;
  name: string;
  icon: string;
  sizeClass: string;
}

const CLI_TYPE_CONFIGS: Record<CliType, CliTypeConfig> = {
  claudeCode: {
    key: 'claudeCode',
    name: 'Claude Code',
    icon: ClaudeCodeIcon,
    sizeClass: 'w-[18px] h-[18px]',
  },
  codex: {
    key: 'codex',
    name: 'Codex',
    icon: CodexIcon,
    sizeClass: 'w-5 h-5',
  },
  geminiCli: {
    key: 'geminiCli',
    name: 'Gemini CLI',
    icon: GeminiIcon,
    sizeClass: 'w-5 h-5',
  },
};

/** 配置来源类型的显示配置 */
interface SourceTypeDisplay {
  label: string;
  shortLabel: string;
  colorClass: string;
  bgClass: string;
  iconOpacity: string;
}

const SOURCE_TYPE_DISPLAYS: Record<ConfigSourceType, SourceTypeDisplay> = {
  managed: {
    label: '应用管理',
    shortLabel: '管理',
    colorClass: 'text-[var(--success)]',
    bgClass: 'bg-[var(--success-soft)]',
    iconOpacity: 'opacity-100',
  },
  official: {
    label: '官方 API',
    shortLabel: '官方',
    colorClass: 'text-[var(--accent)]',
    bgClass: 'bg-[var(--accent-soft)]',
    iconOpacity: 'opacity-100',
  },
  subscription: {
    label: '订阅账号',
    shortLabel: '订阅',
    colorClass: 'text-[var(--warning)]',
    bgClass: 'bg-[var(--warning-soft)]',
    iconOpacity: 'opacity-100',
  },
  other: {
    label: '其他中转站',
    shortLabel: '其他',
    colorClass: 'text-[var(--danger)]',
    bgClass: 'bg-[var(--danger-soft)]',
    iconOpacity: 'opacity-80',
  },
  unknown: {
    label: '未配置',
    shortLabel: '未配置',
    colorClass: 'text-[var(--text-secondary)]',
    bgClass: 'bg-[var(--surface-2)]',
    iconOpacity: 'opacity-40 grayscale',
  },
};

/** 认证类型的显示配置 */
interface AuthTypeDisplay {
  label: string;
  shortLabel: string;
  icon: string;
}

const AUTH_TYPE_DISPLAYS: Record<AuthType, AuthTypeDisplay> = {
  'google-login': {
    label: 'Google 登录',
    shortLabel: 'Google',
    icon: '🔐',
  },
  'vertex-ai': {
    label: 'Vertex AI',
    shortLabel: 'Vertex',
    icon: '☁️',
  },
  'gemini-api-key': {
    label: 'Gemini API Key',
    shortLabel: 'API Key',
    icon: '🔑',
  },
  'chatgpt-oauth': {
    label: 'ChatGPT OAuth',
    shortLabel: 'OAuth',
    icon: '🔐',
  },
  'api-key': {
    label: 'API Key',
    shortLabel: 'API Key',
    icon: '🔑',
  },
  unknown: {
    label: '未知',
    shortLabel: '未知',
    icon: '❓',
  },
};

/**
 * 获取认证类型显示信息
 */
function getAuthTypeDisplay(authType?: AuthType): AuthTypeDisplay | null {
  if (!authType || authType === 'unknown') {
    return null;
  }
  return AUTH_TYPE_DISPLAYS[authType];
}

/**
 * 获取状态详情文本
 */
function getStatusDetail(result: CliDetectionResult): string {
  const parts: string[] = [];

  // 显示认证类型
  const authDisplay = getAuthTypeDisplay(result.authType);
  if (authDisplay) {
    parts.push(`认证: ${authDisplay.label}`);
  }

  if (result.siteName) {
    parts.push(`站点: ${result.siteName}`);
  }

  if (result.baseUrl) {
    parts.push(`URL: ${result.baseUrl}`);
  }

  if (result.hasApiKey) {
    parts.push('已配置 API Key');
  }

  if (result.error) {
    parts.push(`错误: ${result.error}`);
  }

  return parts.join('\n');
}

/**
 * 格式化检测时间
 */
function formatDetectedAt(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚检测';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

/**
 * CLI 配置状态组件
 *
 * 显示单个 CLI 工具的配置来源状态
 */
export function CliConfigStatus({ cliType, result, compact = false }: CliConfigStatusProps) {
  const cliConfig = CLI_TYPE_CONFIGS[cliType];
  const sourceDisplay = SOURCE_TYPE_DISPLAYS[result.sourceType];
  const authDisplay = getAuthTypeDisplay(result.authType);
  const statusDetail = getStatusDetail(result);
  const detectedAtText = formatDetectedAt(result.detectedAt);

  // 匹配自定义配置
  const { configs } = useCustomCliConfigStore();
  const matchedCustomConfig =
    result.sourceType === 'other' && result.baseUrl
      ? configs.find(c => {
          if (!c.baseUrl) return false;
          // 标准化 URL 进行比较：移除协议、尾部斜杠、常见路径前缀（如 /v1）
          const normalizeUrl = (url: string) => {
            return url
              .replace(/^https?:\/\//, '') // 移除协议
              .replace(/\/(v\d+)?\/?$/, '') // 移除尾部 /v1 或 / 等
              .toLowerCase();
          };
          return normalizeUrl(c.baseUrl) === normalizeUrl(result.baseUrl!);
        })
      : null;

  // 构建 tooltip 文本
  const tooltipParts = [
    `${cliConfig.name}: ${matchedCustomConfig ? matchedCustomConfig.name : sourceDisplay.label}`,
    statusDetail,
    `检测时间: ${detectedAtText}`,
  ].filter(Boolean);
  const tooltipText = tooltipParts.join('\n');

  if (compact) {
    // 紧凑模式：仅显示图标和简短状态标签
    // 如果匹配到自定义配置，显示配置名称；否则对于 'other' 类型显示 Base URL
    const showBaseUrl = result.sourceType === 'other' && result.baseUrl && !matchedCustomConfig;
    const displayLabel = matchedCustomConfig
      ? matchedCustomConfig.name
      : result.sourceType === 'managed' && result.siteName
        ? result.siteName
        : sourceDisplay.shortLabel;

    // 格式化 Base URL 显示（移除协议前缀，截断过长的 URL）
    const formatBaseUrl = (url: string): string => {
      const cleaned = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return cleaned.length > 20 ? cleaned.substring(0, 20) + '...' : cleaned;
    };

    // 自定义配置使用特殊颜色
    const labelColorClass = matchedCustomConfig ? 'text-[var(--accent)]' : sourceDisplay.colorClass;

    return (
      <div className="flex items-start gap-[var(--spacing-sm)]" title={tooltipText}>
        <div className={`${cliConfig.sizeClass} flex-shrink-0 ${sourceDisplay.iconOpacity}`}>
          <img src={cliConfig.icon} alt={cliConfig.name} className="w-full h-full" />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={`block text-xs font-medium leading-4 ${labelColorClass} [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-all`}
          >
            {displayLabel}
          </span>
          {/* 对于 'other' 类型显示 Base URL（仅在未匹配自定义配置时） */}
          {showBaseUrl && (
            <span className="block max-w-[100px] truncate text-[10px] text-[var(--text-secondary)]">
              {formatBaseUrl(result.baseUrl!)}
            </span>
          )}
        </div>
        {/* 显示认证类型图标 */}
        {authDisplay && (
          <span className="text-xs" title={authDisplay.label}>
            {authDisplay.icon}
          </span>
        )}
      </div>
    );
  }

  // 完整模式：显示图标、状态标签和详细信息
  // 自定义配置使用特殊颜色和背景
  const fullBgClass = matchedCustomConfig ? 'bg-[var(--accent-soft)]' : sourceDisplay.bgClass;
  const fullColorClass = matchedCustomConfig ? 'text-[var(--accent)]' : sourceDisplay.colorClass;
  const fullDisplayLabel = matchedCustomConfig
    ? matchedCustomConfig.name
    : result.sourceType === 'managed' && result.siteName
      ? result.siteName
      : sourceDisplay.label;

  return (
    <div
      className={`flex items-center gap-[var(--spacing-sm)] px-[var(--spacing-sm)] py-[var(--spacing-xs)] rounded-md ${fullBgClass}`}
      title={tooltipText}
    >
      <div className={`${cliConfig.sizeClass} flex-shrink-0 ${sourceDisplay.iconOpacity}`}>
        <img src={cliConfig.icon} alt={cliConfig.name} className="w-full h-full" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-[var(--spacing-xs)]">
          <span className={`text-xs font-medium ${fullColorClass} truncate`}>
            {fullDisplayLabel}
          </span>
          {/* 显示认证类型图标 */}
          {authDisplay && (
            <span className="text-xs" title={authDisplay.label}>
              {authDisplay.icon}
            </span>
          )}
        </div>
        {result.baseUrl && result.sourceType !== 'unknown' && !matchedCustomConfig && (
          <span className="text-[10px] text-[var(--text-secondary)] truncate max-w-[120px]">
            {result.baseUrl}
          </span>
        )}
      </div>
    </div>
  );
}
