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

import { Loader2, Info } from 'lucide-react';
import { useState, useEffect } from 'react';
import { CliConfigStatus } from './CliConfigStatus';
import { ResetCliConfigDialog } from '../dialogs/ResetCliConfigDialog';
import { EditCliConfigDialog } from '../dialogs/EditCliConfigDialog';
import { useConfigDetection } from '../../hooks/useConfigDetection';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import type { AuthType, CliType, CliDetectionResult } from '../../../shared/types/config-detection';

export interface CliConfigStatusPanelProps {
  /** 是否紧凑模式 */
  compact?: boolean;
  /** 是否显示刷新按钮 */
  showRefresh?: boolean;
  /** 是否显示详情按钮 */
  showDetails?: boolean;
  /** 是否显示重置按钮 */
  showReset?: boolean;
  /** 是否显示编辑按钮 */
  showEdit?: boolean;
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
    <div className="flex items-center justify-between py-2 border-b border-light-border dark:border-dark-border last:border-b-0">
      <span className="text-xs font-medium text-light-text dark:text-dark-text">
        {CLI_NAMES[cliType]}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
          {getAuthTypeLabel(result.authType)}
        </span>
        {result.hasApiKey && (
          <span className="text-[10px] px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
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
  showReset = false,
  showEdit = false,
  className = '',
}: CliConfigStatusPanelProps) {
  const { detection, isLoading, refresh } = useConfigDetection();
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // 加载自定义CLI配置，以便CliConfigStatus能匹配配置名称
  const { loadConfigs } = useCustomCliConfigStore();
  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

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
        <Loader2 className="w-4 h-4 animate-spin text-light-text-secondary dark:text-dark-text-secondary" />
        <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
          检测中...
        </span>
      </div>
    );
  }

  // 无检测结果
  if (!detection) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
          未检测
        </span>
        {showRefresh && (
          <button
            onClick={handleRefresh}
            className="px-1.5 py-0.5 rounded text-[11px] text-light-text-secondary dark:text-dark-text-secondary hover:text-primary-500 hover:bg-light-bg dark:hover:bg-dark-bg transition-colors"
            title="检测 CLI 配置"
          >
            刷新
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        {/* CLI 状态列表 */}
        <div className="flex items-center gap-3">
          {CLI_TYPES.map(cliType => (
            <CliConfigStatus
              key={cliType}
              cliType={cliType}
              result={detection[cliType]}
              compact={compact}
            />
          ))}
        </div>

        {/* 详情按钮 */}
        {showDetails && (
          <button
            onClick={toggleDetails}
            className={`p-1 rounded hover:bg-light-bg dark:hover:bg-dark-bg transition-colors ${
              showDetailPanel ? 'bg-light-bg dark:bg-dark-bg' : ''
            }`}
            title="查看认证详情"
          >
            <Info className="w-3.5 h-3.5 text-light-text-secondary dark:text-dark-text-secondary hover:text-primary-500" />
          </button>
        )}

        {/* 刷新按钮 */}
        {showRefresh && (
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-1.5 py-0.5 rounded text-[11px] text-light-text-secondary dark:text-dark-text-secondary hover:text-primary-500 hover:bg-light-bg dark:hover:bg-dark-bg transition-colors disabled:opacity-50"
            title="刷新 CLI 配置检测"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : '刷新'}
          </button>
        )}

        {/* 编辑按钮 */}
        {showEdit && (
          <button
            onClick={() => setShowEditDialog(true)}
            className="px-1.5 py-0.5 rounded text-[11px] text-light-text-secondary dark:text-dark-text-secondary hover:text-[var(--ios-blue)] hover:bg-light-bg dark:hover:bg-dark-bg transition-colors"
            title="编辑 CLI 配置文件"
          >
            编辑
          </button>
        )}

        {/* 重置按钮 */}
        {showReset && (
          <button
            onClick={() => setShowResetDialog(true)}
            className="px-1.5 py-0.5 rounded text-[11px] text-light-text-secondary dark:text-dark-text-secondary hover:text-[var(--ios-red)] hover:bg-light-bg dark:hover:bg-dark-bg transition-colors"
            title="重置 CLI 配置"
          >
            重置
          </button>
        )}
      </div>

      {/* 详情面板 */}
      {showDetails && showDetailPanel && (
        <div className="absolute top-full left-0 mt-1 z-10 w-64 p-2 bg-white dark:bg-dark-card rounded-lg shadow-lg border border-light-border dark:border-dark-border">
          <div className="text-xs font-medium text-light-text-secondary dark:text-dark-text-secondary mb-2">
            认证详情
          </div>
          {CLI_TYPES.map(cliType => (
            <DetailRow key={cliType} cliType={cliType} result={detection[cliType]} />
          ))}
        </div>
      )}

      {/* 重置 CLI 配置对话框 */}
      {showReset && (
        <ResetCliConfigDialog
          open={showResetDialog}
          onClose={() => setShowResetDialog(false)}
          onResetComplete={refresh}
        />
      )}

      {/* 编辑 CLI 配置对话框 */}
      {showEdit && (
        <EditCliConfigDialog
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          onSaveComplete={refresh}
        />
      )}
    </div>
  );
}
