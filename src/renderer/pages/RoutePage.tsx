/**
 * 路由页面
 * 输入: routeStore (配置/模型注册表)
 * 输出: 路由总览布局（代理服务器、CLI 路由模型选择、模型重定向）
 * 定位: 展示层 - Route 工作台入口
 */

import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { ModelRedirectionTab } from '../components/Route/Redirection/ModelRedirectionTab';
import { CliModelSection, ServerSection } from '../components/Route/ProxyStats/ProxyStatsTab';
import { useRouteStore } from '../store/routeStore';
import { useUIStore } from '../store/uiStore';

export function RoutePage() {
  const isRoutePageActive = useUIStore(state => state.activeTab === 'route');
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
        <div data-testid="route-page-server-row">
          <ServerSection className="w-full" />
        </div>

        <div data-testid="route-page-primary-row" className="min-w-0">
          <ModelRedirectionTab
            isActive={isRoutePageActive}
            className="min-w-0"
            leadingPane={<CliModelSection variant="pane" className="h-full" />}
          />
        </div>
      </div>
    </div>
  );
}
