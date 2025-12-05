/**
 * WebDAV 备份管理对话框
 * 显示云端备份列表，支持上传、恢复、删除操作
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X,
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
import { WebDAVBackupInfo } from '../../../shared/types/site';

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary-500" />
            <h2 className="text-lg font-semibold text-light-text dark:text-dark-text">
              WebDAV 云端备份
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* 操作栏 */}
        <div className="px-6 py-3 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-slate-800/50 flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={uploading || loading}
            className="px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:disabled:bg-primary-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                上传备份
              </>
            )}
          </button>
          <button
            onClick={loadBackups}
            disabled={loading}
            className="px-4 py-2 bg-slate-500 hover:bg-slate-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            刷新
          </button>
        </div>

        {/* 操作结果提示 */}
        {operationResult && (
          <div
            className={`mx-6 mt-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
              operationResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}
          >
            {operationResult.success ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            {operationResult.message}
          </div>
        )}

        {/* 备份列表 */}
        <div className="p-6">
          {loading ? (
            <div className="text-center py-12 text-slate-500">
              <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary-500" />
              <p>加载备份列表中...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-400" />
              <p className="text-red-500 dark:text-red-400">{error}</p>
              <p className="text-sm text-slate-500 mt-2">请检查 WebDAV 配置是否正确</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <FileJson className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>没有找到云端备份</p>
              <p className="text-sm mt-1">点击"上传备份"将当前配置备份到云端</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {backups.map((backup, index) => (
                <div
                  key={backup.filename}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-all group"
                >
                  <FileJson className="w-8 h-8 text-primary-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                        {backup.filename}
                      </span>
                      {index === 0 && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">
                          最新
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(backup.lastModified)}
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3" />
                        {formatSize(backup.size)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openConfirm('restore', backup)}
                      disabled={processingBackup === backup.filename}
                      className="p-2 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="恢复此备份"
                    >
                      {processingBackup === backup.filename ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => openConfirm('delete', backup)}
                      disabled={processingBackup === backup.filename}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="删除此备份"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-6 py-4 border-t border-light-border dark:border-dark-border bg-slate-50 dark:bg-slate-800/50">
          <p className="text-xs text-slate-500 text-center">
            备份文件存储在 WebDAV 服务器的配置路径中。恢复前会自动备份当前配置。
          </p>
        </div>
      </div>

      {/* 确认对话框 */}
      {confirm.isOpen && confirm.backup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={closeConfirm} />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <AlertCircle
                className={`w-6 h-6 ${confirm.type === 'delete' ? 'text-red-500' : 'text-primary-500'}`}
              />
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {confirm.type === 'restore' ? '确认恢复' : '确认删除'}
              </h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {confirm.type === 'restore' ? (
                  <>
                    确定要恢复备份 <strong>{confirm.backup.filename}</strong> 吗？
                    <br />
                    <span className="text-slate-500">当前配置将被覆盖，但会先自动备份。</span>
                  </>
                ) : (
                  <>
                    确定要删除备份 <strong>{confirm.backup.filename}</strong> 吗？
                    <br />
                    <span className="text-slate-500">此操作无法撤销。</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={closeConfirm}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-all ${
                  confirm.type === 'delete'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-primary-500 hover:bg-primary-600'
                }`}
              >
                {confirm.type === 'restore' ? '确认恢复' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
