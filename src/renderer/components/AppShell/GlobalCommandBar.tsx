import type { CSSProperties } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { CliConfigStatusPanel } from '../CliConfigStatus';
import type { UpdateCheckResult } from '../../hooks/useUpdate';

export interface GlobalCommandBarProps {
  saving: boolean;
  updateInfo?: UpdateCheckResult | null;
  onDownloadUpdate?: () => Promise<void>;
  isDownloading?: boolean;
}

export function GlobalCommandBar({
  saving,
  updateInfo,
  onDownloadUpdate,
  isDownloading = false,
}: GlobalCommandBarProps) {
  const showDownloadButton = updateInfo?.hasUpdate && updateInfo?.releaseInfo?.downloadUrl;
  const newVersion = updateInfo?.releaseInfo?.version || updateInfo?.latestVersion;

  const handleDownloadClick = async () => {
    if (onDownloadUpdate && !isDownloading) {
      await onDownloadUpdate();
    }
  };

  return (
    <header
      className="z-[100] shrink-0 h-10 flex items-center px-3 bg-gray-50/80 dark:bg-[#1c1c1e]/90 backdrop-blur-md border-b border-gray-200/80 dark:border-white/[0.08] transition-colors duration-300"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <div className="flex-1 min-w-4" />

      <div
        className="flex items-center gap-3 pr-1 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <CliConfigStatusPanel compact showRefresh showEdit showReset />

        {saving && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-md text-xs font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>保存中...</span>
          </div>
        )}

        {showDownloadButton && (
          <button
            onClick={handleDownloadClick}
            disabled={isDownloading}
            title={newVersion ? `新版本: v${newVersion}` : '下载更新'}
            aria-label={newVersion ? `下载新版本 v${newVersion}` : '下载更新'}
            className="px-3 py-1.5 bg-[var(--ios-blue)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-1.5 text-sm disabled:cursor-not-allowed"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            )}
            <span>{isDownloading ? '打开中...' : '下载更新'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
