/**
 * 输入: AllCliDetectionResult (所有 CLI 检测结果), useConfigDetection hook
 * 输出: CLI 配置状态面板组件，显示所有 CLI 工具的配置来源状态和认证类型
 * 定位: UI 组件层 - 集成显示所有 CLI 配置状态和刷新按钮
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CliConfigStatus/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { RefreshCw, Loader2, Info } from 'lucide-react';
import { useState } from 'react';
import { CliConfigStatus } from './CliConfigStatus';
import { useConfigDetection } from '../../hooks/useConfigDetection';
import type { AuthType, CliType, CliDetectionResult } from '../../../shared/types/config-detection';

export interface CliConfigStatusPanelProps {
  /** 是否紧凑模式 */
  compact?: boolean;
  /** 是否显示刷新按钮 */
  showRefresh?: boolean;
  /** 是否显示详情按钮 */
  showDetails?: boolean;
  /** 自定义类名 */
  className?: string;
}

/** CLI 类型列表 */
const CLI_TYPES: CliType[] = ['claudeCode', 'codex', 'geminiCli'];

/** CLI 名称映射 */
const CLI_NAMES: Record<CliType, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
  geminiCli: 'Gemini CLI',
};

/** 认证类型显示配置 */
const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  'google-login': 'Google 登录',
  'vertex-ai': 'Vertex AI',
  'gemini-api-key': 'Gemini API Key',
  'chatgpt-oauth': 'ChatGPT OAuth',
  'api-key': 'API Key',
  unknown: '未知',
};

/**
 * 获取认证类型标签
 */
function getAuthTypeLabel(authType?: AuthType): string {
  if (!authType) return '未检测';
  return AUTH_TYPE_LABELS[authType] || '未知';
}

/**
 * 详细信息行组件
 */
function DetailRow({ cliType, result }: { cliType: CliType; result: CliDetectionResult }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-200 dark:border-slate-600 last:border-b-0">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
        {CLI_NAMES[cliType]}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {getAuthTypeLabel(result.authType)}
        </span>
        {result.hasApiKey && (
          <span className="text-[10px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
            API Key
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * CLI 配置状态面板组件
 *
 * 显示所有 CLI 工具的配置来源状态，并提供刷新按钮
 */
export function CliConfigStatusPanel({
  compact = false,
  showRefresh = true,
  showDetails = false,
  className = '',
}: CliConfigStatusPanelProps) {
  const { detection, isLoading, refresh } = useConfigDetection();
  const [showDetailPanel, setShowDetailPanel] = useState(false);

  const handleRefresh = async () => {
    await refresh();
  };

  const toggleDetails = () => {
    setShowDetailPanel(!showDetailPanel);
  };

  // 加载状态
  if (isLoading && !detection) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
        <span className="text-xs text-slate-500">检测中...</span>
      </div>
    );
  }

  // 无检测结果
  if (!detection) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-xs text-slate-500">未检测</span>
        {showRefresh && (
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            title="检测 CLI 配置"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500 hover:text-blue-500" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        {/* CLI 状态列表 */}
        <div className="flex items-center gap-4 divide-x divide-slate-300 dark:divide-slate-600">
          {CLI_TYPES.map((cliType, index) => (
            <div key={cliType} className={index > 0 ? 'pl-4' : ''}>
              <CliConfigStatus cliType={cliType} result={detection[cliType]} compact={compact} />
            </div>
          ))}
        </div>

        {/* 详情按钮 */}
        {showDetails && (
          <button
            onClick={toggleDetails}
            className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors ${
              showDetailPanel ? 'bg-slate-200 dark:bg-slate-600' : ''
            }`}
            title="查看认证详情"
          >
            <Info className="w-3.5 h-3.5 text-slate-500 hover:text-blue-500" />
          </button>
        )}

        {/* 刷新按钮 */}
        {showRefresh && (
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
            title="刷新 CLI 配置检测"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-slate-500 hover:text-blue-500 ${isLoading ? 'animate-spin' : ''}`}
            />
          </button>
        )}
      </div>

      {/* 详情面板 */}
      {showDetails && showDetailPanel && (
        <div className="absolute top-full left-0 mt-1 z-10 w-64 p-2 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-600">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
            认证详情
          </div>
          {CLI_TYPES.map(cliType => (
            <DetailRow key={cliType} cliType={cliType} result={detection[cliType]} />
          ))}
        </div>
      )}
    </div>
  );
}
