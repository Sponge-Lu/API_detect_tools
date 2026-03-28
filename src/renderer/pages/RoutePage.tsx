/**
 * 路由管理页面
 * 输入: routeStore (配置/模型注册表/探测/统计)
 * 输出: Sub-Tab 导航 + 3 个子页面（CSS 显隐保活）
 * 定位: 展示层 - 路由功能入口
 */

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../store/routeStore';
import { RouteSubTabs } from '../components/Route/RouteSubTabs';
import { ModelRedirectionTab } from '../components/Route/Redirection/ModelRedirectionTab';
import { CliUsabilityTab } from '../components/Route/Usability/CliUsabilityTab';
import { ProxyStatsTab } from '../components/Route/ProxyStats/ProxyStatsTab';

export function RoutePage() {
  const { config, loading, activeSubTab, setActiveSubTab, fetchConfig, fetchRuntimeStatus } =
    useRouteStore(
      useShallow(s => ({
        config: s.config,
        loading: s.loading,
        activeSubTab: s.activeSubTab,
        setActiveSubTab: s.setActiveSubTab,
        fetchConfig: s.fetchConfig,
        fetchRuntimeStatus: s.fetchRuntimeStatus,
      }))
    );

  useEffect(() => {
    fetchConfig();
    fetchRuntimeStatus();
  }, []);

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--ios-blue)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RouteSubTabs activeTab={activeSubTab} onChange={setActiveSubTab} />

      <div className={activeSubTab === 'redirection' ? 'flex-1 flex flex-col' : 'hidden'}>
        <ModelRedirectionTab />
      </div>
      <div className={activeSubTab === 'usability' ? 'flex-1 flex flex-col' : 'hidden'}>
        <CliUsabilityTab />
      </div>
      <div className={activeSubTab === 'proxystats' ? 'flex-1 flex flex-col' : 'hidden'}>
        <ProxyStatsTab />
      </div>
    </div>
  );
}
