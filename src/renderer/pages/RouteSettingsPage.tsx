/**
 * 路由设置页
 * 输入: RouteSessionSection (会话路由卡片区)
 * 输出: 会话路由设置布局
 * 定位: 展示层 - 路由设置页入口
 */

import { RouteSessionSection } from '../components/Route/RouteSessionSection';

export function RouteSettingsPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-6 py-3 [scrollbar-gutter:stable]">
      <RouteSessionSection />
    </div>
  );
}
