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
  X,
  Download,
  Calendar,
  Tag,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { ReleaseInfo, DownloadProgress, DownloadPhase } from '../../hooks/useUpdate';

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
          <div className="px-6 py-4 border-b border-light-border dark:border-dark-border bg-slate-50 dark:bg-slate-800/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500 dark:text-slate-400">当前版本</span>
                <span className="px-2 py-1 text-sm font-mono bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded">
                  v{currentVersion}
                </span>
              </div>
              <div className="flex items-center gap-2 text-primary-500">
                <span className="text-lg">→</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500 dark:text-slate-400">最新版本</span>
                <span className="px-2 py-1 text-sm font-mono bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded font-semibold">
                  v{releaseInfo.version}
                </span>
              </div>
            </div>
          </div>

          {/* 发布日期 */}
          <div className="px-6 py-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 border-b border-light-border dark:border-dark-border">
            <Calendar className="w-4 h-4" />
            <span>发布日期：{formatDate(releaseInfo.releaseDate)}</span>
          </div>

          {/* 更新说明 */}
          <div className="px-6 py-4 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              <FileText className="w-4 h-4" />
              <span>更新说明</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="prose prose-sm dark:prose-invert prose-slate max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 font-sans leading-relaxed">
                  {releaseInfo.releaseNotes || '暂无更新说明'}
                </pre>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-light-border dark:border-dark-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
            >
              稍后再说
            </button>
            <button
              onClick={onStartDownload}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-all flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              开始更新
            </button>
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
                  <Download className="w-16 h-16 text-primary-500" />
                  <Loader2 className="w-6 h-6 text-primary-500 animate-spin absolute -bottom-1 -right-1" />
                </div>
              </div>

              {/* 下载进度 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    正在下载更新...
                  </span>
                  <span className="text-sm font-mono font-semibold text-primary-600 dark:text-primary-400">
                    {downloadProgress?.percent.toFixed(1) || 0}%
                  </span>
                </div>
                {/* 进度条 */}
                <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-300 ease-out"
                    style={{ width: `${downloadProgress?.percent || 0}%` }}
                  />
                </div>
              </div>

              {/* 下载详情 */}
              {downloadProgress && (
                <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
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

          {/* 取消按钮 */}
          <div className="flex items-center justify-center px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-light-border dark:border-dark-border">
            <button
              onClick={onCancelDownload}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
            >
              取消下载
            </button>
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
                <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                </div>
              </div>

              {/* 成功提示 */}
              <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
                下载完成
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                更新包已下载完成，点击下方按钮开始安装
              </p>

              {/* 版本信息 */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm">
                <Tag className="w-4 h-4 text-primary-500" />
                <span className="text-slate-700 dark:text-slate-300">
                  v{currentVersion} → v{releaseInfo.version}
                </span>
              </div>
            </div>
          </div>

          {/* 安装按钮 */}
          <div className="flex items-center justify-center gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-light-border dark:border-dark-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
            >
              稍后安装
            </button>
            <button
              onClick={onInstall}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-all flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              立即安装
            </button>
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
                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-12 h-12 text-red-500" />
                </div>
              </div>

              {/* 错误提示 */}
              <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
                下载失败
              </h3>
              <p className="text-sm text-red-600 dark:text-red-400 mb-6">
                {downloadError || '未知错误'}
              </p>
            </div>
          </div>

          {/* 重试按钮 */}
          <div className="flex items-center justify-center gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-light-border dark:border-dark-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
            >
              关闭
            </button>
            <button
              onClick={onStartDownload}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-all flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              重试
            </button>
          </div>
        </>
      );
    }

    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-card rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border bg-gradient-to-r ${
            releaseInfo.isPreRelease
              ? 'from-amber-500 to-amber-600'
              : 'from-primary-500 to-primary-600'
          }`}
        >
          <div className="flex items-center gap-2 text-white">
            <Tag className="w-5 h-5" />
            <h2 className="text-lg font-semibold">
              {downloadPhase === 'idle' &&
                (releaseInfo.isPreRelease ? '发现预发布版本' : '发现新版本')}
              {downloadPhase === 'downloading' && '正在下载更新'}
              {downloadPhase === 'completed' && '下载完成'}
              {downloadPhase === 'error' && '下载失败'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* 动态内容 */}
        {renderContent()}
      </div>
    </div>
  );
}
