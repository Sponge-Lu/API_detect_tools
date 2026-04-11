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
  /** 布局模式 */
  layout?: 'inline' | 'stacked';
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
    <div className="flex items-center justify-between border-b border-[var(--line-soft)] py-2 last:border-b-0">
      <span className="text-xs font-medium text-[var(--text-primary)]">{CLI_NAMES[cliType]}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)]">
          {getAuthTypeLabel(result.authType)}
        </span>
        {result.hasApiKey && (
          <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] text-[var(--success)]">
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
  layout = 'inline',
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

  const actionButtons = (
    <>
      {showRefresh && (
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--accent)] disabled:opacity-50"
          title="刷新 CLI 配置检测"
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : '刷新'}
        </button>
      )}
      {showEdit && (
        <button
          onClick={() => setShowEditDialog(true)}
          className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
          title="编辑 CLI 配置文件"
        >
          编辑
        </button>
      )}
      {showReset && (
        <button
          onClick={() => setShowResetDialog(true)}
          className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
          title="重置 CLI 配置"
        >
          重置
        </button>
      )}
    </>
  );

  // 加载状态
  if (isLoading && !detection) {
    if (layout === 'stacked') {
      return (
        <div className={`space-y-2 ${className}`}>
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-1)] px-2 py-1.5">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
            <span className="text-xs text-[var(--text-secondary)]">检测中...</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">{actionButtons}</div>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
        <span className="text-xs text-[var(--text-secondary)]">检测中...</span>
      </div>
    );
  }

  // 无检测结果
  if (!detection) {
    if (layout === 'stacked') {
      return (
        <div className={`space-y-2 ${className}`}>
          <div className="space-y-1.5">
            {CLI_TYPES.map(cliType => (
              <div key={cliType} className="flex items-center justify-between px-1 py-1">
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {CLI_NAMES[cliType]}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">未检测</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5">{actionButtons}</div>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-xs text-[var(--text-secondary)]">未检测</span>
        {showRefresh && (
          <button
            onClick={handleRefresh}
            className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
            title="检测 CLI 配置"
          >
            刷新
          </button>
        )}
      </div>
    );
  }

  if (layout === 'stacked') {
    return (
      <div className={`relative space-y-2 ${className}`}>
        <div className="space-y-1.5">
          {CLI_TYPES.map(cliType => (
            <div key={cliType} className="px-1 py-1">
              <CliConfigStatus cliType={cliType} result={detection[cliType]} compact />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">{actionButtons}</div>

        {showReset && (
          <ResetCliConfigDialog
            open={showResetDialog}
            onClose={() => setShowResetDialog(false)}
            onResetComplete={refresh}
          />
        )}

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
            className={`rounded-[var(--radius-sm)] p-1 transition-colors hover:bg-[var(--surface-2)] ${
              showDetailPanel ? 'bg-[var(--surface-2)]' : ''
            }`}
            title="查看认证详情"
          >
            <Info className="h-3.5 w-3.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)]" />
          </button>
        )}

        {/* 刷新按钮 */}
        {actionButtons}
      </div>

      {/* 详情面板 */}
      {showDetails && showDetailPanel && (
        <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-2 shadow-lg">
          <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">认证详情</div>
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
