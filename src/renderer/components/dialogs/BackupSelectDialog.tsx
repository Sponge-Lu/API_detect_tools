/**
 * @file src/renderer/components/dialogs/BackupSelectDialog.tsx
 * @description 备份选择对话框
 *
 * 输入: BackupSelectDialogProps (备份列表、加载状态、选择/关闭回调)
 * 输出: React 组件 (备份选择对话框 UI)
 * 定位: 展示层 - 备份选择对话框，从备份目录选择配置文件进行恢复
 *
 * @version 2.1.11
 * @updated 2026-04-02 - 对齐统一弹窗与按钮原语
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { FileJson, Clock, HardDrive, FolderOpen } from 'lucide-react';
import { AppModal } from '../AppModal/AppModal';
import { AppButton } from '../AppButton/AppButton';

interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
}

interface BackupSelectDialogProps {
  isOpen: boolean;
  backups: BackupInfo[];
  loading: boolean;
  onSelect: (backup: BackupInfo) => void;
  onClose: () => void;
}

export function BackupSelectDialog({
  isOpen,
  backups,
  loading,
  onSelect,
  onClose,
}: BackupSelectDialogProps) {
  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title="选择备份文件恢复"
      titleIcon={<FolderOpen className="w-5 h-5" />}
      size="lg"
      footer={
        <AppButton variant="tertiary" onClick={onClose}>
          取消
        </AppButton>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-[var(--text-secondary)]">加载备份列表中...</div>
      ) : backups.length === 0 ? (
        <div className="py-8 text-center text-[var(--text-secondary)]">
          <FileJson className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p>没有找到备份文件</p>
          <p className="mt-1 text-sm">备份目录: ~/.api-hub-management-tools/</p>
        </div>
      ) : (
        <>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {backups.map((backup, index) => (
              <button
                key={backup.filename}
                onClick={() => onSelect(backup)}
                className="group w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-4 text-left transition-colors duration-[var(--duration-fast)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
              >
                <div className="flex items-center gap-3">
                  <FileJson className="h-8 w-8 flex-shrink-0 text-[var(--accent)]" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium text-[var(--text-primary)]">
                      {backup.filename}
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(backup.timestamp)}
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {formatSize(backup.size)}
                      </span>
                    </div>
                  </div>
                  {index === 0 && (
                    <span className="rounded-[var(--radius-sm)] bg-[var(--success-soft)] px-2 py-0.5 text-xs text-[var(--success)]">
                      最新
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-4 border-t border-[var(--line-soft)] pt-4 text-center text-xs text-[var(--text-tertiary)]">
            选择一个备份文件来恢复站点配置。恢复前会自动备份当前配置。
          </p>
        </>
      )}
    </AppModal>
  );
}
