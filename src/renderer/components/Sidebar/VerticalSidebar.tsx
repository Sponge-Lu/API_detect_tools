/**
 * 垂直侧边栏导航
 * 输入: activeTab, onTabChange, saving, updateInfo
 * 输出: 左侧竖向 tab 导航（含路由分组）
 * 定位: 展示层 - 主导航组件
 */

import { useState, useCallback } from 'react';
import {
  Server,
  Terminal,
  Coins,
  Settings,
  Loader2,
  Download,
  Layers,
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { UpdateCheckResult } from '../../hooks/useUpdate';
import type { TabId } from '../../store/uiStore';
import { isRouteTab } from '../../store/uiStore';
import { LDC_UI_VISIBILITY } from '../../../shared/constants';

interface SidebarItem {
  id: TabId;
  label: string;
  icon: typeof Server;
  children?: { id: TabId; label: string; icon: typeof Server }[];
}

const sidebarItems: SidebarItem[] = [
  { id: 'sites', label: '站点管理', icon: Server },
  { id: 'cli', label: '自定义CLI', icon: Terminal },
  {
    id: 'redirection',
    label: '路由',
    icon: Layers,
    children: [
      { id: 'redirection', label: '模型重定向', icon: Layers },
      { id: 'usability', label: 'CLI 可用性', icon: Activity },
      { id: 'proxystats', label: '代理&统计', icon: BarChart3 },
    ],
  },
  { id: 'credit', label: 'LDC 积分', icon: Coins },
  { id: 'settings', label: '设置', icon: Settings },
];

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
  const visibleSidebarItems = sidebarItems.filter(
    item => LDC_UI_VISIBILITY.showCreditTab || item.id !== 'credit'
  );
  const [routeExpanded, setRouteExpanded] = useState(() => isRouteTab(activeTab));

  const handleClick = useCallback(
    (item: SidebarItem) => {
      if (item.children) {
        if (!routeExpanded) {
          setRouteExpanded(true);
          onTabChange(item.children[0].id);
        } else if (isRouteTab(activeTab)) {
          setRouteExpanded(false);
        } else {
          setRouteExpanded(true);
          onTabChange(item.children[0].id);
        }
      } else {
        onTabChange(item.id);
      }
    },
    [activeTab, routeExpanded, onTabChange]
  );

  const showDownloadButton = updateInfo?.hasUpdate && updateInfo?.releaseInfo?.downloadUrl;
  const newVersion = updateInfo?.releaseInfo?.version || updateInfo?.latestVersion;

  return (
    <aside className="w-[180px] shrink-0 h-full flex flex-col bg-gray-50/80 dark:bg-[#1c1c1e]/90 border-r border-gray-200/80 dark:border-white/[0.08]">
      {/* 标题区 / 拖拽区 */}
      <div
        className="h-12 flex items-center px-4 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-[13px] font-semibold text-gray-600 dark:text-gray-300">API Hub</span>
        {saving && <Loader2 className="w-3 h-3 ml-2 animate-spin text-gray-400" />}
      </div>

      {/* 导航区 */}
      <nav
        className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {visibleSidebarItems.map(item => {
          if (item.children) {
            const isGroupActive = isRouteTab(activeTab);
            return (
              <div key={item.id}>
                <button
                  onClick={() => handleClick(item)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    isGroupActive && !routeExpanded
                      ? 'text-[var(--ios-blue)] bg-blue-50/80 dark:bg-blue-500/10'
                      : isGroupActive
                        ? 'text-[var(--ios-blue)]'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" strokeWidth={isGroupActive ? 2 : 1.5} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {routeExpanded ? (
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-gray-400" />
                  )}
                </button>
                {routeExpanded && (
                  <div className="ml-3 mt-0.5 space-y-0.5">
                    {item.children.map(child => {
                      const isActive = activeTab === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => onTabChange(child.id)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${
                            isActive
                              ? 'text-[var(--ios-blue)] font-semibold bg-blue-50/80 dark:bg-blue-500/10'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                          }`}
                        >
                          <child.icon
                            className="w-3.5 h-3.5 shrink-0"
                            strokeWidth={isActive ? 2 : 1.5}
                          />
                          <span>{child.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

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
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 底部：更新提示 */}
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
