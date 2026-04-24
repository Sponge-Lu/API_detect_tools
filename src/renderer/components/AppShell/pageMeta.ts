import {
  Activity,
  BarChart3,
  Coins,
  ScrollText,
  Server,
  Settings,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import type { VisibleTabId } from '../../store/uiStore';

export interface AppPageMeta {
  id: VisibleTabId;
  navLabel: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const APP_PAGE_ORDER: VisibleTabId[] = [
  'sites',
  'cli',
  'usability',
  'credit',
  'route',
  'logs',
  'settings',
];

export const APP_PAGE_META = {
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
    navLabel: '路由',
    title: '路由',
    description: '统一管理代理服务、CLI 默认模型、统计分析与模型重定向。',
    icon: BarChart3,
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
