/**
 * 输入: 无 (纯类型定义)
 * 输出: TypeScript 类型和接口 (SiteCardProps, SiteCardHeaderProps, SiteCardActionsProps)
 * 定位: 类型定义层 - 定义 SiteCard 组件相关的 Props 类型
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteCard/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { SiteConfig } from '../../../main/types/token';
import type { DetectionResult } from '../../App';
import type { CliCompatibilityResult } from '../../store/detectionStore';
import type { CliConfig } from '../../../shared/types/cli-config';

export interface SiteCardProps {
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  siteAccount?: any;
  isExpanded: boolean;
  columnWidths: number[];

  // 扩展数据
  apiKeys: any[];
  userGroups: Record<string, { desc: string; ratio: number }>;
  modelPricing: any;

  // 状态
  detectingSite: string | null;
  checkingIn: string | null;
  dragOverIndex: number | null;
  refreshMessage: { site: string; message: string; type: 'success' | 'info' } | null;

  // 详情面板状态
  selectedGroup: string | null;
  modelSearch: string;
  globalModelSearch: string;
  showTokens: Record<string, boolean>;
  selectedModels: Set<string>;
  deletingTokenKey: string | null;

  // 自动刷新状态
  autoRefreshEnabled?: boolean;

  // CLI 兼容性状态
  cliCompatibility?: CliCompatibilityResult;
  cliConfig?: CliConfig | null;
  isCliTesting?: boolean;

  // 回调函数
  onExpand: (name: string) => void;
  onDetect: (site: SiteConfig) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onCheckIn: (site: SiteConfig) => void;
  onOpenCheckinPage: (site: SiteConfig) => void;
  onOpenExtraLink: (link: string) => void;
  onCopyToClipboard: (text: string, label: string) => void;
  onToggleAutoRefresh?: () => void;
  onOpenCliConfig?: () => void;
  onTestCliCompat?: () => void;
  onApply?: (e?: React.MouseEvent<HTMLButtonElement>) => void;

  // 拖拽回调
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;

  // 详情面板回调
  onToggleGroupFilter: (siteName: string, groupName: string | null) => void;
  onModelSearchChange: (siteName: string, search: string) => void;
  onToggleTokenVisibility: (key: string) => void;
  onToggleModelSelection: (model: string) => void;
  onCopySelectedModels: () => void;
  onOpenCreateTokenDialog: (site: SiteConfig) => void;
  onDeleteToken: (site: SiteConfig, token: any, index: number) => void;
}

export interface SiteCardHeaderProps {
  site: SiteConfig;
  siteResult?: DetectionResult;
  lastSyncDisplay: string | null;
  errorCode: string | null;
  timeoutSeconds: number | null;
  columnWidths: number[];
  todayTotalTokens: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayRequests: number;
  rpm: number;
  tpm: number;
  modelCount: number;
  onOpenCheckinPage: (site: SiteConfig) => void;
  // CLI 兼容性相关
  cliCompatibility?: CliCompatibilityResult;
  cliConfig?: CliConfig | null;
  isCliTesting?: boolean;
  onOpenCliConfig?: () => void;
  onTestCliCompat?: () => void;
  // CLI 配置应用相关
  onApply?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
}

export interface SiteCardActionsProps {
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  isExpanded: boolean;
  detectingSite: string | null;
  checkingIn: string | null;
  autoRefreshEnabled?: boolean;
  /** 签到统计数据 (New API 类型站点) */
  checkinStats?: {
    todayQuota?: number;
    checkinCount?: number;
    totalCheckins?: number;
    siteType?: 'veloera' | 'newapi';
  };

  onExpand: (name: string) => void;
  onDetect: (site: SiteConfig) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onCheckIn: (site: SiteConfig) => void;
  onOpenExtraLink: (link: string) => void;
  onToggleAutoRefresh?: () => void;
}
