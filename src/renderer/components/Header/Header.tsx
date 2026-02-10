/**
 * 输入: HeaderProps (Tab 导航状态、保存状态、更新状态)
 * 输出: React 组件 (统一导航栏 - iOS 连通式 Tab + 状态区)
 * 定位: 展示层 - 提供导航和状态显示
 */

import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { Server, Terminal, Coins, Settings, Loader2, Download } from 'lucide-react';
import { CliConfigStatusPanel } from '../CliConfigStatus';
import type { UpdateCheckResult } from '../../hooks/useUpdate';
import type { TabId } from '../../store/uiStore';

const tabs: { id: TabId; label: string; icon: typeof Server }[] = [
  { id: 'sites', label: '站点管理', icon: Server },
  { id: 'cli', label: '自定义CLI', icon: Terminal },
  { id: 'credit', label: 'LDC 积分', icon: Coins },
  { id: 'settings', label: '设置', icon: Settings },
];

interface HeaderProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  saving: boolean;
  hasUpdate?: boolean;
  updateInfo?: UpdateCheckResult | null;
  onDownloadUpdate?: () => Promise<void>;
  isDownloading?: boolean;
}

export function Header({
  activeTab,
  onTabChange,
  saving,
  updateInfo,
  onDownloadUpdate,
  isDownloading = false,
}: HeaderProps) {
  const showDownloadButton = updateInfo?.hasUpdate && updateInfo?.releaseInfo?.downloadUrl;
  const newVersion = updateInfo?.releaseInfo?.version || updateInfo?.latestVersion;

  const handleDownloadClick = async () => {
    if (onDownloadUpdate && !isDownloading) {
      await onDownloadUpdate();
    }
  };

  // Sliding indicator
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<TabId, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const setTabRef = useCallback(
    (id: TabId) => (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(id, el);
      else tabRefs.current.delete(id);
    },
    []
  );

  useLayoutEffect(() => {
    const activeEl = tabRefs.current.get(activeTab);
    const navEl = navRef.current;
    if (activeEl && navEl) {
      const navRect = navEl.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setIndicator({
        left: tabRect.left - navRect.left,
        width: tabRect.width,
      });
    }
  }, [activeTab]);

  return (
    <header
      className="z-[100] shrink-0 h-11 flex items-stretch bg-light-bg dark:bg-dark-bg border-b border-[var(--ios-separator)]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Tab 导航区 */}
      <nav
        ref={navRef}
        role="tablist"
        aria-label="主导航"
        className="relative flex items-stretch shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Sliding bottom bar indicator */}
        <div
          className="absolute bottom-0 h-[3px] rounded-full bg-[var(--ios-blue)] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
          style={{
            left: indicator.left,
            width: indicator.width,
          }}
        />

        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              ref={setTabRef(id)}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${id}`}
              onClick={() => onTabChange(id)}
              className={`
                relative flex items-center justify-center gap-1.5
                px-5 text-[13px] font-medium
                transition-colors duration-200
                ${
                  isActive
                    ? 'text-[var(--ios-blue)] font-semibold'
                    : 'text-[var(--ios-text-secondary)] hover:text-[var(--ios-text-primary)]'
                }
              `}
              style={{ WebkitUserSelect: 'none' } as React.CSSProperties}
            >
              <Icon
                className={`w-4 h-4 transition-colors duration-200 ${
                  isActive ? 'text-[var(--ios-blue)]' : ''
                }`}
                strokeWidth={isActive ? 2 : 1.5}
                aria-hidden="true"
              />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 分隔区 */}
      <div className="flex-1 min-w-4" />

      {/* 右侧状态区 */}
      <div
        className="flex items-center gap-3 pr-4 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <CliConfigStatusPanel compact showRefresh />

        {saving && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--ios-blue)]/10 text-[var(--ios-blue)] rounded-lg text-xs">
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
