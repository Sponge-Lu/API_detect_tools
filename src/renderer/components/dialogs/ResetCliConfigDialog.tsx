/**
 * 输入: ResetCliConfigDialogProps (open, onClose, onResetComplete)
 * 输出: React 组件 (CLI 配置重置对话框)
 * 定位: 展示层 - 让用户选择要重置的 CLI 并确认删除配置文件
 */

import { useState } from 'react';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { AppModal } from '../AppModal/AppModal';
import { CLI_CONFIG_PATHS } from '../../../shared/types/config-detection';
import type { CliType } from '../../../shared/types/config-detection';
import { toast } from '../../store/toastStore';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

interface ResetCliConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onResetComplete?: () => void;
}

/** CLI 类型配置 */
interface CliOption {
  key: CliType;
  name: string;
  icon: string;
  files: string[];
}

const CLI_OPTIONS: CliOption[] = [
  {
    key: 'claudeCode',
    name: 'Claude Code',
    icon: ClaudeCodeIcon,
    files: Object.values(CLI_CONFIG_PATHS.claudeCode).map(p => `~/${p}`),
  },
  {
    key: 'codex',
    name: 'Codex',
    icon: CodexIcon,
    files: Object.values(CLI_CONFIG_PATHS.codex).map(p => `~/${p}`),
  },
  {
    key: 'geminiCli',
    name: 'Gemini CLI',
    icon: GeminiIcon,
    files: Object.values(CLI_CONFIG_PATHS.geminiCli).map(p => `~/${p}`),
  },
];

export function ResetCliConfigDialog({
  open,
  onClose,
  onResetComplete,
}: ResetCliConfigDialogProps) {
  const [selectedClis, setSelectedClis] = useState<Set<CliType>>(new Set());
  const [isResetting, setIsResetting] = useState(false);

  const toggleCli = (cliType: CliType) => {
    setSelectedClis(prev => {
      const next = new Set(prev);
      if (next.has(cliType)) {
        next.delete(cliType);
      } else {
        next.add(cliType);
      }
      return next;
    });
  };

  const selectedFiles = CLI_OPTIONS.filter(cli => selectedClis.has(cli.key)).flatMap(
    cli => cli.files
  );

  const handleReset = async () => {
    if (selectedClis.size === 0 || isResetting) return;
    setIsResetting(true);

    try {
      const results: { cli: string; success: boolean; deletedPaths: string[] }[] = [];

      for (const cliType of selectedClis) {
        const result = await window.electronAPI.configDetection.resetCliConfig(cliType);
        const cliName = CLI_OPTIONS.find(c => c.key === cliType)?.name || cliType;
        results.push({
          cli: cliName,
          success: result.success,
          deletedPaths: result.deletedPaths || [],
        });
      }

      const allSuccess = results.every(r => r.success);
      const totalDeleted = results.reduce((sum, r) => sum + r.deletedPaths.length, 0);

      if (allSuccess) {
        if (totalDeleted > 0) {
          toast.success(
            `已重置 ${results.map(r => r.cli).join('、')} 配置（删除 ${totalDeleted} 个文件）`
          );
        } else {
          toast.success('配置文件不存在，无需重置');
        }
      } else {
        const failed = results.filter(r => !r.success).map(r => r.cli);
        toast.error(`${failed.join('、')} 重置失败`);
      }

      setSelectedClis(new Set());
      onClose();
      onResetComplete?.();
    } catch (error) {
      console.error('重置 CLI 配置失败:', error);
      toast.error('重置失败，请查看日志');
    } finally {
      setIsResetting(false);
    }
  };

  const handleClose = () => {
    if (isResetting) return;
    setSelectedClis(new Set());
    onClose();
  };

  return (
    <AppModal
      isOpen={open}
      onClose={handleClose}
      title="重置 CLI 配置"
      titleIcon={<RotateCcw className="w-5 h-5" />}
      size="md"
      showCloseButton={!isResetting}
    >
      <div className="space-y-4">
        {/* 说明 */}
        <p className="text-sm text-[var(--text-secondary)]">
          选择要重置的 CLI，将删除其本地配置文件使其恢复到未配置状态。
        </p>

        {/* CLI 选择列表 */}
        <div className="flex flex-col gap-2">
          {CLI_OPTIONS.map(cli => {
            const isSelected = selectedClis.has(cli.key);
            return (
              <button
                type="button"
                key={cli.key}
                onClick={() => toggleCli(cli.key)}
                disabled={isResetting}
                className={`flex items-center gap-3 w-full px-4 py-3 text-left border rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'border-[var(--danger)]/25 bg-[var(--danger-soft)]'
                    : 'border-[var(--line-soft)] bg-[var(--surface-1)] hover:border-[var(--accent)]/30 hover:bg-[var(--surface-2)]'
                }`}
              >
                <div className="w-5 h-5 flex-shrink-0">
                  <img src={cli.icon} alt={cli.name} className="w-full h-full" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[var(--text-primary)]">{cli.name}</div>
                  <div className="text-xs text-[var(--text-tertiary)] truncate">
                    {cli.files.join(', ')}
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'border-[var(--danger)] bg-[var(--danger)]'
                      : 'border-[var(--line-soft)] bg-[var(--surface-3)]'
                  }`}
                >
                  {isSelected && (
                    <svg
                      className="w-3 h-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* 将要删除的文件列表 */}
        {selectedFiles.length > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--danger)]/20 bg-[var(--danger-soft)] p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-[var(--danger)]" />
              <span className="text-xs font-medium text-[var(--danger)]">将要删除的文件</span>
            </div>
            <ul className="space-y-1">
              {selectedFiles.map(file => (
                <li key={file} className="pl-6 font-mono text-xs text-[var(--text-secondary)]">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-2">
          <AppButton type="button" variant="secondary" onClick={handleClose} disabled={isResetting}>
            取消
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            onClick={handleReset}
            disabled={selectedClis.size === 0 || isResetting}
            loading={isResetting}
          >
            {isResetting ? (
              '重置中...'
            ) : (
              <>
                <RotateCcw className="w-4 h-4" />
                确认重置
              </>
            )}
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
