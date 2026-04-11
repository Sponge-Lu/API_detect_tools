/**
 * 垂直侧边栏导航
 * 输入: activeTab, onTabChange, saving, updateInfo
 * 输出: 左侧竖向 tab 导航（一级页面导航）
 * 定位: 展示层 - 主导航组件
 */

import type { CSSProperties } from 'react';
import {
  ChevronLeft,
  Download,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  TerminalSquare,
} from 'lucide-react';
import { CliConfigStatusPanel } from '../CliConfigStatus';
import type { UpdateCheckResult } from '../../hooks/useUpdate';
import { useUIStore } from '../../store/uiStore';
import type { SidebarDisplayMode, TabId } from '../../store/uiStore';
import { APP_PAGE_META, APP_PAGE_ORDER } from '../AppShell/pageMeta';

interface VerticalSidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  saving: boolean;
  currentVersion?: string;
  updateInfo?: UpdateCheckResult | null;
  onDownloadUpdate?: () => Promise<void>;
}

export function VerticalSidebar({
  activeTab,
  onTabChange,
  saving,
  currentVersion,
  updateInfo,
  onDownloadUpdate,
}: VerticalSidebarProps) {
  const uiState = useUIStore() as {
    sidebarDisplayMode?: SidebarDisplayMode;
    toggleSidebarDisplayMode?: () => void;
    setSidebarDisplayMode?: (mode: SidebarDisplayMode) => void;
  };
  const sidebarDisplayMode = uiState.sidebarDisplayMode ?? 'expanded';
  const toggleSidebarDisplayMode = uiState.toggleSidebarDisplayMode ?? (() => undefined);
  const setSidebarDisplayMode = uiState.setSidebarDisplayMode ?? (() => undefined);
  const visibleSidebarItems = APP_PAGE_ORDER.map(id => APP_PAGE_META[id]);
  const showDownloadButton = updateInfo?.hasUpdate && updateInfo?.releaseInfo?.downloadUrl;
  const newVersion = updateInfo?.releaseInfo?.version || updateInfo?.latestVersion;
  const isIconOnly = sidebarDisplayMode === 'icon-only';
  const sidebarWidthClass = isIconOnly ? 'w-[68px]' : 'w-[140px]';
  const versionLabel = currentVersion ? `版本 v${currentVersion}` : '版本信息';

  return (
    <aside
      data-testid="vertical-sidebar"
      className={`flex h-full shrink-0 flex-col border-r border-[var(--line-soft)] bg-[var(--surface-2)]/80 transition-[width] duration-[var(--duration-fast)] ${sidebarWidthClass}`}
    >
      <div
        className={`flex h-12 shrink-0 items-center ${isIconOnly ? 'justify-center px-2' : 'justify-between px-3'}`}
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        {!isIconOnly ? (
          <div className="flex min-w-0 items-center">
            <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
              API Hub
            </span>
            {saving && (
              <Loader2 className="ml-2 h-3 w-3 animate-spin text-[var(--text-tertiary)]" />
            )}
          </div>
        ) : saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />
        ) : null}
        <button
          type="button"
          aria-label="切换侧栏显示模式"
          title={isIconOnly ? '切换为图标和文字导航' : '切换为仅图标导航'}
          onClick={toggleSidebarDisplayMode}
          className={`rounded-md border border-[var(--line-soft)] bg-[var(--surface-1)]/86 p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] ${isIconOnly ? 'absolute top-3' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          {isIconOnly ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <nav
        className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        {visibleSidebarItems.map(item => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.navLabel}
              title={item.navLabel}
              onClick={() => onTabChange(item.id)}
              className={`flex w-full items-center rounded-lg py-2 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)]'
              } ${isIconOnly ? 'justify-center px-2' : 'px-3'}`}
            >
              <item.icon className="w-4 h-4 shrink-0" strokeWidth={isActive ? 2 : 1.5} />
              <span
                aria-hidden={isIconOnly}
                className={`overflow-hidden whitespace-nowrap text-left transition-[max-width,opacity,margin] duration-[var(--duration-fast)] [transition-timing-function:var(--ease-standard)] ${
                  isIconOnly ? 'ml-0 max-w-0 opacity-0' : 'ml-2 max-w-[84px] opacity-100 delay-75'
                }`}
              >
                {item.navLabel}
              </span>
            </button>
          );
        })}
      </nav>

      <div data-testid="sidebar-footer" className="border-t border-[var(--line-soft)] px-2 py-2">
        <div
          data-testid="sidebar-cli-block"
          className={`overflow-hidden transition-[max-height,opacity,margin] duration-[var(--duration-fast)] [transition-timing-function:var(--ease-standard)] ${
            isIconOnly ? 'mb-0 max-h-0 opacity-0' : 'mb-2 max-h-[220px] opacity-100 delay-75'
          }`}
        >
          {!isIconOnly ? (
            <div>
              <CliConfigStatusPanel layout="stacked" compact showRefresh showEdit showReset />
            </div>
          ) : null}
        </div>

        {isIconOnly ? (
          <button
            type="button"
            aria-label="打开本地 CLI 配置"
            title="打开本地 CLI 配置"
            onClick={() => setSidebarDisplayMode('expanded')}
            className="mb-2 flex w-full items-center justify-center rounded-lg border border-[var(--line-soft)] bg-[var(--surface-1)]/86 px-2 py-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)]"
          >
            <TerminalSquare className="h-4 w-4" />
          </button>
        ) : null}

        <div
          data-testid="sidebar-footer-separator"
          className={`-mx-2 border-t border-[var(--line-soft)] px-2 ${isIconOnly ? 'mb-2 pt-2' : 'mb-2 pt-2'}`}
        >
          {!isIconOnly ? (
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
              <ChevronLeft className="h-3 w-3 rotate-[-90deg]" />
              <span>{versionLabel}</span>
            </div>
          ) : currentVersion ? (
            <div
              className="text-center text-[10px] font-medium text-[var(--text-tertiary)]"
              title={versionLabel}
            >
              v{currentVersion}
            </div>
          ) : null}
        </div>

        {showDownloadButton && (
          <button
            type="button"
            aria-label={`更新 v${newVersion}`}
            title={`更新 v${newVersion}`}
            onClick={onDownloadUpdate}
            className={`flex w-full items-center rounded-lg bg-[var(--success-soft)] py-2 text-[11px] font-medium text-[var(--success)] transition-colors hover:opacity-90 ${isIconOnly ? 'justify-center px-2' : 'gap-2 px-3'}`}
          >
            <Download className="w-3.5 h-3.5" />
            {!isIconOnly ? <span>更新 v{newVersion}</span> : null}
          </button>
        )}
      </div>
    </aside>
  );
}
