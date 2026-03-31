/**
 * 垂直侧边栏导航
 * 输入: activeTab, onTabChange, saving, updateInfo
 * 输出: 左侧竖向 tab 导航（一级页面导航）
 * 定位: 展示层 - 主导航组件
 */

import type { CSSProperties } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { UpdateCheckResult } from '../../hooks/useUpdate';
import type { TabId } from '../../store/uiStore';
import { APP_PAGE_META, APP_PAGE_ORDER } from '../AppShell/pageMeta';

interface VerticalSidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  saving: boolean;
  updateInfo?: UpdateCheckResult | null;
  onDownloadUpdate?: () => Promise<void>;
}

export function VerticalSidebar({
  activeTab,
  onTabChange,
  saving,
  updateInfo,
  onDownloadUpdate,
}: VerticalSidebarProps) {
  const visibleSidebarItems = APP_PAGE_ORDER.map(id => APP_PAGE_META[id]);
  const showDownloadButton = updateInfo?.hasUpdate && updateInfo?.releaseInfo?.downloadUrl;
  const newVersion = updateInfo?.releaseInfo?.version || updateInfo?.latestVersion;

  return (
    <aside className="w-[180px] shrink-0 h-full flex flex-col bg-gray-50/80 dark:bg-[#1c1c1e]/90 border-r border-gray-200/80 dark:border-white/[0.08]">
      <div
        className="h-12 flex items-center px-4 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <span className="text-[13px] font-semibold text-gray-600 dark:text-gray-300">API Hub</span>
        {saving && <Loader2 className="w-3 h-3 ml-2 animate-spin text-gray-400" />}
      </div>

      <nav
        className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        {visibleSidebarItems.map(item => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                isActive
                  ? 'text-[var(--ios-blue)] font-semibold bg-blue-50/80 dark:bg-blue-500/10'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              <item.icon className="w-4 h-4 shrink-0" strokeWidth={isActive ? 2 : 1.5} />
              <span>{item.navLabel}</span>
            </button>
          );
        })}
      </nav>

      {showDownloadButton && (
        <div className="px-2 py-2 border-t border-gray-200/80 dark:border-white/[0.08]">
          <button
            onClick={onDownloadUpdate}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>更新 v{newVersion}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
