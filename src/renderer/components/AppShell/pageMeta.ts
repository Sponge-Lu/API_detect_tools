import {
  Activity,
  Coins,
  LayoutDashboard,
  Route as RouteIcon,
  ScrollText,
  Server,
  Settings,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { LogsSubtab, OverviewSubtab, VisibleTabId } from '../../store/uiStore';

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

export interface LogsSubpageMeta {
  id: LogsSubtab;
  navLabel: string;
  title: string;
  description: string;
}

export const APP_PAGE_ORDER: VisibleTabId[] = [
  'overview',
  'sites',
  'cli',
  'usability',
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
    description: '集中查看站点余额/签到、路由健康、历史快照与近期异常请求。',
    icon: LayoutDashboard,
  },
  sites: {
    id: 'sites',
    navLabel: '站点管理',
    title: '站点管理',
    description: '集中维护站点配置、账号、检测结果与日常操作。',
    icon: Server,
  },
  cli: {
    id: 'cli',
    navLabel: '自定义CLI',
    title: '自定义 CLI',
    description: '管理 CLI 配置、生成结果与相关维护操作。',
    icon: Terminal,
  },
  credit: {
    id: 'credit',
    navLabel: 'LDC 积分',
    title: 'LDC 积分',
    description: '查看 Linux Do Credit 账户积分、收支统计与充值入口。',
    icon: Coins,
  },
  usability: {
    id: 'usability',
    navLabel: '站点检测',
    title: '站点检测',
    description: '查看站点检测状态、CLI 探测结果与相关诊断。',
    icon: Activity,
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
    navLabel: '日志',
    title: '会话日志',
    description: '查看本次会话中的通知与关键操作记录。',
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
    navLabel: '站点数据',
    title: '站点数据',
    description: '查看站点余额、签到概览与历史资源快照。',
  },
  route: {
    id: 'route',
    navLabel: '路由数据',
    title: '路由数据',
    description: '查看路由请求、对象活跃度、Token 使用与近期异常。',
  },
} satisfies Record<OverviewSubtab, OverviewSubpageMeta>;

export const APP_LOGS_SUBPAGE_ORDER: LogsSubtab[] = ['session', 'route'];

export const APP_LOGS_SUBPAGE_META = {
  session: {
    id: 'session',
    navLabel: '会话事件',
    title: '会话事件',
    description: '查看本次运行会话内的通知与关键操作。',
  },
  route: {
    id: 'route',
    navLabel: '路由日志',
    title: '路由日志',
    description: '查看当前运行会话内通过本地代理产生的请求尝试。',
  },
} satisfies Record<LogsSubtab, LogsSubpageMeta>;
