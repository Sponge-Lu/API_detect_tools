/**
 * 软件更新对话框
 * 显示新版本信息、更新说明和下载链接
 */

import { X, Download, Calendar, Tag, FileText, ExternalLink } from 'lucide-react';
import { ReleaseInfo } from '../../hooks/useUpdate';

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
  releaseInfo: ReleaseInfo;
  onDownload: () => void;
}

export function UpdateDialog({
  isOpen,
  onClose,
  currentVersion,
  releaseInfo,
  onDownload,
}: UpdateDialogProps) {
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-card rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border bg-gradient-to-r ${releaseInfo.isPreRelease ? 'from-amber-500 to-amber-600' : 'from-primary-500 to-primary-600'}`}
        >
          <div className="flex items-center gap-2 text-white">
            <Tag className="w-5 h-5" />
            <h2 className="text-lg font-semibold">
              {releaseInfo.isPreRelease ? '发现预发布版本' : '发现新版本'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

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
        <div className="px-6 py-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
            <FileText className="w-4 h-4" />
            <span>更新说明</span>
          </div>
          <div className="max-h-60 overflow-y-auto">
            <div className="prose prose-sm dark:prose-invert prose-slate max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 font-sans leading-relaxed">
                {releaseInfo.releaseNotes || '暂无更新说明'}
              </pre>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-light-border dark:border-dark-border">
          <a
            href={releaseInfo.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-primary-500 transition-colors"
            onClick={e => {
              e.preventDefault();
              window.electronAPI?.update?.openDownload(releaseInfo.htmlUrl);
            }}
          >
            <ExternalLink className="w-4 h-4" />
            查看详情
          </a>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
            >
              稍后再说
            </button>
            <button
              onClick={onDownload}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-all flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              立即下载
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
