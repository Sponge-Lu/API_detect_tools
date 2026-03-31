import {
  Activity,
  BarChart3,
  Layers,
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
  'redirection',
  'usability',
  'proxystats',
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
  redirection: {
    id: 'redirection',
    navLabel: '模型重定向',
    title: '模型重定向',
    description: '配置模型映射规则、覆盖项与重定向行为。',
    icon: Layers,
  },
  usability: {
    id: 'usability',
    navLabel: 'CLI 可用性',
    title: 'CLI 可用性',
    description: '查看 CLI 探测状态、可用性结果与相关诊断。',
    icon: Activity,
  },
  proxystats: {
    id: 'proxystats',
    navLabel: '代理统计',
    title: '代理统计',
    description: '查看代理健康状态、流量数据与统计分析。',
    icon: BarChart3,
  },
  settings: {
    id: 'settings',
    navLabel: '设置',
    title: '设置',
    description: '管理应用偏好、备份、更新与运行参数。',
    icon: Settings,
  },
} satisfies Record<VisibleTabId, AppPageMeta>;
