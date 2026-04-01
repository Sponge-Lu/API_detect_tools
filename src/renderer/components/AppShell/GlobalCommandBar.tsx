import type { CSSProperties } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { CliConfigStatusPanel } from '../CliConfigStatus';
import type { UpdateCheckResult } from '../../hooks/useUpdate';
import { AppButton } from '../AppButton/AppButton';

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
      className="z-[100] flex h-[42px] shrink-0 items-center border-b border-[var(--line-soft)] bg-[var(--surface-1)]/90 px-3 backdrop-blur-sm transition-colors duration-200"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <div className="flex-1 min-w-4" />

      <div
        className="flex items-center gap-3 pr-1 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <CliConfigStatusPanel compact showRefresh showEdit showReset />

        {saving && (
          <div className="flex items-center gap-1.5 rounded-md bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>保存中...</span>
          </div>
        )}

        {showDownloadButton && (
          <AppButton
            onClick={handleDownloadClick}
            disabled={isDownloading}
            title={newVersion ? `新版本: v${newVersion}` : '下载更新'}
            aria-label={newVersion ? `下载新版本 v${newVersion}` : '下载更新'}
            size="sm"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            )}
            <span>{isDownloading ? '打开中...' : '下载更新'}</span>
          </AppButton>
        )}
      </div>
    </header>
  );
}
