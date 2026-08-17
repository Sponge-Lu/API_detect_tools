/**
 * 路由页面
 * 输入: routeStore (配置/模型注册表)
 * 输出: 本地路由布局（代理服务器、会话路由）
 * 定位: 展示层 - Route 工作台入口
 */

import { useShallow } from 'zustand/shallow';
import { ServerSection } from '../components/Route/ProxyStats/ProxyStatsTab';
import { RouteSessionSection } from '../components/Route/RouteSessionSection';
import { LoadingState } from '../components/LoadingState';
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
        <LoadingState size="lg" message="" />
      </div>
    );
  }

  return (
    <div
      data-testid="route-page-scroll-container"
      className="flex h-full min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-6 py-3 [scrollbar-gutter:stable]"
    >
      <div data-testid="route-page-server-row" className="shrink-0">
        <ServerSection className="w-full" />
      </div>

      <div data-testid="route-page-primary-row" className="flex min-w-0 shrink-0 flex-col gap-2.5">
        <div data-testid="route-page-cli-row" className="min-w-0 shrink-0">
          <RouteSessionSection />
        </div>
      </div>
    </div>
  );
}
