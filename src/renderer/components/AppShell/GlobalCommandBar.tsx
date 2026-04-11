import type { CSSProperties } from 'react';
import { Loader2 } from 'lucide-react';
import type { UpdateCheckResult } from '../../hooks/useUpdate';

export interface GlobalCommandBarProps {
  saving: boolean;
  updateInfo?: UpdateCheckResult | null;
  onDownloadUpdate?: () => Promise<void>;
  isDownloading?: boolean;
}

export function GlobalCommandBar({
  saving,
  updateInfo: _updateInfo,
  onDownloadUpdate: _onDownloadUpdate,
  isDownloading: _isDownloading = false,
}: GlobalCommandBarProps) {
  if (!saving) {
    return null;
  }

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
        {saving && (
          <div className="flex items-center gap-1.5 rounded-md bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>保存中...</span>
          </div>
        )}
      </div>
    </header>
  );
}
