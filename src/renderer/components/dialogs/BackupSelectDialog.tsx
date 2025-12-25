/**
 * 输入: BackupSelectDialogProps (备份列表、加载状态、选择/关闭回调)
 * 输出: React 组件 (备份选择对话框 UI)
 * 定位: 展示层 - 备份选择对话框，从备份目录选择配置文件进行恢复
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { X, FileJson, Clock, HardDrive } from 'lucide-react';

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
  if (!isOpen) return null;

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-card rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border">
          <h2 className="text-lg font-semibold text-light-text dark:text-dark-text">
            选择备份文件恢复
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-slate-500">加载备份列表中...</div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <FileJson className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>没有找到备份文件</p>
              <p className="text-sm mt-1">备份目录: ~/.api-hub-management-tools/</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {backups.map((backup, index) => (
                <button
                  key={backup.filename}
                  onClick={() => onSelect(backup)}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <FileJson className="w-8 h-8 text-primary-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {backup.filename}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
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
                      <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">
                        最新
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-slate-800/50">
          <p className="text-xs text-slate-500 text-center">
            选择一个备份文件来恢复站点配置。恢复前会自动备份当前配置。
          </p>
        </div>
      </div>
    </div>
  );
}
