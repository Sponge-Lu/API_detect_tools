/**
 * 路由页面
 * 输入: routeStore (配置/模型注册表/统计)
 * 输出: 路由总览布局（服务器、CLI 默认模型、统计、模型重定向）
 * 定位: 展示层 - Route 工作台入口
 */

import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { ModelRedirectionTab } from '../components/Route/Redirection/ModelRedirectionTab';
import { ServerSection, StatsDashboard } from '../components/Route/ProxyStats/ProxyStatsTab';
import { useRouteStore } from '../store/routeStore';

export function RoutePage() {
  const { config, loading } = useRouteStore(
    useShallow(store => ({
      config: store.config,
      loading: store.loading,
    }))
  );

  if (loading && !config) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] xl:items-start">
          <ServerSection className="h-full" />
          <StatsDashboard />
        </div>

        <ModelRedirectionTab />
      </div>
    </div>
  );
}
