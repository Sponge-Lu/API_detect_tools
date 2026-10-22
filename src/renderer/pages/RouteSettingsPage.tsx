/**
 * 路由设置页
 * 输入: RouteSessionSection (按客户端分组的双模式路由卡片列), ModelRedirectionTab (模型映射工作区)
 * 输出: 两个独立卡片区域的合并布局
 * 定位: 展示层 - 路由设置页入口
 */

import type { ReactNode } from 'react';
import { ModelRedirectionTab } from '../components/Route/Redirection/ModelRedirectionTab';
import { RouteSessionSection } from '../components/Route/RouteSessionSection';
import { useUIStore } from '../store/uiStore';

interface RouteSettingsPageProps {
  setPageHeaderActions?: (actions: ReactNode | null) => void;
}

export function RouteSettingsPage({ setPageHeaderActions }: RouteSettingsPageProps) {
  const isActive = useUIStore(state => state.activeTab === 'config-files');

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(240px,280px)_minmax(0,1fr)] gap-3 overflow-hidden px-6 py-4">
      <RouteSessionSection mini />
      <ModelRedirectionTab
        isActive={isActive}
        className="h-full min-h-0 min-w-0"
        setPageHeaderActions={setPageHeaderActions}
      />
    </div>
  );
}
