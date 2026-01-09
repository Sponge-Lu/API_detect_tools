/**
 * @file src/renderer/components/dialogs/BackupSelectDialog.tsx
 * @description 备份选择对话框 - 使用 IOSModal 重构
 *
 * 输入: BackupSelectDialogProps (备份列表、加载状态、选择/关闭回调)
 * 输出: React 组件 (备份选择对话框 UI)
 * 定位: 展示层 - 备份选择对话框，从备份目录选择配置文件进行恢复
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 使用 IOSModal 重构
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { FileJson, Clock, HardDrive, FolderOpen } from 'lucide-react';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';

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
    <IOSModal
      isOpen={isOpen}
      onClose={onClose}
      title="选择备份文件恢复"
      titleIcon={<FolderOpen className="w-5 h-5" />}
      size="lg"
      footer={
        <IOSButton variant="tertiary" onClick={onClose}>
          取消
        </IOSButton>
      }
    >
      {loading ? (
        <div className="text-center py-8 text-[var(--ios-text-secondary)]">加载备份列表中...</div>
      ) : backups.length === 0 ? (
        <div className="text-center py-8 text-[var(--ios-text-secondary)]">
          <FileJson className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>没有找到备份文件</p>
          <p className="text-sm mt-1">备份目录: ~/.api-hub-management-tools/</p>
        </div>
      ) : (
        <>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {backups.map((backup, index) => (
              <button
                key={backup.filename}
                onClick={() => onSelect(backup)}
                className="w-full text-left p-4 rounded-[var(--radius-md)] border border-[var(--ios-separator)] hover:border-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/5 transition-all duration-[var(--duration-fast)] group"
              >
                <div className="flex items-center gap-3">
                  <FileJson className="w-8 h-8 text-[var(--ios-blue)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[var(--ios-text-primary)] truncate">
                      {backup.filename}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-[var(--ios-text-secondary)] mt-1">
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
                    <span className="px-2 py-0.5 text-xs bg-[var(--ios-green)]/20 text-[var(--ios-green)] rounded-[var(--radius-sm)]">
                      最新
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--ios-text-tertiary)] text-center mt-4 pt-4 border-t border-[var(--ios-separator)]">
            选择一个备份文件来恢复站点配置。恢复前会自动备份当前配置。
          </p>
        </>
      )}
    </IOSModal>
  );
}
