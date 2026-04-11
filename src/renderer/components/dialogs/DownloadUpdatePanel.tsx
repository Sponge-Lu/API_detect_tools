/**
 * 输入: DownloadUpdatePanelProps (版本信息、下载状态、回调函数)
 * 输出: React 组件 (下载更新面板 UI)
 * 定位: 展示层 - 下载更新面板，显示 changelog、下载进度和安装按钮
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  Download,
  Calendar,
  Tag,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { ReleaseInfo, DownloadProgress, DownloadPhase } from '../../hooks/useUpdate';
import { AppButton } from '../AppButton/AppButton';
import { AppModal } from '../AppModal/AppModal';

interface DownloadUpdatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
  releaseInfo: ReleaseInfo;
  // 下载相关
  downloadPhase: DownloadPhase;
  downloadProgress: DownloadProgress | null;
  downloadError: string | null;
  onStartDownload: () => void;
  onCancelDownload: () => void;
  onInstall: () => void;
}

export function DownloadUpdatePanel({
  isOpen,
  onClose,
  currentVersion,
  releaseInfo,
  downloadPhase,
  downloadProgress,
  downloadError,
  onStartDownload,
  onCancelDownload,
  onInstall,
}: DownloadUpdatePanelProps) {
  if (!isOpen) return null;

  // 格式化发布日期
  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // 格式化文件大小
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // 格式化速度
  const formatSpeed = (bytesPerSecond: number) => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  // 渲染不同阶段的内容
  const renderContent = () => {
    // 阶段 1: Changelog 展示
    if (downloadPhase === 'idle') {
      return (
        <>
          {/* 版本信息 */}
          <div className="border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-secondary)]">当前版本</span>
                <span className="rounded bg-[var(--surface-3)] px-2 py-1 text-sm font-mono text-[var(--text-secondary)]">
                  v{currentVersion}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <span className="text-lg">→</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-secondary)]">最新版本</span>
                <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-sm font-mono font-semibold text-[var(--accent)]">
                  v{releaseInfo.version}
                </span>
              </div>
            </div>
          </div>

          {/* 发布日期 */}
          <div className="flex items-center gap-2 border-b border-[var(--line-soft)] px-6 py-3 text-sm text-[var(--text-secondary)]">
            <Calendar className="w-4 h-4" />
            <span>发布日期：{formatDate(releaseInfo.releaseDate)}</span>
          </div>

          {/* 更新说明 */}
          <div className="px-6 py-4 flex-1 overflow-hidden flex flex-col">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <FileText className="w-4 h-4" />
              <span>更新说明</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-none">
                <pre className="whitespace-pre-wrap rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] p-4 font-sans text-sm leading-relaxed text-[var(--text-secondary)]">
                  {releaseInfo.releaseNotes || '暂无更新说明'}
                </pre>
              </div>
            </div>
          </div>
        </>
      );
    }

    // 阶段 2: 下载中
    if (downloadPhase === 'downloading') {
      return (
        <>
          <div className="px-6 py-8 flex-1 flex flex-col items-center justify-center">
            <div className="w-full max-w-md">
              {/* 下载图标 */}
              <div className="flex justify-center mb-6">
                <div className="relative">
                  <Download className="w-16 h-16 text-[var(--accent)]" />
                  <Loader2 className="absolute -bottom-1 -right-1 w-6 h-6 animate-spin text-[var(--accent)]" />
                </div>
              </div>

              {/* 下载进度 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    正在下载更新...
                  </span>
                  <span className="text-sm font-mono font-semibold text-[var(--accent)]">
                    {downloadProgress?.percent.toFixed(1) || 0}%
                  </span>
                </div>
                {/* 进度条 */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-300 ease-out"
                    style={{ width: `${downloadProgress?.percent || 0}%` }}
                  />
                </div>
              </div>

              {/* 下载详情 */}
              {downloadProgress && (
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex justify-between">
                    <span>已下载</span>
                    <span className="font-mono">
                      {formatBytes(downloadProgress.transferred)} /{' '}
                      {formatBytes(downloadProgress.total)}
                    </span>
                  </div>
                  {downloadProgress.speed > 0 && (
                    <div className="flex justify-between">
                      <span>下载速度</span>
                      <span className="font-mono">{formatSpeed(downloadProgress.speed)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      );
    }

    // 阶段 3: 下载完成
    if (downloadPhase === 'completed') {
      return (
        <>
          <div className="px-6 py-8 flex-1 flex flex-col items-center justify-center">
            <div className="w-full max-w-md text-center">
              {/* 成功图标 */}
              <div className="flex justify-center mb-6">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--success-soft)]">
                  <CheckCircle2 className="w-12 h-12 text-[var(--success)]" />
                </div>
              </div>

              {/* 成功提示 */}
              <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">下载完成</h3>
              <p className="mb-6 text-sm text-[var(--text-secondary)]">
                更新包已下载完成，点击下方按钮开始安装
              </p>

              {/* 版本信息 */}
              <div className="inline-flex items-center gap-2 rounded-lg bg-[var(--surface-2)] px-4 py-2 text-sm">
                <Tag className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-[var(--text-primary)]">
                  v{currentVersion} → v{releaseInfo.version}
                </span>
              </div>
            </div>
          </div>
        </>
      );
    }

    // 阶段 4: 错误
    if (downloadPhase === 'error') {
      return (
        <>
          <div className="px-6 py-8 flex-1 flex flex-col items-center justify-center">
            <div className="w-full max-w-md text-center">
              {/* 错误图标 */}
              <div className="flex justify-center mb-6">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--danger-soft)]">
                  <AlertCircle className="w-12 h-12 text-[var(--danger)]" />
                </div>
              </div>

              {/* 错误提示 */}
              <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">下载失败</h3>
              <p className="mb-6 text-sm text-[var(--danger)]">{downloadError || '未知错误'}</p>
            </div>
          </div>
        </>
      );
    }

    return null;
  };

  const renderFooter = () => {
    if (downloadPhase === 'idle') {
      return (
        <>
          <AppButton variant="tertiary" onClick={onClose}>
            稍后再说
          </AppButton>
          <AppButton variant="primary" onClick={onStartDownload}>
            <Download className="w-4 h-4" />
            开始更新
          </AppButton>
        </>
      );
    }

    if (downloadPhase === 'downloading') {
      return (
        <AppButton variant="tertiary" onClick={onCancelDownload}>
          取消下载
        </AppButton>
      );
    }

    if (downloadPhase === 'completed') {
      return (
        <>
          <AppButton variant="tertiary" onClick={onClose}>
            稍后安装
          </AppButton>
          <AppButton
            variant="primary"
            onClick={onInstall}
            className="bg-[var(--success)] hover:opacity-90"
          >
            <CheckCircle2 className="w-4 h-4" />
            立即安装
          </AppButton>
        </>
      );
    }

    if (downloadPhase === 'error') {
      return (
        <>
          <AppButton variant="tertiary" onClick={onClose}>
            关闭
          </AppButton>
          <AppButton variant="primary" onClick={onStartDownload}>
            <Download className="w-4 h-4" />
            重试
          </AppButton>
        </>
      );
    }

    return null;
  };

  const panelTitle =
    downloadPhase === 'idle'
      ? releaseInfo.isPreRelease
        ? '发现预发布版本'
        : '发现新版本'
      : downloadPhase === 'downloading'
        ? '正在下载更新'
        : downloadPhase === 'completed'
          ? '下载完成'
          : '下载失败';

  const panelIcon =
    downloadPhase === 'downloading' ? (
      <Download className="w-5 h-5" />
    ) : downloadPhase === 'completed' ? (
      <CheckCircle2 className="w-5 h-5" />
    ) : downloadPhase === 'error' ? (
      <AlertCircle className="w-5 h-5" />
    ) : (
      <Tag className="w-5 h-5" />
    );

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title={panelTitle}
      titleIcon={panelIcon}
      footer={renderFooter()}
      size="lg"
      closeOnOverlayClick={false}
      closeOnEsc={false}
      contentClassName="!p-0 !max-h-[72vh] flex flex-col"
    >
      {renderContent()}
    </AppModal>
  );
}
