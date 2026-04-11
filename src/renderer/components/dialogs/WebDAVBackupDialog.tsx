/**
 * 输入: WebDAVBackupDialogProps (WebDAV 配置、备份列表、操作回调)
 * 输出: React 组件 (WebDAV 备份管理对话框 UI)
 * 定位: 展示层 - WebDAV 备份管理对话框，支持上传、恢复、删除操作
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  FileJson,
  Clock,
  HardDrive,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import type { WebDAVBackupInfo } from '../../../shared/types/site';
import { AppModal } from '../AppModal/AppModal';
import { ConfirmDialog } from '../ConfirmDialog';

interface WebDAVBackupDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// 确认对话框状态
interface ConfirmState {
  isOpen: boolean;
  type: 'restore' | 'delete';
  backup: WebDAVBackupInfo | null;
}

export function WebDAVBackupDialog({ isOpen, onClose }: WebDAVBackupDialogProps) {
  const [backups, setBackups] = useState<WebDAVBackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationResult, setOperationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>({
    isOpen: false,
    type: 'restore',
    backup: null,
  });
  const [processingBackup, setProcessingBackup] = useState<string | null>(null);

  // 格式化日期
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 加载备份列表
  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.webdav?.listBackups();
      if (result?.success && result.data) {
        setBackups(result.data);
      } else {
        setError(result?.error || '获取备份列表失败');
        setBackups([]);
      }
    } catch (err: any) {
      setError(err.message || '连接 WebDAV 服务器失败');
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开对话框时加载备份列表
  useEffect(() => {
    if (isOpen) {
      loadBackups();
      setOperationResult(null);
    }
  }, [isOpen, loadBackups]);

  // 上传备份
  const handleUpload = async () => {
    setUploading(true);
    setOperationResult(null);
    try {
      const result = await window.electronAPI.webdav?.uploadBackup();
      if (result?.success) {
        setOperationResult({
          success: true,
          message: `备份上传成功: ${result.data}`,
        });
        // 刷新列表
        await loadBackups();
      } else {
        setOperationResult({
          success: false,
          message: result?.error || '上传失败',
        });
      }
    } catch (err: any) {
      setOperationResult({
        success: false,
        message: err.message || '上传备份失败',
      });
    } finally {
      setUploading(false);
    }
  };

  // 恢复备份
  const handleRestore = async (backup: WebDAVBackupInfo) => {
    setProcessingBackup(backup.filename);
    setOperationResult(null);
    try {
      const result = await window.electronAPI.webdav?.restoreBackup(backup.filename);
      if (result?.success) {
        setOperationResult({
          success: true,
          message: '配置已恢复，请刷新页面查看更新',
        });
      } else {
        setOperationResult({
          success: false,
          message: result?.error || '恢复失败',
        });
      }
    } catch (err: any) {
      setOperationResult({
        success: false,
        message: err.message || '恢复备份失败',
      });
    } finally {
      setProcessingBackup(null);
      setConfirm({ isOpen: false, type: 'restore', backup: null });
    }
  };

  // 删除备份
  const handleDelete = async (backup: WebDAVBackupInfo) => {
    setProcessingBackup(backup.filename);
    setOperationResult(null);
    try {
      const result = await window.electronAPI.webdav?.deleteBackup(backup.filename);
      if (result?.success) {
        setOperationResult({
          success: true,
          message: `已删除: ${backup.filename}`,
        });
        // 刷新列表
        await loadBackups();
      } else {
        setOperationResult({
          success: false,
          message: result?.error || '删除失败',
        });
      }
    } catch (err: any) {
      setOperationResult({
        success: false,
        message: err.message || '删除备份失败',
      });
    } finally {
      setProcessingBackup(null);
      setConfirm({ isOpen: false, type: 'delete', backup: null });
    }
  };

  // 打开确认对话框
  const openConfirm = (type: 'restore' | 'delete', backup: WebDAVBackupInfo) => {
    setConfirm({ isOpen: true, type, backup });
  };

  // 关闭确认对话框
  const closeConfirm = () => {
    setConfirm({ isOpen: false, type: 'restore', backup: null });
  };

  // 确认操作
  const handleConfirm = () => {
    if (!confirm.backup) return;
    if (confirm.type === 'restore') {
      handleRestore(confirm.backup);
    } else {
      handleDelete(confirm.backup);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <AppModal
        isOpen={isOpen}
        onClose={onClose}
        title="WebDAV 云端备份"
        titleIcon={<Cloud className="h-5 w-5" />}
        size="xl"
        className="max-w-2xl"
        contentClassName="space-y-4"
        footer={
          <p className="w-full text-center text-xs text-[var(--text-secondary)]">
            备份文件存储在 WebDAV 服务器的配置路径中。恢复前会自动备份当前配置。
          </p>
        }
      >
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)]/72 p-3">
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || loading}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                上传备份
              </>
            )}
          </button>
          <button
            type="button"
            onClick={loadBackups}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </button>
        </div>

        {operationResult ? (
          <div
            className={`flex items-center gap-2 rounded-[var(--radius-lg)] px-4 py-3 text-sm ${
              operationResult.success
                ? 'bg-[var(--success-soft)] text-[var(--success)]'
                : 'bg-[var(--danger-soft)] text-[var(--danger)]'
            }`}
          >
            {operationResult.success ? (
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
            )}
            {operationResult.message}
          </div>
        ) : null}

        {loading ? (
          <div className="py-12 text-center text-[var(--text-secondary)]">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-[var(--accent)]" />
            <p>加载备份列表中...</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <AlertCircle className="mx-auto mb-3 h-12 w-12 text-[var(--danger)]" />
            <p className="text-[var(--danger)]">{error}</p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">请检查 WebDAV 配置是否正确</p>
          </div>
        ) : backups.length === 0 ? (
          <div className="py-12 text-center text-[var(--text-secondary)]">
            <FileJson className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p>没有找到云端备份</p>
            <p className="mt-1 text-sm">点击"上传备份"将当前配置备份到云端</p>
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((backup, index) => (
              <div
                key={backup.filename}
                className="group flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-3 transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-2)]"
              >
                <FileJson className="h-8 w-8 flex-shrink-0 text-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {backup.filename}
                    </span>
                    {index === 0 ? (
                      <span className="rounded bg-[var(--success-soft)] px-2 py-0.5 text-xs text-[var(--success)]">
                        最新
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(backup.lastModified)}
                    </span>
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {formatSize(backup.size)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => openConfirm('restore', backup)}
                    disabled={processingBackup === backup.filename}
                    className="rounded-[var(--radius-md)] p-2 text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    aria-label="恢复此备份"
                    title="恢复此备份"
                  >
                    {processingBackup === backup.filename ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openConfirm('delete', backup)}
                    disabled={processingBackup === backup.filename}
                    className="rounded-[var(--radius-md)] p-2 text-[var(--danger)] transition-colors hover:bg-[var(--danger-soft)] disabled:opacity-50"
                    aria-label="删除此备份"
                    title="删除此备份"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AppModal>

      {confirm.isOpen && confirm.backup ? (
        <ConfirmDialog
          isOpen={confirm.isOpen}
          type={confirm.type === 'delete' ? 'warning' : 'confirm'}
          title={confirm.type === 'restore' ? '确认恢复' : '确认删除'}
          message={
            confirm.type === 'restore'
              ? `确定要恢复备份 ${confirm.backup.filename} 吗？`
              : `确定要删除备份 ${confirm.backup.filename} 吗？`
          }
          content={
            <p className="mt-3 text-sm text-[var(--text-secondary)]">
              {confirm.type === 'restore'
                ? '当前配置将被覆盖，但会先自动备份。'
                : '此操作无法撤销。'}
            </p>
          }
          confirmText={confirm.type === 'restore' ? '确认恢复' : '确认删除'}
          cancelText="取消"
          overlayZIndexClassName="z-[220]"
          onConfirm={handleConfirm}
          onCancel={closeConfirm}
        />
      ) : null}
    </>
  );
}
