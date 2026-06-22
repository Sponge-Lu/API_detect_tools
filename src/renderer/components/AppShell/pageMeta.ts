import {
  Coins,
  LayoutDashboard,
  Route as RouteIcon,
  ScrollText,
  Server,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { OverviewSubtab, VisibleTabId } from '../../store/uiStore';

export interface AppPageMeta {
  id: VisibleTabId;
  navLabel: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface OverviewSubpageMeta {
  id: OverviewSubtab;
  navLabel: string;
  title: string;
  description: string;
}

export const APP_PAGE_ORDER: VisibleTabId[] = [
  'overview',
  'sites',
  'credit',
  'route',
  'logs',
  'settings',
];

export const APP_PAGE_META = {
  overview: {
    id: 'overview',
    navLabel: '数据总览',
    title: '数据总览',
    description: '集中查看站点余额、每日签到、路由趋势、模型热力与通道健康。',
    icon: LayoutDashboard,
  },
  sites: {
    id: 'sites',
    navLabel: '站点管理',
    title: '站点管理',
    description: '集中维护站点配置、账号、检测结果与日常操作。',
    icon: Server,
  },
  credit: {
    id: 'credit',
    navLabel: 'LDC 积分',
    title: 'LDC 积分',
    description: '查看 Linux Do Credit 账户积分、收支统计与充值入口。',
    icon: Coins,
  },
  route: {
    id: 'route',
    navLabel: '本地路由',
    title: '本地路由',
    description: '统一管理代理服务、CLI 默认模型、统计分析与模型重定向。',
    icon: RouteIcon,
  },
  logs: {
    id: 'logs',
    navLabel: '路由日志',
    title: '路由日志',
    description: '查看当前运行会话内通过本地代理产生的请求尝试。',
    icon: ScrollText,
  },
  settings: {
    id: 'settings',
    navLabel: '设置',
    title: '设置',
    description: '管理应用偏好、备份、更新与运行参数。',
    icon: Settings,
  },
} satisfies Record<VisibleTabId, AppPageMeta>;

export const APP_OVERVIEW_SUBPAGE_ORDER: OverviewSubtab[] = ['site', 'route'];

export const APP_OVERVIEW_SUBPAGE_META = {
  site: {
    id: 'site',
    navLabel: '数据总览',
    title: '数据总览',
    description: '集中查看站点余额、每日签到、路由趋势、模型热力与通道健康。',
  },
  route: {
    id: 'route',
    navLabel: '路由数据',
    title: '路由数据',
    description: '查看请求趋势、模型热力与通道健康。',
  },
} satisfies Record<OverviewSubtab, OverviewSubpageMeta>;
